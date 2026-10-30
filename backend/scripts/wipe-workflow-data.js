/**
 * Wipe documents, transmissions, and archives (and related dependent rows).
 * Usage: node backend/scripts/wipe-workflow-data.js
 */
require('dotenv').config({ quiet: true });
require('../utils/maintenanceGuard').requireTestWrite(process.env.DATABASE_URL, process.argv);
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const count = async (table) => {
    const result = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    return result.rows[0].n;
  };

  const before = {
    documents: await count('documents'),
    transmissions: await count('transmissions'),
    archives: await count('archives'),
  };
  console.log('Before:', before);

  await client.query('BEGIN');
  try {
    // Clear dependent / related records that reference documents when present.
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const names = new Set(tables.rows.map((row) => row.table_name));

    const optionalDeletes = [
      'notifications',
      'device_events',
      'deviceevents',
    ];

    for (const table of optionalDeletes) {
      if (!names.has(table)) continue;
      const result = await client.query(`DELETE FROM ${table}`);
      console.log(`Deleted ${result.rowCount} from ${table}`);
    }

    // Wipe the three requested collections.
    for (const table of ['transmissions', 'archives', 'documents']) {
      if (!names.has(table)) {
        console.log(`Skip missing table: ${table}`);
        continue;
      }
      const result = await client.query(`DELETE FROM ${table}`);
      console.log(`Deleted ${result.rowCount} from ${table}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  const after = {
    documents: await count('documents'),
    transmissions: await count('transmissions'),
    archives: await count('archives'),
  };
  console.log('After:', after);

  // Best-effort: remove orphaned scan files under uploads/scans
  const scansDir = path.join(__dirname, '..', 'uploads', 'scans');
  if (fs.existsSync(scansDir)) {
    const files = fs.readdirSync(scansDir);
    let removed = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(scansDir, file));
        removed += 1;
      } catch {
        // ignore individual file failures
      }
    }
    console.log(`Removed ${removed} files from uploads/scans`);
  }

  await client.end();
  console.log('Done. Documents, transmissions, and archives are empty.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
