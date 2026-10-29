const fs = require('node:fs');
const path = require('node:path');
const requireTestWrite = (databaseUrl, args) => {
  const name = new URL(databaseUrl).pathname;
  if (!/^\/[a-z0-9_]+_test(?:_[a-z0-9_]+)?$/i.test(name) || !args.includes('--apply')) throw new Error('This operation requires --apply and a separately named disposable _test database.');
};
const requireMaintenanceWrite = (databaseUrl, args) => {
  if (!databaseUrl || !args.includes('--apply')) throw new Error('Review the target and pass --apply for schema changes.');
  if (/_test(?:_|$)/.test(new URL(databaseUrl).pathname)) return;
  const backup = args[args.indexOf('--backup') + 1];
  const privateRoot = path.resolve(__dirname, '../../database-export');
  const resolved = backup && path.resolve(backup);
  if (!args.includes('--allow-live') || !args.includes('--backup') || !resolved || !resolved.startsWith(privateRoot + path.sep)
    || path.extname(resolved) !== '.dump' || !fs.existsSync(resolved) || fs.statSync(resolved).size === 0) throw new Error('Live schema work requires a coordinated write pause, --allow-live and --backup pointing to a verified private PostgreSQL dump.');
};
module.exports = { requireTestWrite, requireMaintenanceWrite };
