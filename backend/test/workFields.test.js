const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSettings, planValues, catalogSelections, workNumberPrefix } = require('../src/services/workFields');
const { planWorkNumberUpdates } = require('../src/services/workNumbers');

const field = (id, type, extra) => ({ id, label: id, type, card: 'basic', ...extra });

test('a layout saves multiple cards, new fields and table defaults under one settings version', () => {
  const initial = { version: 5, fields: [] };
  const key = 'new:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const layout = {
    fields: [{ key, field: field('', 'text', { label: 'Reference' }) }],
    orders: { basic: [key, 'name'], offer: ['deadline', 'currency'] },
    hidden: [key, 'deadline'],
    columns: { [key]: true, responsible: false }
  };
  const saved = buildSettings(initial, { version: 5, layout });
  const [created] = saved.fields;
  assert.equal(saved.version, 6);
  assert.deepEqual(saved.fieldOrder, { basic: [created.id, 'name'], offer: ['deadline', 'currency'] });
  assert.deepEqual(saved.hiddenFields, [created.id, 'deadline']);
  assert.deepEqual(saved.columnVisibility, { [created.id]: true, responsible: false });
  assert.throws(() => buildSettings(initial, { version: 5, layout: { ...layout, hidden: ['currency'] } }), { statusCode: 400 });
  assert.throws(() => buildSettings(initial, { version: 5, layout: { ...layout, columns: { foreign: true } } }), { statusCode: 400 });
  assert.deepEqual(initial, { version: 5, fields: [] });
});

test('card visibility protects required fields and preserves other cards when saving', () => {
  const optional = field('reference', 'text', { multiple: false });
  const required = field('approval', 'boolean', { required: true });
  const initial = { version: 0, fields: [optional, required], hiddenFields: ['deadline'] };
  const update = (hidden) => ({
    version: 0, fieldOrder: { card: 'basic', order: ['client', 'reference', 'name'], hidden }
  });
  for (const id of ['name', 'status', 'approval', 'deadline', 'foreign-field']) {
    assert.throws(() => buildSettings(initial, update([id])), { statusCode: 400 });
  }
  const saved = buildSettings(initial, update(['client', 'reference']));
  assert.deepEqual(saved.hiddenFields, ['deadline', 'client', 'reference']);
  assert.deepEqual(saved.fieldOrder.basic, ['client', 'reference', 'name']);
  const reset = buildSettings(saved, { version: 1, fieldOrder: { card: 'basic', order: [] } });
  assert.deepEqual(reset.hiddenFields, saved.hiddenFields);
  const madeRequired = buildSettings(reset, { version: 2, field: { ...optional, required: true } });
  assert.deepEqual(madeRequired.hiddenFields, ['deadline', 'client']);
});

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

test('work numbering prefixes use the active service type code when enabled', () => {
  const initial = { version: 0, fields: [], serviceTypes: [{ id: 'legacy', label: 'Legacy', archived: false }] };
  const addService = (code) => buildSettings(initial, {
    version: 0, catalog: 'serviceTypes', entry: { label: 'Inspection', code }
  });
  for (const code of ['I', 'INSPE', 'IN5', 'I-S', 'ß', 'ßABC']) {
    assert.throws(() => addService(code), { statusCode: 400 });
  }
  for (const code of ['in', 'insp']) {
    const saved = addService(code);
    const service = saved.serviceTypes[1];
    assert.equal(workNumberPrefix({ ...saved, addServiceTypeCodeToWorkNumber: true }, service.id), code.toUpperCase());
  }
  const catalog = addService(' ko\u0301d ');
  const service = catalog.serviceTypes[1];
  assert.equal(service.code, 'KÓD');
  assert.equal(workNumberPrefix(catalog, service.id), '');
  const enabled = buildSettings(catalog, { version: 1, addServiceTypeCodeToWorkNumber: true });
  assert.equal(workNumberPrefix(enabled, service.id), 'KÓD');
  for (const id of [undefined, 'legacy', 'other-tenant']) {
    assert.throws(() => workNumberPrefix(enabled, id), { statusCode: 422 });
  }
  const archived = buildSettings(enabled, { version: 2, catalog: 'serviceTypes',
    entry: { id: service.id, label: service.label, archived: true } });
  assert.equal(archived.serviceTypes[1].code, 'KÓD');
  assert.throws(() => workNumberPrefix(archived, service.id), { statusCode: 422 });
  const disabled = buildSettings(archived, { version: 3, addServiceTypeCodeToWorkNumber: false });
  assert.equal(workNumberPrefix(disabled, null), '');
});

test('existing work numbers retain their sequence when a prefix is added, replaced or removed', () => {
  const settings = { serviceTypes: [{ id: 'inspection', code: 'KÓD', archived: true }], addServiceTypeCodeToWorkNumber: true };
  const work = (id, sequenceNumber, workNumber, serviceTypeId = 'inspection') => ({
    id, year: 2026, sequenceNumber, workNumber, serviceTypeId
  });
  const works = [
    work('old', 1, '26-0001'), work('stale', 2, 'IN26-0002'), work('current', 3, 'KÓD26-0003'),
    work('missing', 4, '26-0004', null), work('custom', 5, 'EXT-2026-5'), work('long', 12345, 'INSP26-12345')
  ];
  const enabled = planWorkNumberUpdates(works, settings);
  assert.deepEqual(enabled.changes.map(({ next }) => next), ['KÓD26-0001', 'KÓD26-0002', 'KÓD26-12345']);
  assert.equal(enabled.missingCode, 1);
  assert.equal(enabled.customFormat, 1);
  const replacements = new Map(enabled.changes.map(({ id, next }) => [id, next]));
  const updated = works.map((item) => ({ ...item, workNumber: replacements.get(item.id) ?? item.workNumber }));
  assert.deepEqual(planWorkNumberUpdates(updated, settings).changes, []);
  const disabled = planWorkNumberUpdates(works, { ...settings, addServiceTypeCodeToWorkNumber: false });
  assert.deepEqual(disabled.changes.map(({ next }) => next), ['26-0002', '26-0003', '26-12345']);
  assert.equal(disabled.missingCode, 0);
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
