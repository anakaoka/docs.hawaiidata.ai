try {
  require('dotenv').config();
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
}
const http = require('http');
const https = require('https');

const BASE = process.env.TEST_BASE_URL || 'https://docs.hawaiidata.ai';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

const results = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function log(test, status, detail) {
  results.push({ test, status, detail });
  if (status === 'PASS') passed += 1;
  else if (status === 'SKIP') skipped += 1;
  else failed += 1;
  console.log(`${status} ${test}: ${detail}`);
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function checkPage(path, expectedText, name, expectedStatus = 200) {
  try {
    const r = await request(`${BASE}${path}`);
    if (r.status === expectedStatus && r.body.includes(expectedText)) {
      log(name, 'PASS', `Status ${r.status}`);
    } else {
      log(name, 'FAIL', `Status ${r.status}`);
    }
  } catch (e) {
    log(name, 'FAIL', e.message);
  }
}

async function run() {
  console.log(`=== docs.HawaiiData.ai smoke tests: ${BASE} ===\n`);

  await checkPage('/', 'HawaiiData', 'Homepage');
  await checkPage('/auth/login', 'Sign In', 'Login page');
  await checkPage('/request-access', 'Request Access', 'Request access page');
  await checkPage('/nonexistent-page', 'Page Not Found', '404 page', 404);

  try {
    const r = await request(`${BASE}/verify-demo`);
    if (r.status === 302 && r.headers.location === '/dashboard/verify-demo') {
      log('2FA demo redirect', 'PASS', 'Public demo URL redirects to authenticated dashboard route');
    } else {
      log('2FA demo redirect', 'FAIL', `Status ${r.status}, location: ${r.headers.location}`);
    }
  } catch (e) {
    log('2FA demo redirect', 'FAIL', e.message);
  }

  try {
    const r = await request(`${BASE}/dashboard`);
    if (r.status === 302 && r.headers.location && r.headers.location.includes('login')) {
      log('Auth guard', 'PASS', 'Dashboard redirects unauthenticated users to login');
    } else {
      log('Auth guard', 'FAIL', `Status ${r.status}, location: ${r.headers.location}`);
    }
  } catch (e) {
    log('Auth guard', 'FAIL', e.message);
  }

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    log('Authenticated dashboard flow', 'SKIP', 'Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD to run login checks');
  } else {
    try {
      const loginBody = new URLSearchParams({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).toString();
      const r = await request(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: loginBody,
      });
      const cookie = (r.headers['set-cookie'] || ['']).toString().split(';')[0];
      if (r.status === 302 && r.headers.location === '/dashboard' && cookie) {
        log('Admin login', 'PASS', 'Redirects to dashboard and sets a session cookie');
      } else {
        log('Admin login', 'FAIL', `Status ${r.status}, location: ${r.headers.location}`);
      }

      if (cookie) {
        const dashboard = await request(`${BASE}/dashboard`, { headers: { Cookie: cookie } });
        if (dashboard.status === 200 && dashboard.body.includes('Overview')) {
          log('Dashboard overview', 'PASS', 'Authenticated dashboard rendered');
        } else {
          log('Dashboard overview', 'FAIL', `Status ${dashboard.status}`);
        }
      }
    } catch (e) {
      log('Authenticated dashboard flow', 'FAIL', e.message);
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
