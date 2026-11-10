const assert = require('node:assert/strict');
const test = require('node:test');
const {
  checkStart, presentTask, setNetOverride, setStatus, startTimer, stopByUser
} = require('../src/services/effortTaskState');

const userId = 'user';
const at = (seconds) => new Date(seconds * 1000);
const task = (fields = {}) => ({ _id: 'task', projectId: 'project', status: 'new', sessions: [], ...fields });

test('legacy open tasks retain their measured time and map to the appropriate lane', () => {
  assert.equal(presentTask(task({ status: 'open' }), at(0), userId).status, 'new');
  const legacy = task({ status: 'open', archivedNetMs: 42000, archivedSessionCount: 1 });
  const result = presentTask(legacy, at(0), userId);
  assert.equal(result.status, 'in_progress');
  assert.equal(result.netMs, 42000);
});

test('a paused timer keeps its segments and a running timer is finalized on close', () => {
  const record = task();
  assert.throws(() => checkStart(record, userId), { statusCode: 409 });
  setStatus(record, 'in_progress', userId, at(1));
  startTimer(record, userId, at(2));
  assert.throws(() => stopByUser(record, 'someone-else', at(10), { pause: true }), { statusCode: 409 });
  stopByUser(record, userId, at(12), { pause: true });
  assert.equal(record.timerPaused, true);
  assert.equal(presentTask(record, at(30), userId).netMs, 10000);
  startTimer(record, userId, at(32));
  setStatus(record, 'closed', userId, at(36));
  const result = presentTask(record, at(50), userId);
  assert.equal(result.netMs, 14000);
  assert.equal(result.status, 'closed');
  assert.equal(result.active, false);
  assert.equal(result.timerPaused, false);
  assert.equal(result.sessionCount, 2);
});

test('corrections preserve measured time, record authors and add future work to the corrected total', () => {
  const record = task({ status: 'in_progress' });
  startTimer(record, userId, at(0));
  const update = { netOverrideMs: 30000, netOverrideReason: 'Review' };
  assert.throws(() => setNetOverride(record, update, at(40), userId), { statusCode: 409 });
  setStatus(record, 'closed', userId, at(42));
  assert.throws(() => setNetOverride(record, { netOverrideMs: 30000 }, at(43), userId), { statusCode: 400 });
  setNetOverride(record, update, at(43), userId, { firstName: 'Anna' });
  setNetOverride(record, update, at(44), userId, { firstName: 'Anna' });
  assert.equal(presentTask(record, at(44), userId).netMs, 30000);
  assert.deepEqual(record.netCorrections, [
    { userId, userName: 'Anna', at: at(43), reason: 'Review', previousMs: 42000, netMs: 30000 }
  ]);
  setStatus(record, 'in_progress', userId, at(45));
  startTimer(record, userId, at(46));
  stopByUser(record, userId, at(51), {});
  const result = presentTask(record, at(52), userId);
  assert.equal(result.measuredNetMs, 47000);
  assert.equal(result.netMs, 35000);
});
