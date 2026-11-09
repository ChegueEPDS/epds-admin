const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSettings, planValues, catalogSelections } = require('../src/services/workFields');

const field = (id, type, extra) => ({ id, label: id, type, card: 'basic', ...extra });

test('entities and service types have separate tenant catalogs with stable archived selections', () => {
  const initial = { version: 0, fields: [] };
  const withEntity = buildSettings(initial, { version: 0, catalog: 'entities', entry: { label: 'Engineering' } });
  const config = buildSettings(withEntity, { version: 1, catalog: 'serviceTypes', entry: { label: 'Inspection' } });
  const entity = config.entities[0];
  const service = config.serviceTypes[0];
  const selections = { entityId: entity.id, serviceTypeId: service.id };
  assert.deepEqual(catalogSelections(config, {}, selections), selections);
  assert.throws(() => catalogSelections(initial, {}, selections), /for this tenant/);
  assert.throws(() => catalogSelections(config, {}, { entityId: service.id }), /available option/);
  assert.throws(() => buildSettings(config, { version: 2, catalog: 'entities', entry: { label: 'engineering' } }), /already exists/);
  const archived = buildSettings(config, { version: 2, catalog: 'entities', entry: { ...entity, archived: true } });
  assert.throws(() => catalogSelections(archived, {}, { entityId: entity.id }), /available option/);
  assert.deepEqual(catalogSelections(archived, selections, {}), selections);
  assert.deepEqual(catalogSelections(archived, selections, { entityId: '' }), { ...selections, entityId: null });
  const withField = buildSettings(archived, { version: 3, field: field('', 'text', { label: 'Reference' }) });
  assert.deepEqual(withField.entities, archived.entities);
  assert.deepEqual(withField.serviceTypes, archived.serviceTypes);
});

test('required fields follow the target card status and accept false and zero', () => {
  const fields = [field('invoice-check', 'boolean', { card: 'invoice', required: true }),
    field('units', 'integer', { required: true })];
  assert.deepEqual(planValues(fields, 'offer', {}, { units: 0 }).values, { units: 0 });
  assert.throws(() => planValues(fields, 'invoiced', {}, { units: 0 }), { statusCode: 422 });
  assert.deepEqual(planValues(fields, 'invoiced', {}, { units: 0, 'invoice-check': false }).values,
    { units: 0, 'invoice-check': false });
  assert.deepEqual(planValues(fields, 'offer', { 'invoice-check': false }, { units: 0 }).values,
    { units: 0, 'invoice-check': false });
  assert.throws(() => planValues(fields, 'offer', {}, { units: 0, 'invoice-check': false }), /unavailable/);
});

test('types are validated and file values can only be assigned by an upload', () => {
  const proof = '0d834afa-0ef7-4e35-8cc6-5422e066f532';
  const fields = [field('integer', 'integer'), field('decimal', 'decimal'), field('date', 'date'),
    field('money', 'amount'), field(proof, 'file', { required: true })];
  assert.throws(() => planValues(fields, 'offer', {}, { integer: 1.5 }), /invalid/);
  assert.throws(() => planValues(fields, 'offer', {}, { date: '2026-02-29' }), /invalid/);
  assert.throws(() => planValues(fields, 'offer', {}, { money: { amount: 15.555, currency: 'EUR' } }), /invalid/);
  assert.throws(() => planValues(fields, 'offer', {}, { [proof]: { id: 'copied' } }), /invalid/);
  const { values, uploads } = planValues(fields, 'offer', {}, {
    decimal: 1.5, date: '2028-02-29', money: { amount: 15.55, currency: 'EUR' }
  }, [{ fieldname: `file.${proof}`, originalname: '../proof.txt', size: 1, buffer: Buffer.from('x') }]);
  assert.deepEqual(values.money, { amount: 15.55, currency: 'EUR' });
  assert.equal(values[proof].name, '.._proof.txt');
  assert.equal(uploads.get(proof).toString(), 'x');
});

test('list edits keep old option IDs, reject new use of archived options and check settings versions', () => {
  const initial = { version: 0, fields: [] };
  const config = buildSettings(initial, { version: 0, field: field('', 'list', {
    label: 'Standards', multiple: true, options: [{ label: 'IEC' }, { label: 'ISO' }]
  }) });
  const saved = config.fields[0];
  const removed = saved.options[0].id;
  const updated = buildSettings(config, { version: 1, field: { ...saved, options: [saved.options[1]] } });
  assert.equal(updated.fields[0].options.find((option) => option.id === removed).archived, true);
  assert.throws(() => buildSettings(updated, { version: 1, field: saved }), { statusCode: 409 });
  assert.throws(() => planValues(updated.fields, 'offer', {}, { [saved.id]: [removed] }), /invalid/);
  assert.deepEqual(planValues(updated.fields, 'offer', { [saved.id]: [removed] }, { [saved.id]: [removed] }).values[saved.id], [removed]);
  assert.throws(() => planValues(updated.fields, 'offer', {}, { [saved.id]: ['other-tenant-option'] }), /invalid/);
});
