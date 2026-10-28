import { parentPort } from 'node:worker_threads';

// Exercise the actual browser worker handler in a real background thread.
globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
await import('../src/workers/reportPdf.worker.js');
parentPort.on('message', (data) => self.onmessage({ data }));
