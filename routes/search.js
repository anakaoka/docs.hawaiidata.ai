const router = require('express').Router();
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAction } = require('../models/audit');
const OpenAI = require('openai');
const sgMail = require('@sendgrid/mail');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { decryptFile } = require('../utils/encryption');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

router.use(requireAuth);

router.post('/', async (req, res) => {
  const { query, date_from, date_to, doc_type, address_tmk } = req.body;
  if (!query) return res.json({ results: [] });

  try {
    // Use OpenAI to interpret the search query into SQL conditions
    const interpretation = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a search query interpreter for a document management system serving title & escrow companies in Hawaii.
Given a natural language query, return a JSON object with:
- search_terms: array of keywords to search in document text
- filters: { status, date_from, date_to, document_type }
Only include filters that are explicitly mentioned. Return valid JSON only.
Understand title & escrow terminology: TMK, deed, lien, FIRPTA, HARPTA, encumbrance, easement, recording number, escrow, closing, etc.`
        },
        { role: 'user', content: query }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(interpretation.choices[0].message.content);
    const terms = parsed.search_terms || [query];

    // Track token usage for search interpretation
    if (interpretation.usage) {
      pool.query(
        `INSERT INTO token_usage (tenant_id, user_id, action, model, prompt_tokens, completion_tokens, total_tokens)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.session.tenantId, req.session.userId, 'search_interpretation', 'gpt-4o',
         interpretation.usage.prompt_tokens || 0, interpretation.usage.completion_tokens || 0, interpretation.usage.total_tokens || 0]
      ).catch(() => {});
    }

    // Full-text search with PostgreSQL
    const searchQuery = terms.join(' & ');
    const effectiveTenantId = req.session.impersonatingTenantId || req.session.tenantId;
    const isAdmin = req.session.role === 'admin' && !req.session.impersonatingTenantId;

    // Build dynamic WHERE clauses and params
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // $1 = search terms for full-text
    params.push(terms.join(' '));
    const tsParam = `$${paramIndex}`;
    paramIndex++;

    // Tenant filter
    if (!isAdmin) {
      conditions.push(`tenant_id = $${paramIndex}`);
      params.push(effectiveTenantId);
      paramIndex++;
    }

    // LIKE param for filename match
    params.push(`%${terms[0]}%`);
    const likeParam = `$${paramIndex}`;
    paramIndex++;

    // Full-text + filename condition
    conditions.push(`(to_tsvector('english', COALESCE(ocr_text, '')) @@ plainto_tsquery('english', ${tsParam}) OR original_filename ILIKE ${likeParam})`);

    // Filter: date_from
    if (date_from) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(date_from);
      paramIndex++;
    }

    // Filter: date_to
    if (date_to) {
      conditions.push(`created_at < ($${paramIndex}::date + interval '1 day')`);
      params.push(date_to);
      paramIndex++;
    }

    // Filter: doc_type
    if (doc_type) {
      conditions.push(`extracted_data->>'document_type' ILIKE $${paramIndex}`);
      params.push(`%${doc_type}%`);
      paramIndex++;
    }

    // Filter: address_tmk
    if (address_tmk) {
      const addrParam = `$${paramIndex}`;
      params.push(`%${address_tmk}%`);
      conditions.push(`(extracted_data->'property_info'->>'address' ILIKE ${addrParam} OR extracted_data->'property_info'->>'tmk' ILIKE ${addrParam} OR ocr_text ILIKE ${addrParam})`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const result = await pool.query(
      `SELECT id, original_filename, file_type, status, created_at, extracted_data,
              ts_headline('english', COALESCE(ocr_text, ''), plainto_tsquery('english', ${tsParam}), 'MaxWords=50, MinWords=20') as snippet
       FROM documents
       WHERE ${whereClause}
       ORDER BY ts_rank(to_tsvector('english', COALESCE(ocr_text, '')), plainto_tsquery('english', ${tsParam})) DESC
       LIMIT 20`,
      params
    );

    await logAction({
      tenantId: req.session.tenantId,
      userId: req.session.userId,
      action: 'search',
      entityType: 'document',
      metadata: { query, results_count: result.rows.length },
      ipAddress: req.ip
    });

    // Generate AI summary of results
    let aiSummary = '';
    if (result.rows.length > 0) {
      try {
        const docDescriptions = result.rows.map(doc => {
          const docType = (doc.extracted_data && doc.extracted_data.document_type) || doc.file_type || 'unknown';
          const summary = (doc.extracted_data && doc.extracted_data.summary) || doc.snippet || '';
          return `- ${doc.original_filename} (${docType}): ${summary}`;
        }).join('\n');

        const summaryResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an AI assistant for a document intelligence platform serving title & escrow companies in Hawaii. When summarizing search results, prioritize information relevant to real estate transactions: property addresses, TMK (Tax Map Key) numbers, sale prices, buyer/seller names, closing dates, lien amounts, deed types, FIRPTA/HARPTA withholding, easements, encumbrances, title defects, recording numbers, and escrow account details. Use industry-standard terminology. Be concise and informative.'
            },
            {
              role: 'user',
              content: `The user searched for '${query}'. Here are the ${result.rows.length} matching documents and their summaries:\n${docDescriptions}\n\nProvide a concise 2-3 sentence overview of what was found.`
            }
          ],
          max_tokens: 200
        });
        aiSummary = summaryResponse.choices[0].message.content;

        // Track token usage for summary
        if (summaryResponse.usage) {
          pool.query(
            `INSERT INTO token_usage (tenant_id, user_id, action, model, prompt_tokens, completion_tokens, total_tokens)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [req.session.tenantId, req.session.userId, 'search_summary', 'gpt-4o',
             summaryResponse.usage.prompt_tokens || 0, summaryResponse.usage.completion_tokens || 0, summaryResponse.usage.total_tokens || 0]
          ).catch(() => {});
        }
      } catch (summaryErr) {
        console.error('AI summary generation error:', summaryErr);
      }
    }

    res.json({ results: result.rows, aiSummary });
  } catch (err) {
    console.error('Search error:', err);
    // Fallback to simple search
    try {
      const effectiveTidFb = req.session.impersonatingTenantId || req.session.tenantId;
      const isAdminFb = req.session.role === 'admin' && !req.session.impersonatingTenantId;
      const result = isAdminFb
        ? await pool.query(
            `SELECT id, original_filename, file_type, status, created_at
             FROM documents WHERE (ocr_text ILIKE $1 OR original_filename ILIKE $1)
             ORDER BY created_at DESC LIMIT 20`,
            [`%${query}%`])
        : await pool.query(
            `SELECT id, original_filename, file_type, status, created_at
             FROM documents WHERE tenant_id = $1
             AND (ocr_text ILIKE $2 OR original_filename ILIKE $2)
             ORDER BY created_at DESC LIMIT 20`,
            [effectiveTidFb, `%${query}%`]);
      res.json({ results: result.rows });
    } catch (fallbackErr) {
      res.status(500).json({ error: 'Search failed' });
    }
  }
});

// Helper: format date in HST
function formatHST(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }) + ' HST';
}

// Email search results to the logged-in user
router.post('/email', async (req, res) => {
  const { query, summary, resultIds } = req.body;
  const userEmail = req.session.email;

  if (!userEmail) {
    return res.status(400).json({ error: 'No email address on file for your account.' });
  }

  if (!resultIds || resultIds.length === 0) {
    return res.status(400).json({ error: 'No results to email.' });
  }

  try {
    // Fetch the documents by IDs
    const effectiveTenantId = req.session.impersonatingTenantId || req.session.tenantId;
    const isAdmin = req.session.role === 'admin' && !req.session.impersonatingTenantId;
    const placeholders = resultIds.map((_, i) => `$${i + 1}`).join(', ');
    const tenantFilter = isAdmin ? '' : ` AND tenant_id = $${resultIds.length + 1}`;
    const params = isAdmin ? resultIds : [...resultIds, effectiveTenantId];

    const result = await pool.query(
      `SELECT id, original_filename, file_type, status, created_at, extracted_data
       FROM documents
       WHERE id IN (${placeholders})${tenantFilter}
       ORDER BY created_at DESC`,
      params
    );

    // Generate a secure download token
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token in secure_links (use first document_id as the FK reference)
    await pool.query(
      `INSERT INTO secure_links (tenant_id, document_id, created_by, token, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [effectiveTenantId, resultIds[0], req.session.userId, token, expiresAt]
    );

    // Store the full document ID list in a JSON file keyed by token
    const tokenDataDir = path.join(__dirname, '..', 'data', 'search-tokens');
    fs.mkdirSync(tokenDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(tokenDataDir, `${token}.json`),
      JSON.stringify({ documentIds: resultIds, tenantId: effectiveTenantId, expiresAt: expiresAt.toISOString() })
    );

    const downloadUrl = `https://docs.hawaiidata.ai/api/search/download/${token}`;

    const docRows = result.rows.map(doc => {
      const docType = (doc.extracted_data && doc.extracted_data.document_type) || doc.file_type || 'N/A';
      const docSummary = (doc.extracted_data && doc.extracted_data.summary) || '';
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${doc.original_filename}</td>
        <td style="padding:8px;border:1px solid #ddd;">${docType}</td>
        <td style="padding:8px;border:1px solid #ddd;">${doc.status}</td>
        <td style="padding:8px;border:1px solid #ddd;">${docSummary}</td>
      </tr>`;
    }).join('');

    const nowHST = formatHST(new Date());

    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
        <h2 style="color:#1a1a2e;">Search Results from Hawaii Data</h2>
        <p style="color:#555;">Search query: <strong>${query}</strong></p>
        ${summary ? `
        <div style="background:#f0f7ff;border-left:4px solid #3b82f6;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <strong style="color:#1e40af;">AI Summary</strong>
          <p style="color:#334155;margin:8px 0 0;">${summary}</p>
        </div>` : ''}
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Filename</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Type</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Status</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Summary</th>
            </tr>
          </thead>
          <tbody>${docRows}</tbody>
        </table>
        <p style="margin-top:24px;">
          <a href="${downloadUrl}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Download Documents (.zip)</a>
        </p>
        <p style="color:#999;font-size:12px;">This download link expires in 24 hours.</p>
        <p style="margin-top:16px;">
          <a href="https://docs.hawaiidata.ai/dashboard/search" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Go to Dashboard</a>
        </p>
        <p style="color:#999;font-size:12px;margin-top:24px;">This email was sent from Hawaii Data AI. Do not reply to this email.</p>
      </div>
    `;

    await sgMail.send({
      to: userEmail,
      from: 'doc@hawaiidata.ai',
      subject: `Search Results \u2014 ${nowHST}`,
      html: htmlContent
    });

    await logAction({
      tenantId: req.session.tenantId,
      userId: req.session.userId,
      action: 'email_search_results',
      entityType: 'document',
      metadata: { query, results_count: resultIds.length, recipient: userEmail, download_token: token },
      ipAddress: req.ip
    });

    res.json({ success: true, message: `Results emailed to ${userEmail}` });
  } catch (err) {
    console.error('Email search results error:', err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

// Download search results as .zip via secure token
router.get('/download/:token', async (req, res) => {
  const { token } = req.params;

  try {
    // Validate the token in secure_links
    const linkResult = await pool.query(
      `SELECT * FROM secure_links WHERE token = $1 AND is_revoked = false AND expires_at > NOW()`,
      [token]
    );

    if (linkResult.rows.length === 0) {
      return res.status(403).send(`
        <html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px;">
          <h2>Link Expired or Invalid</h2>
          <p>This download link has expired or is no longer valid.</p>
          <a href="https://docs.hawaiidata.ai/dashboard/search" style="color:#3b82f6;">Go to Dashboard</a>
        </body></html>
      `);
    }

    // Read the token data file for the full list of document IDs
    const tokenDataPath = path.join(__dirname, '..', 'data', 'search-tokens', `${token}.json`);
    if (!fs.existsSync(tokenDataPath)) {
      return res.status(404).send('Download data not found.');
    }

    const tokenData = JSON.parse(fs.readFileSync(tokenDataPath, 'utf8'));
    const documentIds = tokenData.documentIds;
    const tenantId = tokenData.tenantId;

    // Fetch documents
    const placeholders = documentIds.map((_, i) => `$${i + 1}`).join(', ');
    const docResult = await pool.query(
      `SELECT id, original_filename, stored_filename, file_type, tenant_id
       FROM documents
       WHERE id IN (${placeholders}) AND tenant_id = $${documentIds.length + 1}`,
      [...documentIds, tenantId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).send('No documents found.');
    }

    // Mark link as accessed
    await pool.query(
      `UPDATE secure_links SET accessed_at = NOW() WHERE token = $1`,
      [token]
    );

    // Create zip archive and stream it
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="search-results.zip"');

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    for (const doc of docResult.rows) {
      const filePath = path.join(__dirname, '..', 'uploads', doc.tenant_id, doc.stored_filename);
      if (fs.existsSync(filePath)) {
        if (process.env.ENCRYPTION_KEY) {
          try {
            const decrypted = decryptFile(filePath);
            archive.append(decrypted, { name: doc.original_filename });
          } catch (e) {
            // Fall back to raw file if decryption fails (unencrypted legacy file)
            archive.file(filePath, { name: doc.original_filename });
          }
        } else {
          archive.file(filePath, { name: doc.original_filename });
        }
      }
    }

    await archive.finalize();

  } catch (err) {
    console.error('Download error:', err);
    if (!res.headersSent) {
      res.status(500).send('Download failed.');
    }
  }
});

module.exports = router;
