const fs = require('node:fs');
const { parseArgs } = require('node:util');

const tenantByCompany = new Map([['1', 'epds'], ['6', 'ind-ex']]);
const rowsExpected = {
  epds: { work: 125, archivedWork: 14, subWork: 223, archivedSubWork: 13 },
  'ind-ex': { work: 99, archivedWork: 23, subWork: 126, archivedSubWork: 19 }
};
const text = (value) => String(value ?? '').trim();
const positiveId = (value) => /^[1-9]\d*$/.test(text(value));
const set = (value) => value != null && text(value) !== '';

function readTable(file, table) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${table}: expected phpMyAdmin JSON export`);
  const tables = raw.filter((item) => item?.type === 'table');
  if (tables.length !== 1 || tables[0].name !== table || !Array.isArray(tables[0].data)) {
    throw new Error(`${table}: export must contain exactly this table`);
  }
  return tables[0].data;
}

function byId(rows, table) {
  const result = new Map();
  for (const row of rows) {
    const id = text(row?.id);
    if (!positiveId(id) || result.has(id)) throw new Error(`${table}: invalid or duplicate source ID`);
    result.set(id, row);
  }
  return result;
}

function sourceNumber(row) {
  const year = text(row.year);
  const number = text(row.work_number);
  if (!/^\d{2}$/.test(year) || !/^\d{1,5}$/.test(number)) throw new Error(`Invalid Panda number on project ${text(row.id)}`);
  return `${year}-${number.padStart(4, '0')}`;
}

function groupRepeated(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const number = key(row);
    if (!grouped.has(number)) grouped.set(number, []);
    grouped.get(number).push(text(row.id));
  }
  return Array.from(grouped, ([number, sourceIds]) => ({ number, sourceIds })).filter((item) => item.sourceIds.length > 1);
}

function counts(rows) {
  return {
    rows: rows.length,
    archived: rows.filter((row) => set(row.deleted_at)).length,
    mixedCostCurrency: rows.filter((row) => set(row.cogs) && Number(row.cogs) !== 0 &&
      set(row.cogs_currency_id) && text(row.cogs_currency_id) !== text(row.income_currency_id)).length,
    hasInvoiceNumber: rows.filter((row) => set(row.invoice_number)).length,
    hasPaymentDate: rows.filter((row) => set(row.payment_date)).length,
    hasDocumentReference: rows.filter((row) => set(row.document)).length
  };
}

function preflight({ projects, subprojects, types, target = {}, compareSnapshot = false }) {
  const projectById = byId(projects, 'projects');
  const typeById = byId(types || [], 'types');
  for (const row of projects) {
    if (!tenantByCompany.has(text(row.company_id))) throw new Error(`Unapproved Panda company ID on project ${text(row.id)}`);
    sourceNumber(row);
  }
  const byTenant = new Map([...tenantByCompany.values()].map((tenant) => [tenant, []]));
  if (subprojects) {
    byId(subprojects, 'subprojects');
    for (const row of subprojects) {
      const parent = projectById.get(text(row.project_id));
      if (!parent) throw new Error(`Unscoped or missing parent for Panda subproject ${text(row.id)}`);
      byTenant.get(tenantByCompany.get(text(parent.company_id))).push(row);
    }
  }
  const report = {};
  for (const [company, tenant] of tenantByCompany) {
    const works = projects.filter((row) => text(row.company_id) === company);
    const children = byTenant.get(tenant);
    const typeMissing = (row) => set(row.type_id) && !typeById.has(text(row.type_id));
    const missingTypes = [...new Set(works.filter(typeMissing).map((row) => text(row.type_id)))];
    const prefixNumber = (row) => `${text(typeById.get(text(row.type_id))?.prefix)}${sourceNumber(row)}`;
    const existing = new Set((target[tenant] || []).map((value) => text(value).toLowerCase()));
    const targetConflicts = works.flatMap((row) => {
      const plain = sourceNumber(row);
      const full = prefixNumber(row);
      const numbers = [...new Set([plain, full])].filter((number) => existing.has(number.toLowerCase()));
      return numbers.length ? [{ sourceId: text(row.id), numbers }] : [];
    });
    const project = counts(works);
    const subproject = subprojects ? counts(children) : null;
    const expected = rowsExpected[tenant];
    const matchesSnapshot = !compareSnapshot ? null : project.rows === expected.work && project.archived === expected.archivedWork &&
      (!subproject || (subproject.rows === expected.subWork && subproject.archived === expected.archivedSubWork));
    report[tenant] = {
      project, subproject,
      repeatedUnprefixed: groupRepeated(works, sourceNumber),
      repeatedPandaNumber: missingTypes.length ? null : groupRepeated(works, prefixNumber),
      missingTypeIds: missingTypes, targetConflicts, matchesSnapshot
    };
  }
  return { projects: projects.length, subprojects: subprojects?.length ?? null, report };
}

function main() {
  const { values } = parseArgs({ options: {
    projects: { type: 'string' }, subprojects: { type: 'string' }, types: { type: 'string' },
    'target-numbers': { type: 'string' }, 'compare-live-snapshot': { type: 'boolean' }
  } });
  if (!values.projects) throw new Error('Supply --projects /path/to/projects.json');
  const result = preflight({
    projects: readTable(values.projects, 'projects'),
    subprojects: values.subprojects && readTable(values.subprojects, 'subprojects'),
    types: values.types && readTable(values.types, 'types'),
    target: values['target-numbers'] ? JSON.parse(fs.readFileSync(values['target-numbers'], 'utf8')) : {},
    compareSnapshot: values['compare-live-snapshot']
  });
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(result.report).some((tenant) => tenant.matchesSnapshot === false)) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { preflight };
