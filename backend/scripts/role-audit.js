// Role/access regressions use synthetic accounts and disposable database schemas.
try { require('./run-isolated-tests').run(['securityRepairs.test.js', 'auditRepairs.integration.test.js']); } catch { console.error('Set WORKFLOW_TEST_DATABASE_URL to the restored _test database and pass --apply. Live targets are refused.'); process.exitCode = 1; }
