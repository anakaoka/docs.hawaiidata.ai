const { pool } = require('../config/database');

async function logAction({ tenantId, userId, action, entityType, entityId, metadata, ipAddress }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, userId, action, entityType || null, entityId || null, metadata ? JSON.stringify(metadata) : '{}', ipAddress || null]
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

module.exports = { logAction };
