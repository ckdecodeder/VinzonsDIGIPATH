// Explicit synthetic test password reset; no predictable account-derived passwords.
require('dotenv').config({ quiet: true });
const main = async () => {
  require('../utils/maintenanceGuard').requireTestWrite(process.env.DATABASE_URL, process.argv);
  if (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 12) throw new Error('Set a private synthetic SEED_ADMIN_PASSWORD of at least 12 characters.');
  const password = await require('bcryptjs').hash(process.env.SEED_ADMIN_PASSWORD, 10);
  const client = new (require('pg').Client)({ connectionString: process.env.DATABASE_URL });
  try { await client.connect(); const result = await client.query('UPDATE users SET password=$1', [password]); console.log(`Updated ${result.rowCount} disposable test accounts.`); }
  finally { await client.end(); }
};
if (require.main === module) main().catch(() => { console.error('Test password reset refused or failed. Verify the disposable test target, password, and --apply.'); process.exitCode = 1; });
module.exports = { main };
