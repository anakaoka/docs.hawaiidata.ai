/**
 * One-time backfill script: generate tags for all existing documents
 * that have extracted_data but empty tags.
 *
 * Usage: node backfill-tags.js
 */
require('dotenv').config();
const { pool } = require('./config/database');
const { generateTags } = require('./utils/generate-tags');

async function backfill() {
  const result = await pool.query(
    "SELECT id, extracted_data, file_type FROM documents WHERE tags = '{}' OR tags IS NULL"
  );

  console.log(`Found ${result.rows.length} documents to backfill\n`);
  let updated = 0;

  for (const doc of result.rows) {
    const extractedData = doc.extracted_data || {};
    const fileType = doc.file_type || 'pdf';
    const tags = generateTags(extractedData, fileType);

    if (tags.length > 0) {
      await pool.query('UPDATE documents SET tags = $1 WHERE id = $2', [tags, doc.id]);
      console.log(`  [${doc.id}] ${tags.join(', ')}`);
      updated++;
    }
  }

  console.log(`\nBackfill complete: ${updated}/${result.rows.length} documents updated`);
  await pool.end();
}

backfill().catch(e => { console.error(e); process.exit(1); });
