const router = require('express').Router();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAction } = require('../models/audit');

router.use(requireAuth);

// 2FA Demo page (requires authentication)
router.get('/verify-demo', async (req, res) => {
  const ctx = await loadContext(req);
  res.render('verify-demo', { ...ctx });
});

// Helper to get effective tenant (supports admin impersonation)
function getEffectiveTenantId(req) {
  return req.session.impersonatingTenantId || req.session.tenantId;
}

function isImpersonating(req) {
  return !!req.session.impersonatingTenantId;
}

// Helper to load user + tenant for views
async function loadContext(req) {
  const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
  const effectiveTenantId = getEffectiveTenantId(req);
  const tenantResult = await pool.query('SELECT * FROM tenants WHERE id = $1', [effectiveTenantId]);
  return {
    user: userResult.rows[0],
    tenant: tenantResult.rows[0],
    isAdmin: req.session.role === 'admin',
    impersonating: isImpersonating(req) ? tenantResult.rows[0] : null
  };
}

// Returns { clause, params } for tenant filtering
// When impersonating: scoped to that tenant
// Admin (not impersonating): sees all
// Regular user: sees own tenant only
function tenantFilter(req, paramIndex = 1) {
  if (isImpersonating(req)) {
    return { clause: `tenant_id = $${paramIndex}`, params: [req.session.impersonatingTenantId] };
  }
  if (req.session.role === 'admin') {
    return { clause: '1=1', params: [] };
  }
  return { clause: `tenant_id = $${paramIndex}`, params: [req.session.tenantId] };
}

// Switch into a tenant (admin only)
router.post('/tenants/switch/:id', async (req, res) => {
  if (req.session.role !== 'admin') return res.redirect('/dashboard');
  req.session.impersonatingTenantId = req.params.id;
  await logAction({
    tenantId: req.session.tenantId,
    userId: req.session.userId,
    action: 'switch_tenant',
    entityType: 'tenant',
    entityId: req.params.id,
    ipAddress: req.ip
  });
  res.redirect('/dashboard');
});

// Exit tenant impersonation (admin only)
router.post('/tenants/exit', async (req, res) => {
  delete req.session.impersonatingTenantId;
  res.redirect('/dashboard');
});

