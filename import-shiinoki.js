require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./config/database');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');

const { generateTags } = require('./utils/generate-tags');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TENANT_ID = '8ee9ea77-3585-467b-913b-d012481bb4e8';
const UPLOAD_DIR = path.join(__dirname, 'uploads', TENANT_ID);

async function processDocument(docId, filePath, fileType) {
  try {
    await pool.query("UPDATE documents SET status = 'processing' WHERE id = $1", [docId]);

    let text = '';
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
    } catch (e) {
      console.error('  PDF parse error:', e.message);
      text = '[OCR required - binary document]';
    }

    let extractedData = {};
    const llmModel = 'gpt-4o';

    if (text && text.length > 10) {
      try {
        const completion = await openai.chat.completions.create({
          model: llmModel,
          messages: [
            {
              role: 'system',
              content: `You are a document analysis AI for a title & escrow company. Extract structured data from the following document text.
Return a JSON object with these fields where applicable:
- document_type: (e.g., deed, lien, trust, will, release, invoice, closing statement)
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
      } catch (e) {
        console.error('  OpenAI error:', e.message);
        extractedData = { error: 'AI extraction failed', raw_text_available: true };
      }
    }

    const tags = generateTags(extractedData, fileType);

    await pool.query(
      `UPDATE documents SET ocr_text = $1, extracted_data = $2, llm_model = $3, tags = $4, status = 'processed', processed_at = NOW()
       WHERE id = $5`,
      [text, JSON.stringify(extractedData), llmModel, tags, docId]
    );

    console.log(`  Processed: ${text.length} chars, type: ${extractedData.document_type || 'unknown'}, tags: ${tags.join(', ')}`);
  } catch (err) {
    console.error('  Processing error:', err.message);
    await pool.query("UPDATE documents SET status = 'error' WHERE id = $1", [docId]);
  }
}

async function run() {
  const importBatchId = uuidv4();
  console.log(`Import batch: ${importBatchId}\n`);

  // Get admin user ID for uploaded_by
  const adminResult = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const adminUserId = adminResult.rows[0].id;

  // Skip UUID-named files (already imported) and files already in the database
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;
  const allPdfs = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.pdf') && !uuidPattern.test(f));

  // Also check which original filenames are already in the database
  const existing = await pool.query("SELECT original_filename FROM documents WHERE tenant_id = $1", [TENANT_ID]);
  const alreadyImported = new Set(existing.rows.map(r => r.original_filename));

  const files = allPdfs.filter(f => !alreadyImported.has(f));
  console.log(`Found ${allPdfs.length} non-UUID PDFs, ${files.length} new to import\n`);

  for (const file of files) {
    const filePath = path.join(UPLOAD_DIR, file);
    const stats = fs.statSync(filePath);
    const storedName = uuidv4() + '.pdf';

    // Rename to UUID
    const newPath = path.join(UPLOAD_DIR, storedName);
    fs.renameSync(filePath, newPath);

    const sourceInfo = {
      original_path: filePath,
      import_timestamp: new Date().toISOString(),
      import_batch_id: importBatchId
    };

    const docResult = await pool.query(
      `INSERT INTO documents (tenant_id, uploaded_by, original_filename, stored_filename, file_type, file_size, status, import_batch_id, source_info)
       VALUES ($1, $2, $3, $4, 'pdf', $5, 'uploaded', $6, $7) RETURNING id`,
      [TENANT_ID, adminUserId, file, storedName, stats.size, importBatchId, JSON.stringify(sourceInfo)]
    );

    const docId = docResult.rows[0].id;
    console.log(`Importing: ${file} (${(stats.size / 1024).toFixed(0)} KB)`);

    await processDocument(docId, newPath, 'pdf');
  }

  console.log('\nDone!');
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
