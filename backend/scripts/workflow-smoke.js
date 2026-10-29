// Replaces the legacy live-record mutation smoke test.
try { require('./run-isolated-tests').run(['documentHandoffs.integration.test.js', 'auditRepairs.integration.test.js']); } catch { console.error('Set WORKFLOW_TEST_DATABASE_URL to the restored _test database and pass --apply. Live targets are refused.'); process.exitCode = 1; }
