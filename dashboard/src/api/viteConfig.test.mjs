import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDashboardConfig } from '../../vite.config.js';

test('Vite reads proxy targets from .env and honors process overrides for API, WS and uploads', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'digipath-vite-'));
  const previous = process.env.VITE_BACKEND_PROXY_TARGET;
  delete process.env.VITE_BACKEND_PROXY_TARGET;
  try {
    await writeFile(path.join(directory, '.env'), 'VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:5511\n');
    const configured = createDashboardConfig('test', directory);
    for (const route of ['/api', '/ws', '/uploads']) assert.equal(configured.server.proxy[route].target, 'http://127.0.0.1:5511');
    assert.equal(configured.server.proxy['/ws'].ws, true);
    process.env.VITE_BACKEND_PROXY_TARGET = 'http://127.0.0.1:5512';
    assert.equal(createDashboardConfig('test', directory).server.proxy['/api'].target, 'http://127.0.0.1:5512');
  } finally {
    if (previous === undefined) delete process.env.VITE_BACKEND_PROXY_TARGET;
    else process.env.VITE_BACKEND_PROXY_TARGET = previous;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('digipath-vite-'));
    await rm(directory, { recursive: true });
  }
});
