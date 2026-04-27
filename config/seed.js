require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('./database');
const fs = require('fs');
const path = require('path');

async function seed() {
  console.log('Running database schema...');

  // Run schema
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  console.log('Schema created. Seeding data...');

  // Create tenants
  const hdep = await pool.query(
    `INSERT INTO tenants (name, slug, industry, theme)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = $1, industry = $3, theme = $4
     RETURNING id`,
    [
      'HDEP International',
      'hdep',
      'Title & Escrow',
      JSON.stringify({
        primary_color: '#1a3a6b',
        accent_color: '#c4953a',
        logo_url: '/images/tenants/hdep-logo.png',
        company_name: 'HDEP International',
        phone: '(808) 591-2600',
        address: '1314 South King Street, Suite 950, Honolulu, HI 96814',
        email: 'info@hdep.com',
        website: 'https://www.hdep.com/'
      })
    ]
  );

  const pbs = await pool.query(
    `INSERT INTO tenants (name, slug, industry, theme)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = $1, industry = $3, theme = $4
     RETURNING id`,
    [
      'Physicians Billing Solutions',
      'pbs',
      'Medical Billing',
      JSON.stringify({
        primary_color: '#0077b6',
        accent_color: '#48cae4',
        logo_url: '/images/tenants/pbs-logo.png',
        company_name: 'Physicians Billing Solutions',
        phone: '',
        address: '',
        email: 'rose@physiciansbillingsolutions.net',
        website: 'https://www.pbsmed.net/'
      })
    ]
  );

  // Admin tenant
  const admin = await pool.query(
    `INSERT INTO tenants (name, slug, industry, theme)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = $1, industry = $3, theme = $4
     RETURNING id`,
    [
      'Hawaii Data AI',
      'hawaiidata',
      'Platform Admin',
      JSON.stringify({
        primary_color: '#2563eb',
        accent_color: '#f97316'
      })
    ]
  );

  const hdepId = hdep.rows[0].id;
  const pbsId = pbs.rows[0].id;
  const adminId = admin.rows[0].id;

  const seedPassword = process.env.SEED_USER_PASSWORD;
  if (!seedPassword) {
    throw new Error('Set SEED_USER_PASSWORD before running config/seed.js');
  }
  const defaultPassword = await bcrypt.hash(seedPassword, 12);

  // Create users
  const users = [
    // HDEP tenant user
    {
      tenant_id: hdepId,
      email: 'joie@hdep.com',
      full_name: 'Joie Yuen',
      role: 'user'
    },
    // PBS tenant user
    {
      tenant_id: pbsId,
      email: 'rose@physiciansbillingsolutions.net',
      full_name: 'Rose Seguritan',
      role: 'user'
    },
    // Admins (assigned to admin tenant)
    {
      tenant_id: adminId,
      email: 'rabe@nimble-hi.com',
      full_name: 'Ryan Abe',
      role: 'admin'
    },
    {
      tenant_id: adminId,
      email: 'anakaoka@trinet-hi.com',
      full_name: 'Aryn Nakaoka',
      role: 'admin'
    }
  ];

  for (const u of users) {
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET full_name = $4, role = $5, tenant_id = $1`,
      [u.tenant_id, u.email, defaultPassword, u.full_name, u.role]
    );
    console.log(`  User: ${u.email} (${u.role})`);
  }

  console.log('\nSeed complete!');
  console.log('Seed users were created with SEED_USER_PASSWORD.');
  console.log('Users should change their passwords after first login.\n');

  await pool.end();
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
