const Excel = require('exceljs');
const yauzl = require('yauzl');
const { date, cents, currencies, fail } = require('./projectTrackerDomain');

const sourceStatuses = {
  'to be confirmed': 'offer', 'to start': 'to_start', ongoing: 'in_progress', 'on hold': 'on_hold',
  completed: 'completed_billable', cancelled: 'cancelled', lost: 'lost'
};

function checkArchive(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) return reject(openError);
      let size = 0;
      const names = new Set();
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        size += entry.uncompressedSize;
        if (zip.entryCount > 300 || size > 24000000 || names.has(entry.fileName) ||
          entry.generalPurposeBitFlag & 1 || /(?:vbaProject|externalLinks|embeddings)/i.test(entry.fileName)) {
          zip.close();
          return reject(new Error('Unsupported or oversized workbook contents'));
        }
        names.add(entry.fileName);
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error) { zip.close(); reject(error); return; }
          stream.on('error', (streamError) => { zip.close(); reject(streamError); });
          stream.on('end', () => zip.readEntry());
          stream.resume();
        });
      });
      zip.readEntry();
    });
  });
}
function value(cell) {
  const input = cell.value;
  if (input instanceof Date || input == null || typeof input !== 'object') return input;
  if (input.hyperlink) return input.hyperlink;
  if (Array.isArray(input.richText)) return input.richText.map((part) => part.text).join('');
  return null;
}
const text = (cell, max = 500) => String(value(cell) ?? '').trim().slice(0, max);
function day(cell) {
  const raw = value(cell);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'string' && raw.trim()) return date(raw.trim());
  if (raw != null) fail('Expected an Excel date');
  return null;
}
function money(cell) {
  const raw = value(cell);
  return raw == null || raw === '' ? null : cents(raw) / 100;
}

async function readWorkbook(buffer) {
  let book;
  try {
    await checkArchive(buffer);
    book = new Excel.Workbook();
    await book.xlsx.load(buffer, { ignoreNodes: ['drawing', 'picture', 'extLst', 'conditionalFormatting', 'dataValidations'] });
  } catch {
    fail('Select a valid, unencrypted .xlsx workbook within the upload limits');
  }
  const tracker = book.getWorksheet('Tracker');
  if (!tracker || tracker.getCell('C4').text !== 'Project / Scope' || tracker.getCell('L4').text !== 'PO No.') fail('The Tracker sheet does not match the supported Project Tracker template');
  if (tracker.rowCount > 2000 || tracker.columnCount > 100) fail('The Tracker sheet exceeds the import limits');
  const seen = new Set();
  const rows = [];
  for (let index = 5; index <= tracker.rowCount; index++) {
    const row = tracker.getRow(index);
    const cell = (column) => row.getCell(column);
    const name = text(cell('C'), 250);
    if (!name) continue;
    const no = text(cell('A'), 40);
    if (!no || seen.has(no)) fail(`Row ${index} needs a unique No. value`);
    seen.add(no);
    try {
      const status = sourceStatuses[text(cell('G')).toLowerCase()];
      if (!status) fail('Unknown status');
      const currency = text(cell('N')).toUpperCase();
      if (currency && !currencies.includes(currency)) fail('Unknown currency');
      const amount = money(cell('M'));
      const invoiced = money(cell('P'));
      const paid = money(cell('S'));
      const paymentStatus = text(cell('O'), 80);
      const checks = [];
      if (!currency && [amount, invoiced, paid].some((entry) => entry != null)) checks.push('Amount without currency');
      if (status === 'in_progress' && !value(cell('X'))) checks.push('Missing delivery deadline');
      if (['Paid', 'Partially Paid'].includes(paymentStatus) && paid == null) checks.push('Reported payment has no paid amount');
      if (paymentStatus === 'Not Invoiced' && invoiced > 0) checks.push('Payment status contradicts invoiced amount');
      if (paymentStatus === 'Paid' && paid != null && invoiced != null && paid !== invoiced) checks.push('Reported payment does not match the invoice total');
      if (text(cell('Z')) && (!text(cell('AA')) || !value(cell('AB')))) checks.push('Next action needs an owner or date');
      rows.push({ no, row: index, name, status, currency, amount, invoiced, paid, paymentStatus, checks,
        client: text(cell('B')), group: text(cell('D')), service: text(cell('E')), unit: text(cell('F')),
        owner: text(cell('I')), backup: text(cell('J')), priority: text(cell('K')), po: text(cell('L'), 120),
        invoiceDate: day(cell('Q')), paymentDue: day(cell('R')), start: day(cell('W')), deadline: day(cell('X')),
        action: text(cell('Z')), actionOwner: text(cell('AA')), actionDue: day(cell('AB')), reviewed: day(cell('AC')),
        sharepoint: text(cell('AF'), 2000), remarks: text(cell('AH'), 10000) });
    } catch (error) {
      fail(`Tracker row ${index}: ${error.message}`);
    }
  }
  if (!rows.length) fail('The workbook has no populated project rows');
  const sheet = book.getWorksheet('Open Questions');
  if (sheet && sheet.rowCount > 1000) fail('The Open Questions sheet exceeds the import limit');
  const issues = [];
  const issueNumbers = new Set();
  for (let index = 5; sheet && index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const no = text(row.getCell('A'), 40);
    if (!no) continue;
    if (issueNumbers.has(no)) fail('Open Questions requires unique row numbers');
    issueNumbers.add(no);
    issues.push({ no, project: text(row.getCell('B'), 250), finding: text(row.getCell('C'), 2000),
      action: text(row.getCell('D'), 3000), ask: text(row.getCell('E'), 250), closed: text(row.getCell('F')).toLowerCase() === 'closed' });
  }
  return { rows, issues };
}

