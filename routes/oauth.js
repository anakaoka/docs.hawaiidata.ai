const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { logAction } = require('../models/audit');

// ==================== GOOGLE ====================

router.get('/google/login', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.render('error', { message: 'Google login is not yet configured.', user: null });
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: 'https://docs.hawaiidata.ai/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account'
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || state !== req.session.oauthState) {
    return res.render('login', { error: 'Authentication failed. Please try again.', user: null });
  }
  delete req.session.oauthState;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://docs.hawaiidata.ai/auth/google/callback',
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();

    if (!tokens.id_token) {
      return res.render('login', { error: 'Failed to get identity from Google.', user: null });
    }

    // Decode ID token (payload is base64url in the middle segment)
    const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());

    // Verify issuer
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) {
      return res.render('login', { error: 'Invalid token issuer.', user: null });
    }

    // Verify audience
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.render('login', { error: 'Invalid token audience.', user: null });
    }

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return res.render('login', { error: 'Token expired.', user: null });
    }

    await handleOAuthLogin(req, res, 'google', payload.sub, payload.email, payload.name);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.render('login', { error: 'Google authentication failed.', user: null });
  }
});

// ==================== MICROSOFT ====================

router.get('/microsoft/login', (req, res) => {
  if (!process.env.MICROSOFT_CLIENT_ID) {
    return res.render('error', { message: 'Microsoft login is not yet configured.', user: null });
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: 'https://docs.hawaiidata.ai/auth/microsoft/callback',
    response_type: 'code',
    scope: 'openid profile email',
    state,
    response_mode: 'query',
    prompt: 'select_account'
  });

  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`);
});

router.get('/microsoft/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || state !== req.session.oauthState) {
    return res.render('login', { error: 'Authentication failed. Please try again.', user: null });
  }
  delete req.session.oauthState;

  try {
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        redirect_uri: 'https://docs.hawaiidata.ai/auth/microsoft/callback',
        grant_type: 'authorization_code',
        scope: 'openid profile email'
      })
    });
    const tokens = await tokenRes.json();

    if (!tokens.id_token) {
      return res.render('login', { error: 'Failed to get identity from Microsoft.', user: null });
    }

    const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());

    // Verify audience
    if (payload.aud !== process.env.MICROSOFT_CLIENT_ID) {
      return res.render('login', { error: 'Invalid token audience.', user: null });
    }

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return res.render('login', { error: 'Token expired.', user: null });
    }

    const email = payload.email || payload.preferred_username;
    await handleOAuthLogin(req, res, 'microsoft', payload.sub || payload.oid, email, payload.name);
  } catch (err) {
    console.error('Microsoft OAuth error:', err);
    res.render('login', { error: 'Microsoft authentication failed.', user: null });
  }
});

// ==================== SHARED LOGIC ====================

async function handleOAuthLogin(req, res, provider, oauthId, email, fullName) {
  if (!email) {
    return res.render('login', { error: 'No email returned from provider.', user: null });
  }

  email = email.toLowerCase().trim();

  // Look up existing user by email (invite-only: must already exist)
  const result = await pool.query(
    `SELECT u.*, t.name as tenant_name, t.slug as tenant_slug, t.theme as tenant_theme
     FROM users u JOIN tenants t ON u.tenant_id = t.id
     WHERE u.email = $1 AND u.is_active = true`,
    [email]
  );

  if (result.rows.length === 0) {
    return res.render('login', {
      error: 'No account found for this email. This platform is invite-only.',
      user: null
    });
  }

  const user = result.rows[0];

  // Update OAuth fields if not already set
  if (!user.oauth_provider || !user.oauth_id) {
    await pool.query(
      'UPDATE users SET oauth_provider = $1, oauth_id = $2, updated_at = NOW() WHERE id = $3',
      [provider, oauthId, user.id]
    );
  }

  // Set session
  req.session.userId = user.id;
  req.session.tenantId = user.tenant_id;
  req.session.email = user.email;
  req.session.fullName = user.full_name || fullName;
  req.session.role = user.role;
  req.session.tenantName = user.tenant_name;
  req.session.tenantSlug = user.tenant_slug;
  req.session.tenantTheme = user.tenant_theme;

  await logAction({
    tenantId: user.tenant_id,
    userId: user.id,
    action: 'login',
    entityType: 'user',
    entityId: user.id,
    metadata: { email: user.email, provider },
    ipAddress: req.ip
  });

  res.redirect('/dashboard');
}

module.exports = router;
