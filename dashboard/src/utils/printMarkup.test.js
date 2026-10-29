import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePrintMarkup } from './printMarkup.js';
test('attachment print titles cannot inject markup and sources cannot inject attributes', () => {
  const html = imagePrintMarkup('</title><script>alert("synthetic")</script>', 'blob:https://example.test/id');
  assert(!html.includes('<script>')); assert(html.includes('&lt;/title&gt;'));
  assert.throws(() => imagePrintMarkup('Scan', 'javascript:alert(1)'), /Invalid/);
  assert.throws(() => imagePrintMarkup('Scan', 'data:text/html,<script>'), /Invalid/);
  assert(imagePrintMarkup('Scan', 'blob:https://example.test/a" onerror="synthetic').includes('&quot; onerror=&quot;'));
});
