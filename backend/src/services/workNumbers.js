const { WorkItem } = require('../models/workItem');

const serviceTypeCodePattern = /^\p{L}{2,4}$/u;
const isServiceTypeCode = (code) => typeof code === 'string' && serviceTypeCodePattern.test(code);
const workNumberBase = (year, sequence) => `${String(year).slice(-2)}-${String(sequence).padStart(4, '0')}`;

function planWorkNumberUpdates(works, settings) {
  const codes = new Map(settings.serviceTypes.map(({ id, code }) => [id, code]));
  const changes = [];
  let missingCode = 0;
  let customFormat = 0;
  for (const work of works) {
    const { id, year, sequenceNumber, workNumber, serviceTypeId } = work;
    const base = workNumberBase(year, sequenceNumber);
    if (typeof workNumber !== 'string' || !workNumber.endsWith(base) ||
        (workNumber !== base && !isServiceTypeCode(workNumber.slice(0, -base.length)))) {
      customFormat++;
      continue;
    }
    const code = codes.get(serviceTypeId);
    if (settings.addServiceTypeCodeToWorkNumber && !isServiceTypeCode(code)) {
      missingCode++;
      continue;
    }
    const next = settings.addServiceTypeCodeToWorkNumber ? code + base : base;
    if (workNumber !== next) changes.push({ id, workNumber, serviceTypeId, next });
  }
  return { changes, missingCode, customFormat };
}

async function updatePostgresWorkNumbers(client, tenantId, settings) {
  const { rows } = await client.query(`SELECT id, year, sequence_number AS "sequenceNumber", work_number AS "workNumber",
    service_type_id::text AS "serviceTypeId" FROM work_items WHERE tenant_id=$1 ORDER BY id FOR UPDATE`, [tenantId]);
  const { changes, missingCode, customFormat } = planWorkNumberUpdates(rows, settings);
  const updated = changes.length ? (await client.query(`
    UPDATE work_items AS work SET work_number=change.next, field_revision=field_revision+1
    FROM jsonb_to_recordset($2::jsonb) AS change(id text, next text)
    WHERE work.tenant_id=$1 AND work.id=change.id`, [tenantId, JSON.stringify(changes)])).rowCount : 0;
  return { updated, missingCode, customFormat, concurrentChanges: 0 };
}

async function updateMongoWorkNumbers(tenantId, settings) {
  const works = WorkItem.find({ tenantId }).select('year sequenceNumber workNumber serviceTypeId').lean().cursor();
  const result = { updated: 0, missingCode: 0, customFormat: 0, concurrentChanges: 0 };
  for await (const batch of workBatches(works)) {
    const { changes, missingCode, customFormat } = planWorkNumberUpdates(batch, settings);
    result.missingCode += missingCode;
    result.customFormat += customFormat;
    if (!changes.length) continue;
    const { modifiedCount } = await WorkItem.bulkWrite(changes.map(({ id, workNumber, serviceTypeId, next }) => ({
      updateOne: {
        filter: { _id: id, tenantId, workNumber, serviceTypeId: serviceTypeId ?? null },
        update: { $set: { workNumber: next }, $inc: { __v: 1 } },
        timestamps: false
      }
    })));
    result.updated += modifiedCount;
    result.concurrentChanges += changes.length - modifiedCount;
  }
  return result;
}

async function* workBatches(cursor) {
  let batch = [];
  for await (const work of cursor) {
    batch.push({ ...work, id: work._id });
    if (batch.length === 500) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

module.exports = { isServiceTypeCode, workNumberBase, planWorkNumberUpdates, updatePostgresWorkNumbers, updateMongoWorkNumbers };