async function exportWorkbook(rows, config, groups, users, issues) {
  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet('Projects', { views: [{ state: 'frozen', ySplit: 1 }] });
  const fields = config.fields.filter((field) => field.target === 'work' && field.locations.some((location) => location.startsWith('tracker')));
  const userName = (id) => users.find((user) => user.id === id)?.name || '';
  const fieldValue = (row, field) => {
    const value = row.custom[field.id];
    if (field.type === 'user') return userName(value);
    const label = (id) => field.options.find((option) => option.id === id)?.name || id;
    if (field.type === 'select') return label(value);
    if (field.type === 'multiSelect') return (value || []).map(label).join(', ');
    return value;
  };
  sheet.addRow(['Work number', 'Client', 'Scope', 'Project group', 'Service type', 'Unit', 'Status', 'Stage',
    'Owner', 'Backup', 'Priority', 'PO number', 'Amount', 'Currency', 'Payment status', 'Invoiced', 'Invoice date', 'Payment due', 'Paid',
    'Receivable', 'Not yet invoiced', 'Value (EUR eq.)', 'Start date', 'Deadline', 'Deadline status', 'Next action', 'Action owner',
    'Action due', 'Last review', 'Days since review', 'Data checks', 'Project size', ...fields.map((field) => field.label)]);
  for (const row of rows) sheet.addRow([row.workNumber, row.customer || row.sourceClient, row.name,
    groups.find((group) => group.id === row.groupId)?.data.name, config.services.find((service) => service.id === row.serviceId)?.name,
    config.units.find((unit) => unit.id === row.unitId)?.name, row.status, row.stage, userName(row.responsibleUserId),
    userName(row.backupId), row.priority, row.po, row.value, row.currency, row.payment.status, row.payment.invoiced,
    row.payment.lastInvoiceDate, row.payment.nextPaymentDue, row.payment.paid, row.payment.receivable, row.payment.unbilled, row.eur, row.start, row.deadline, row.deadlineState, row.action?.title,
    userName(row.action?.ownerId), row.action?.due, row.reviewed, row.daysSinceReview, row.checks.join(' / '), row.size,
    ...fields.map((field) => fieldValue(row, field))]);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  const questions = workbook.addWorksheet('Open Questions');
  questions.addRow(['Work number', 'Question', 'Description', 'Owner', 'Status']);
  for (const issue of issues) questions.addRow([rows.find((row) => row.id === issue.data.workId)?.workNumber,
    issue.data.title, issue.data.description, userName(issue.data.ownerId), issue.data.closed ? 'Closed' : 'Open']);
  for (const tab of workbook.worksheets) {
    tab.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    tab.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19334B' } };
    for (const column of tab.columns) column.width = 24;
    tab.getColumn(3).width = 48;
  }
  return workbook;
}
module.exports = { readWorkbook, exportWorkbook };
