const router = require('express').Router();
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.use(requireAuth);

// Natural language audit search
router.post('/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ results: [] });

  // Hide admin impersonation entries from regular tenant users
  const isAdmin = req.session.role === 'admin';
  const impersonationFilter = isAdmin
    ? ''
    : `AND NOT (u.role = 'admin' AND u.tenant_id IS DISTINCT FROM al.tenant_id)`;

  try {
    // Use OpenAI to interpret audit query
    const interpretation = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You interpret natural language queries about audit logs into SQL WHERE clauses.
Available columns: action (login, logout, upload, view_document, search, process_document, update_profile, change_password),
entity_type (user, document), created_at (timestamp), user_id.
Return JSON with: { conditions: "SQL WHERE fragment", params: [] }
Use $1 for tenant_id (already filtered). Use INTERVAL for relative dates.
Only return valid PostgreSQL syntax.`
        },
        { role: 'user', content: query }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(interpretation.choices[0].message.content);

    // Fallback to basic search if AI response is unusable
    let result;
    if (parsed.conditions && !parsed.conditions.includes(';')) {
      result = await pool.query(
        `SELECT al.*, u.email as user_email FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.tenant_id = $1 ${impersonationFilter} AND (${parsed.conditions})
         ORDER BY al.created_at DESC LIMIT 50`,
        [req.session.tenantId, ...(parsed.params || [])]
      );
    } else {
      // Simple fallback
      result = await pool.query(
        `SELECT al.*, u.email as user_email FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.tenant_id = $1 ${impersonationFilter} AND (al.action ILIKE $2 OR u.email ILIKE $2)
         ORDER BY al.created_at DESC LIMIT 50`,
        [req.session.tenantId, `%${query}%`]
      );
    }

    res.json({ results: result.rows });
  } catch (err) {
    console.error('Audit search error:', err);
    res.status(500).json({ error: 'Audit search failed' });
  }
});

module.exports = router;
