const router = require('express').Router();
const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { logAction } = require('../models/audit');

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null, user: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT u.*, t.name as tenant_name, t.slug as tenant_slug, t.theme as tenant_theme
       FROM users u JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.render('login', { error: 'Invalid email or password', user: null });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.render('login', { error: 'Invalid email or password', user: null });
    }

    // Clear any existing sessions for this user
    await pool.query("DELETE FROM session WHERE sess->>'userId' = $1", [user.id]);

    // Set session
    req.session.userId = user.id;
    req.session.tenantId = user.tenant_id;
    req.session.email = user.email;
    req.session.fullName = user.full_name;
    req.session.role = user.role;
    req.session.tenantName = user.tenant_name;
    req.session.tenantSlug = user.tenant_slug;
    req.session.tenantTheme = user.tenant_theme;

    // Audit log
    await logAction({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
      ipAddress: req.ip
    });

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'An error occurred. Please try again.', user: null });
  }
});

router.get('/logout', async (req, res) => {
  if (req.session.userId) {
    await logAction({
      tenantId: req.session.tenantId,
      userId: req.session.userId,
      action: 'logout',
      entityType: 'user',
      entityId: req.session.userId,
      ipAddress: req.ip
    });
  }
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
