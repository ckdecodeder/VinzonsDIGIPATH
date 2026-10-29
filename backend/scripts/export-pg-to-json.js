// Private consistent JSON export. Native pg_dump plus scan backup remains the recovery method.
require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '../..');
const tables = ['offices','document_types','users','documents','transmissions','archives','devices','device_events','notifications','sender_notifications','commands','logs'];
const main = async () => {
  const directory = path.join(root, 'database-export', 'private-json-' + new Date().toISOString().replace(/[:.]/g, '-'));
  execFileSync('git', ['check-ignore', path.join(directory, 'users.json')], { cwd: root, stdio: 'ignore' });
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const counts = {};
    for (const table of tables) {
      const { rows } = await client.query(`SELECT * FROM "${table}"`);
      await fs.writeFile(path.join(directory, table + '.json'), JSON.stringify(rows), { flag: 'wx', mode: 0o600 });
      counts[table] = rows.length;
    }
    await client.query('COMMIT');
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), tables: counts, private: true, includesFiles: false }), { flag: 'wx', mode: 0o600 });
    console.log('Private export complete: ' + directory);
    console.log('Keep this directory out of Git. It does not replace a verified database-and-scan backup.');
  } finally { await client.end(); }
};
if (require.main === module) main().catch(() => { console.error('Private export failed; incomplete output must not be treated as a verified backup.'); process.exitCode = 1; });
module.exports = { main };
