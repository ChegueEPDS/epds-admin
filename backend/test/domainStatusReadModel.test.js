const test = require('node:test');
const assert = require('node:assert/strict');
const { reportEtag } = require('../src/services/domainStatusReadModelService');
const { mapWithConcurrency } = require('../src/services/scheduledJobLeaseService');
const { pdfEtag } = require('../src/services/domainStatusPdfCacheService');

test('domain status ETags are stable and change with report content', () => {
  const report = { owner: 'All', generatedAt: '2026-09-03T00:00:00.000Z', domains: [] };
  const first = reportEtag(report);
  const second = reportEtag({ ...report });
  const changed = reportEtag({ ...report, domains: [{ id: '1' }] });

  assert.match(first, /^"[A-Za-z0-9_-]+"$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('cached PDFs receive content-based stable ETags', () => {
  assert.equal(pdfEtag(Buffer.from('pdf')), pdfEtag(Buffer.from('pdf')));
  assert.notEqual(pdfEtag(Buffer.from('pdf')), pdfEtag(Buffer.from('other')));
});

test('bounded worker concurrency never exceeds its configured limit', async () => {
  let active = 0;
  let peak = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
});