// Dashboard overview
router.get('/', async (req, res) => {
  try {
    const ctx = await loadContext(req);
    const tf = tenantFilter(req);
    const effectiveTenantId = getEffectiveTenantId(req);

    const recentLogsQuery = (ctx.isAdmin && !isImpersonating(req))
      ? pool.query(
          `SELECT al.*, u.email as user_email, t.name as tenant_name FROM audit_logs al
           LEFT JOIN users u ON al.user_id = u.id
           LEFT JOIN tenants t ON al.tenant_id = t.id
           ORDER BY al.created_at DESC LIMIT 10`)
      : pool.query(
          `SELECT al.*, u.email as user_email FROM audit_logs al
           LEFT JOIN users u ON al.user_id = u.id
           WHERE al.tenant_id = $1 ORDER BY al.created_at DESC LIMIT 10`,
          [effectiveTenantId]);

    // Storage stats query (total files + total size from DB)
    const storageQuery = (ctx.isAdmin && !isImpersonating(req))
      ? pool.query(
          `SELECT COUNT(*) as total_files, COALESCE(SUM(file_size), 0) as total_bytes,
           COUNT(DISTINCT tenant_id) as tenant_count FROM documents`)
      : pool.query(
          `SELECT COUNT(*) as total_files, COALESCE(SUM(file_size), 0) as total_bytes
           FROM documents WHERE tenant_id = $1`,
          [effectiveTenantId]);

    // Per-tenant summary (admin only)
    const tenantSummaryQuery = (ctx.isAdmin && !isImpersonating(req))
      ? pool.query(
          `SELECT t.id, t.name,
             COALESCE(d.file_count, 0) as files,
             COALESCE(d.processed_count, 0) as processed,
             COALESCE(d.total_bytes, 0) as storage_bytes,
             COALESCE(s.search_count, 0) as searches,
             COALESCE(tu.total_tokens, 0) as total_tokens
           FROM tenants t
           LEFT JOIN (
             SELECT tenant_id, COUNT(*) as file_count,
                    COUNT(*) FILTER (WHERE status = 'processed') as processed_count,
                    SUM(file_size) as total_bytes
             FROM documents GROUP BY tenant_id
           ) d ON d.tenant_id = t.id
           LEFT JOIN (
             SELECT tenant_id, COUNT(*) as search_count
             FROM audit_logs WHERE action = 'search' GROUP BY tenant_id
           ) s ON s.tenant_id = t.id
           LEFT JOIN (
             SELECT tenant_id, SUM(total_tokens) as total_tokens
             FROM token_usage GROUP BY tenant_id
           ) tu ON tu.tenant_id = t.id
           ORDER BY t.name`)
      : Promise.resolve({ rows: [] });

    // LLM cost query
    const llmCostQuery = (ctx.isAdmin && !isImpersonating(req))
      ? pool.query(`SELECT COALESCE(SUM(total_tokens), 0) as total_tokens, COUNT(*) as api_calls FROM token_usage`)
      : pool.query(`SELECT COALESCE(SUM(total_tokens), 0) as total_tokens, COUNT(*) as api_calls FROM token_usage WHERE tenant_id = $1`, [effectiveTenantId]);

    const [docCount, processedCount, searchCount, auditCount, recentLogs, storageResult, tenantSummary, llmCostResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM documents WHERE ${tf.clause}`, tf.params),
      pool.query(`SELECT COUNT(*) FROM documents WHERE ${tf.clause} AND status = 'processed'`, tf.params),
      pool.query(`SELECT COUNT(*) FROM audit_logs WHERE ${tf.clause} AND action = 'search'`, tf.params),
      pool.query(`SELECT COUNT(*) FROM audit_logs WHERE ${tf.clause}`, tf.params),
      recentLogsQuery,
      storageQuery,
      tenantSummaryQuery,
      llmCostQuery
    ]);

    // Get disk usage of uploads directory
    let diskUsage = null;
    try {
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      if (fs.existsSync(uploadsDir)) {
        const { execSync } = require('child_process');
        const du = execSync(`du -sb "${uploadsDir}" 2>/dev/null || echo "0"`, { encoding: 'utf8' }).trim();
        diskUsage = parseInt(du.split('\t')[0]) || 0;
      }
    } catch (e) { diskUsage = null; }

    const storage = storageResult.rows[0];

    res.render('dashboard', {
      ...ctx,
      stats: {
        documents: docCount.rows[0].count,
        processed: processedCount.rows[0].count,
        searches: searchCount.rows[0].count,
        auditEvents: auditCount.rows[0].count
      },
      storage: {
        totalFiles: parseInt(storage.total_files),
        totalBytes: parseInt(storage.total_bytes),
        tenantCount: storage.tenant_count ? parseInt(storage.tenant_count) : null,
        diskUsage
      },
      llmCost: {
        totalTokens: parseInt(llmCostResult.rows[0].total_tokens),
        apiCalls: parseInt(llmCostResult.rows[0].api_calls)
      },
      recentActivity: recentLogs.rows,
      tenantSummary: tenantSummary.rows
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('error', { message: 'Failed to load dashboard', user: req.session });
  }
});

// Documents list
router.get('/documents', async (req, res) => {
  try {
    const ctx = await loadContext(req);
    const effectiveTenantId = getEffectiveTenantId(req);
    const result = (ctx.isAdmin && !isImpersonating(req))
      ? await pool.query(
          `SELECT d.*, d.tags, t.name as tenant_name FROM documents d
           LEFT JOIN tenants t ON d.tenant_id = t.id
           ORDER BY d.created_at DESC`)
      : await pool.query(
          'SELECT *, tags FROM documents WHERE tenant_id = $1 ORDER BY created_at DESC',
          [effectiveTenantId]);
    res.render('documents', { ...ctx, documents: result.rows });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Failed to load documents', user: req.session });
  }
});

// Upload page
router.get('/upload', async (req, res) => {
  const ctx = await loadContext(req);
  res.render('upload', { ...ctx, message: null });
});

// Search page
router.get('/search', async (req, res) => {
  const ctx = await loadContext(req);
  res.render('search', { ...ctx });
});

// Audit log page
router.get('/audit', async (req, res) => {
  try {
    const ctx = await loadContext(req);
    const effectiveTenantId = getEffectiveTenantId(req);
    const result = (ctx.isAdmin && !isImpersonating(req))
      ? await pool.query(
          `SELECT al.*, u.email as user_email, t.name as tenant_name FROM audit_logs al
           LEFT JOIN users u ON al.user_id = u.id
           LEFT JOIN tenants t ON al.tenant_id = t.id
           ORDER BY al.created_at DESC LIMIT 100`)
      : await pool.query(
          `SELECT al.*, u.email as user_email FROM audit_logs al
           LEFT JOIN users u ON al.user_id = u.id
           WHERE al.tenant_id = $1 ORDER BY al.created_at DESC LIMIT 100`,
          [effectiveTenantId]);
    res.render('audit', { ...ctx, logs: result.rows });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Failed to load audit logs', user: req.session });
  }
});

// Tenants & Users page (admin only)
router.get('/tenants', async (req, res) => {
  try {
    const ctx = await loadContext(req);
    if (!ctx.isAdmin) return res.redirect('/dashboard');

    const tenants = await pool.query('SELECT * FROM tenants ORDER BY name');
    const users = await pool.query(
      `SELECT u.*, al.last_login FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(created_at) as last_login FROM audit_logs
         WHERE user_id = u.id AND action = 'login'
       ) al ON true
       ORDER BY u.full_name`
    );

    res.render('tenants', { ...ctx, tenants: tenants.rows, users: users.rows });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Failed to load tenants', user: req.session });
  }
});

// Settings page (all authenticated users)
router.get('/settings', async (req, res) => {
  const ctx = await loadContext(req);
  res.render('settings', { ...ctx, message: null });
});

router.post('/settings', async (req, res) => {
  try {
    const { full_name, phone } = req.body;
    await pool.query(
      'UPDATE users SET full_name = $1, phone = $2, updated_at = NOW() WHERE id = $3',
      [full_name, phone || null, req.session.userId]
    );
    await logAction({
      tenantId: req.session.tenantId,
      userId: req.session.userId,
      action: 'update_profile',
      entityType: 'user',
      entityId: req.session.userId,
      ipAddress: req.ip
    });
    const ctx = await loadContext(req);
    res.render('settings', { ...ctx, message: 'Profile updated successfully.' });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Failed to update profile', user: req.session });
  }
});

router.post('/settings/password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!valid) {
      const ctx = await loadContext(req);
      return res.render('settings', { ...ctx, message: 'Current password is incorrect.' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.session.userId]);
    await logAction({
      tenantId: req.session.tenantId,
      userId: req.session.userId,
      action: 'change_password',
      entityType: 'user',
      entityId: req.session.userId,
      ipAddress: req.ip
    });
    const ctx = await loadContext(req);
    res.render('settings', { ...ctx, message: 'Password updated successfully.' });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Failed to update password', user: req.session });
  }
});

// Token usage report
router.get('/token-usage', async (req, res) => {
  try {
    const ctx = await loadContext(req);
    const effectiveTenantId = getEffectiveTenantId(req);
    const isAdmin = ctx.isAdmin && !isImpersonating(req);

    // Summary by tenant
    const summaryQuery = isAdmin
      ? pool.query(
          `SELECT t.name as tenant_name, tu.action, SUM(tu.total_tokens) as total_tokens, COUNT(*) as call_count
           FROM token_usage tu JOIN tenants t ON tu.tenant_id = t.id
           GROUP BY t.name, tu.action ORDER BY t.name, total_tokens DESC`)
      : pool.query(
          `SELECT tu.action, SUM(tu.total_tokens) as total_tokens, COUNT(*) as call_count
           FROM token_usage tu WHERE tu.tenant_id = $1
           GROUP BY tu.action ORDER BY total_tokens DESC`,
          [effectiveTenantId]);

    // Total tokens
    const totalQuery = isAdmin
      ? pool.query(`SELECT SUM(total_tokens) as grand_total, COUNT(*) as total_calls FROM token_usage`)
      : pool.query(`SELECT SUM(total_tokens) as grand_total, COUNT(*) as total_calls FROM token_usage WHERE tenant_id = $1`, [effectiveTenantId]);

    // Recent usage (last 30 days daily)
    const dailyQuery = isAdmin
      ? pool.query(
          `SELECT DATE(created_at) as day, SUM(total_tokens) as tokens, COUNT(*) as calls
           FROM token_usage WHERE created_at > NOW() - INTERVAL '30 days'
           GROUP BY DATE(created_at) ORDER BY day DESC`)
      : pool.query(
          `SELECT DATE(created_at) as day, SUM(total_tokens) as tokens, COUNT(*) as calls
           FROM token_usage WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '30 days'
           GROUP BY DATE(created_at) ORDER BY day DESC`,
          [effectiveTenantId]);

    const [summary, totals, daily] = await Promise.all([summaryQuery, totalQuery, dailyQuery]);

    res.render('token-usage', {
      ...ctx,
      summary: summary.rows,
      totals: totals.rows[0],
      daily: daily.rows,
      isAdminView: isAdmin
    });
  } catch (err) {
    console.error('Token usage error:', err);
    res.render('error', { message: 'Failed to load token usage', user: req.session });
  }
});

module.exports = router;
