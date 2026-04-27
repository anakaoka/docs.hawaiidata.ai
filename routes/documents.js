const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAction } = require('../models/audit');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');

const { generateTags } = require('../utils/generate-tags');
const { encryptFile } = require('../utils/encryption');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const effectiveTid = req.session.impersonatingTenantId || req.session.tenantId;
    const dir = path.join(__dirname, '..', 'uploads', effectiveTid);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.tiff', '.tif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and TIFF files are allowed'));
    }
  }
});

router.use(requireAuth);

// Get distinct project names for autocomplete
router.get('/projects', async (req, res) => {
  try {
    const effectiveTenantId = getEffectiveTenantId(req);
    const result = await pool.query(
      `SELECT DISTINCT project_name FROM documents WHERE tenant_id = $1 AND project_name IS NOT NULL ORDER BY project_name`,
      [effectiveTenantId]
    );
    res.json(result.rows.map(r => r.project_name));
  } catch (err) {
    res.json([]);
  }
});

// Get effective tenant (supports admin impersonation)
function getEffectiveTenantId(req) {
  return req.session.impersonatingTenantId || req.session.tenantId;
}

// Upload documents
router.post('/upload', upload.array('documents', 10), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.redirect('/dashboard/upload');
    }

    const effectiveTenantId = getEffectiveTenantId(req);

    for (const file of files) {
      // Insert document record
      const docResult = await pool.query(
        `INSERT INTO documents (tenant_id, uploaded_by, original_filename, stored_filename, file_type, file_size, status, property_id, project_name)
         VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', $7, $8) RETURNING id`,
        [effectiveTenantId, req.session.userId, file.originalname, file.filename,
         path.extname(file.originalname).replace('.', ''), file.size, req.body.property_id || null,
         req.body.project_name?.trim() || null]
      );

      const docId = docResult.rows[0].id;

      await logAction({
        tenantId: effectiveTenantId,
        userId: req.session.userId,
        action: 'upload',
        entityType: 'document',
        entityId: docId,
        metadata: { filename: file.originalname, size: file.size },
        ipAddress: req.ip
      });

      // Process async (OCR + AI extraction)
      processDocument(docId, file.path, effectiveTenantId, req.session.userId).catch(console.error);
    }

    res.redirect('/dashboard/documents');
  } catch (err) {
    console.error('Upload error:', err);
    res.redirect('/dashboard/upload');
  }
});

// Process document with OCR + AI
async function processDocument(docId, filePath, tenantId, userId) {
  try {
    await pool.query("UPDATE documents SET status = 'processing' WHERE id = $1", [docId]);

    // Extract text from PDF
    let text = '';
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
    } catch (e) {
      console.error('PDF parse error:', e);
      // For TIFF or failed PDF, we'll use OpenAI vision
      text = '[OCR required - binary document]';
    }

    // Use OpenAI to extract structured data
    let extractedData = {};
    let llmModel = 'gpt-4o';

    if (text && text.length > 10) {
      try {
        const completion = await openai.chat.completions.create({
          model: llmModel,
          messages: [
            {
              role: 'system',
              content: `You are a document analysis AI. Extract structured data from the following document text.
Return a JSON object with these fields where applicable:
- document_type: (e.g., deed, lien, invoice, report)
- parties: array of names/entities mentioned
- dates: array of important dates
- amounts: array of monetary amounts
- property_info: { address, tmk, parcel_id } if applicable
- key_findings: array of important findings or issues
- summary: brief 2-3 sentence summary`
            },
            { role: 'user', content: text.slice(0, 8000) }
          ],
          response_format: { type: 'json_object' }
        });

        extractedData = JSON.parse(completion.choices[0].message.content);

        // Track token usage
        if (completion.usage) {
          await pool.query(
            `INSERT INTO token_usage (tenant_id, user_id, action, model, prompt_tokens, completion_tokens, total_tokens)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [tenantId, userId, 'document_extraction', llmModel,
             completion.usage.prompt_tokens || 0, completion.usage.completion_tokens || 0, completion.usage.total_tokens || 0]
          );
        }
      } catch (e) {
        console.error('OpenAI extraction error:', e);
        extractedData = { error: 'AI extraction failed', raw_text_available: true };
      }
    }

    // Generate tags from extracted data
    // Determine file type from the file path extension
    const fileType = path.extname(filePath).replace('.', '').toLowerCase() || 'pdf';
    const tags = generateTags(extractedData, fileType);

    // Update document
    await pool.query(
      `UPDATE documents SET ocr_text = $1, extracted_data = $2, llm_model = $3, tags = $4, status = 'processed', processed_at = NOW()
       WHERE id = $5`,
      [text, JSON.stringify(extractedData), llmModel, tags, docId]
    );

    // Encrypt the file at rest after processing
    if (process.env.ENCRYPTION_KEY) {
      try {
        encryptFile(filePath);
      } catch (encErr) {
        console.error('File encryption error:', encErr);
      }
    }

    await logAction({
      tenantId,
      userId,
      action: 'process_document',
      entityType: 'document',
      entityId: docId,
      metadata: { llm_model: llmModel, text_length: text.length }
    });

  } catch (err) {
    console.error('Document processing error:', err);
    await pool.query("UPDATE documents SET status = 'error' WHERE id = $1", [docId]);
  }
}

// View document details
router.get('/:id/view', async (req, res) => {
  try {
    const effectiveTenantId = getEffectiveTenantId(req);
    const isAdmin = req.session.role === 'admin';
    const result = isAdmin
      ? await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id])
      : await pool.query('SELECT * FROM documents WHERE id = $1 AND tenant_id = $2', [req.params.id, effectiveTenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await logAction({
      tenantId: effectiveTenantId,
      userId: req.session.userId,
      action: 'view_document',
      entityType: 'document',
      entityId: req.params.id,
      ipAddress: req.ip
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load document' });
  }
});

module.exports = router;
