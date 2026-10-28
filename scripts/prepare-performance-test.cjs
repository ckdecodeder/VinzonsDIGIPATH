/* Private backups stay in the ignored database-export directory. Never print credentials. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dotenv = require('../backend/node_modules/dotenv');
const { Client } = require('../backend/node_modules/pg');
const testName = 'vinzons_digipath_perf_test_20261028';
const backup = path.join(root, 'database-export', 'performance-operation-2026-10-28');
const pgBin = process.env.DIGIPATH_PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin';

const hashFile = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const run = (program, args, env) => new Promise((resolve, reject) => {
  const child = spawn(path.join(pgBin, program), args, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  // PostgreSQL errors can contain connection details; do not relay them to logs.
  child.stderr.resume();
  child.on('error', () => reject(new Error(`${program} could not start`)));
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${program} failed (exit ${code})`)));
});
const portInUse = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' });
  socket.setTimeout(1000);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
const manifest = async (dir, relative = '') => {
  const result = [];
  for (const entry of await fs.readdir(path.join(dir, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await manifest(dir, name));
    else if (entry.isFile()) {
      const file = path.join(dir, name);
      result.push({ name, bytes: (await fs.stat(file)).size, sha256: await hashFile(file) });
    } else throw new Error('Non-regular file in scan storage; inspect before backing up');
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
};
const tableCounts = async (client) => {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const counts = {};
  for (const { tablename } of rows) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    counts[tablename] = (await client.query(`SELECT count(*)::int AS count FROM public.${quoted}`)).rows[0].count;
  }
  return counts;
};

async function main() {
  execFileSync('git', ['check-ignore', path.join(backup, 'database.dump')], { cwd: root, stdio: 'ignore' });
  if (await portInUse(5000)) throw new Error('API is active. Coordinate a write pause before creating a consistent backup.');
  const env = dotenv.parse(await fs.readFile(path.join(root, 'backend', '.env')));
  const source = new URL(env.DATABASE_URL);
  if (decodeURIComponent(source.pathname.slice(1)) === testName) throw new Error('Source database is already the test database');
  const privateEnv = {
    ...process.env, PGHOST: source.hostname, PGPORT: source.port || '5432',
    PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password),
    PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
  };
  // This operation targets the audited local PostgreSQL installation only.
  if (!['127.0.0.1', 'localhost'].includes(source.hostname)) throw new Error('Expected local source database');
  const live = new Client({ connectionString: source.href });
  await live.connect();
  try {
    const sessions = await live.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
    if (sessions.rows[0].count !== 0) throw new Error('Other database clients are connected. Coordinate the backup write pause first.');
    const exists = await live.query('SELECT 1 FROM pg_database WHERE datname=$1', [testName]);
    if (exists.rowCount) throw new Error('Test database already exists; inspect it instead of overwriting it');
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.mkdir(backup, { recursive: false });
    const scans = path.join(root, 'backend', 'uploads', 'scans');
    const before = await manifest(scans);
    await live.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const beforeCounts = await tableCounts(live);
    const snapshot = (await live.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    await run('pg_dump.exe', ['--format=custom', '--no-password', `--snapshot=${snapshot}`, '--file', path.join(backup, 'database.dump')], privateEnv);
    await live.query('COMMIT');
    await fs.cp(scans, path.join(backup, 'scans'), { recursive: true, errorOnExist: true, force: false });
    const copied = await manifest(path.join(backup, 'scans'));
    const after = await manifest(scans);
    if (JSON.stringify(before) !== JSON.stringify(copied) || JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Scan storage changed during backup; do not treat this backup as verified');
    }
    const configDir = path.join(backup, 'private-config');
    await fs.mkdir(configDir);
    for (const name of ['backend/.env', 'dashboard/.env', 'network.env', 'pi_ws_scanner.env', 'raspberry_pi/.env']) {
      try { await fs.copyFile(path.join(root, name), path.join(configDir, name.replaceAll('/', '__'))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await live.query(`CREATE DATABASE "${testName}"`);
    await run('pg_restore.exe', ['--exit-on-error', '--no-password', '--no-owner', '--no-privileges', '--dbname', testName, path.join(backup, 'database.dump')], privateEnv);
    const testUrl = new URL(source.href);
    testUrl.pathname = `/${testName}`;
    const testClient = new Client({ connectionString: testUrl.href });
    await testClient.connect();
    let restoredCounts;
    try { restoredCounts = await tableCounts(testClient); } finally { await testClient.end(); }
    const currentCounts = await tableCounts(live);
    if (JSON.stringify(beforeCounts) !== JSON.stringify(restoredCounts) || JSON.stringify(beforeCounts) !== JSON.stringify(currentCounts)) {
      throw new Error('Database counts changed or restore differs; inspect before continuing');
    }
    await fs.mkdir(path.join(backup, 'test-uploads'));
    await fs.cp(path.join(backup, 'scans'), path.join(backup, 'test-uploads', 'scans'), { recursive: true });
    const testEnv = {
      ...env, DATABASE_URL: testUrl.href, PORT: '5501', HOST: '127.0.0.1',
      PUBLIC_API_URL: 'http://127.0.0.1:5501',
      UPLOADS_ROOT: path.join(backup, 'test-uploads'),
      // A connected physical device must never authenticate to the test instance.
      DEVICE_API_KEY: crypto.randomBytes(32).toString('hex'),
      SENDER_NOTIFICATION_PROVIDER: 'outbox',
    };
    await fs.writeFile(path.join(backup, 'test-backend.env'), Object.entries(testEnv).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
    const evidence = {
      verifiedAt: new Date().toISOString(), testDatabase: testName,
      tables: restoredCounts, scanFiles: copied.length, scanBytes: copied.reduce((sum, file) => sum + file.bytes, 0),
      dumpSha256: await hashFile(path.join(backup, 'database.dump')),
      coordinatedState: 'No API listener on port 5000 and no other database clients before backup; file checksums and table counts unchanged afterward.',
      separateStorageBackup: 'Pending before live migration/cutover',
    };
    await fs.writeFile(path.join(backup, 'scan-manifest.json'), JSON.stringify(copied, null, 2));
    await fs.writeFile(path.join(backup, 'verification.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await live.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
