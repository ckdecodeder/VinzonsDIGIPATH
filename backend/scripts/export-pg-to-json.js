/**
 * Export PostgreSQL tables → dbcollections/*.json (reverse of migrate-pg.js).
 *
 * Usage (from project root):
 *   npm run export-db
 *
 * Requires DATABASE_URL in backend/.env and a running PostgreSQL instance.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const OUT_DIR = path.resolve(__dirname, '../../dbcollections');

const TABLE_MAP = [
  { table: 'offices', file: 'vinzons_digipath.offices.json' },
  { table: 'document_types', file: 'vinzons_digipath.documenttypes.json' },
  { table: 'users', file: 'vinzons_digipath.users.json' },
  { table: 'documents', file: 'vinzons_digipath.documents.json' },
  { table: 'transmissions', file: 'vinzons_digipath.transmissions.json' },
  { table: 'archives', file: 'vinzons_digipath.archives.json' },
  { table: 'devices', file: 'vinzons_digipath.devices.json' },
  { table: 'device_events', file: 'vinzons_digipath.deviceevents.json' },
  { table: 'notifications', file: 'vinzons_digipath.notifications.json' },
  { table: 'sender_notifications', file: 'vinzons_digipath.sendernotifications.json' },
  { table: 'logs', file: 'vinzons_digipath.logs.json' },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. Check backend/.env');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log('Connected to PostgreSQL\n');

  for (const { table, file } of TABLE_MAP) {
    const { rows } = await client.query(`SELECT * FROM "${table}"`);
    const outPath = path.join(OUT_DIR, file);
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`  ✓  ${table.padEnd(22)} → ${file} (${rows.length} rows)`);
  }

  await client.end();
  console.log('\n✅ Export complete. Commit dbcollections/ to share database data via Git.');
}

main().catch((err) => {
  console.error('\n✗ Export failed:', err.message);
  process.exitCode = 1;
});
