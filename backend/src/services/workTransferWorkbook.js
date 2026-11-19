const ExcelJS = require('exceljs');
const yauzl = require('yauzl');

const maxRows = 10000;
const maxWorkbookBytes = 10 * 1024 * 1024;
const maxZipBytes = 40 * 1024 * 1024;
const maxAttachmentBytes = 10 * 1024 * 1024;
const revisionKey = 'Export version';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });

async function visitZip(buffer, limit, visit) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, file) => {
    if (error) reject(error); else resolve(file);
  }));
  return new Promise((resolve, reject) => {
    let bytes = 0;
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', async (entry) => {
      try {
        bytes += entry.uncompressedSize;
        if (bytes > limit || zip.entryCount > maxRows) throw invalid('The archive is too large.');
        await visit(zip, entry);
        zip.readEntry();
      } catch (error) {
        zip.close();
        reject(error);
      }
    });
    zip.readEntry();
  });
}

async function readAttachments(buffer) {
  const files = new Map();
  if (!buffer) return files;
  try {
    await visitZip(buffer, maxZipBytes, async (zip, entry) => {
      if (entry.fileName.endsWith('/') || entry.fileName.startsWith('__MACOSX/')) return;
      const name = entry.fileName.normalize('NFC');
      if (files.has(name) || !entry.uncompressedSize || entry.uncompressedSize > maxAttachmentBytes) {
        throw invalid('Invalid, duplicate or oversized ZIP entry: ' + name);
      }
      const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, result) => {
        if (error) reject(error); else resolve(result);
      }));
      const chunks = [];
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > entry.uncompressedSize || bytes > maxAttachmentBytes) throw invalid('Oversized ZIP entry: ' + name);
        chunks.push(chunk);
      }
      files.set(name, Buffer.concat(chunks));
    });
  } catch (error) {
    throw error.statusCode ? error : invalid('The attachments ZIP could not be read.');
  }
  return files;
}

async function readWorkbook(buffer, sheetName = 'Works') {
  try {
    await visitZip(buffer, 80 * 1024 * 1024, () => {});
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet || sheet.rowCount > maxRows + 1 || sheet.columnCount > 200) {
      throw invalid(`Use the ${sheetName} sheet from the template with at most 10,000 data rows and 200 columns.`);
    }
    return { workbook, sheet };
  } catch (error) {
    throw error.statusCode ? error : invalid('The Excel workbook could not be read.');
  }
}

async function createWorkbook(columns, works, value, { sheetName = 'Works', instructions, language = 'en' } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [...columns.map(({ key, label, numFmt }) => ({
    key, header: label, width: Math.max(16, Math.min(label.length + 3, 40)), ...(numFmt ? { style: { numFmt } } : {})
  })),
    { key: 'revision', header: revisionKey, hidden: true }];
  const lists = workbook.addWorksheet('Lists');
  lists.state = 'veryHidden';
  const guide = workbook.addWorksheet(language === 'hu' ? 'Útmutató' : 'Instructions');
  guide.getColumn(1).width = 110;
  const workInstructionsHu = [
    'Meglévő munkánál tartsd meg az azonosítót és a rejtett exportverziót. Új munkánál mindkettőt hagyd üresen.',
    'Add meg a teljes évszámot és egy pozitív egész sorszámot. A dátumformátum YYYY-MM-DD.',
    'A kihagyott oszlopok értékei megmaradnak. A jelen lévő opcionális oszlopok üres cellái törlik az értéket vagy visszaállítják az alapértelmezést.',
    'Több értéket JSON-listaként vagy pontosvesszővel elválasztva adhatsz meg a tenant listájából.',
    'A mellékletekhez add meg a ZIP-en belüli útvonalat kis- és nagybetűhelyesen. A meglévő fájl megmarad, ha a fájlnév változatlan.'
  ];
  for (const line of instructions ?? (language === 'hu' ? workInstructionsHu : [
    'Keep the ID and hidden export version for existing works. Leave both empty for a new work.',
    'Enter the full year and a positive whole-number sequence. Dates use YYYY-MM-DD.',
    'Omitted columns keep existing values. Blank cells in included optional columns clear their values or apply the default.',
    'For multiple choices, use a JSON list of values from the tenant catalog or separate the values with semicolons.',
    'For attachments, enter the ZIP path (case-sensitive). Existing files are retained when their exported filename is unchanged.'
  ])) guide.addRow([line]);
  for (const entry of works) sheet.addRow(value(entry));
  let listColumn = 0;
  for (const column of columns) {
    if (!column.choices?.length) continue;
    const columnIndex = sheet.getColumn(column.key).number;
    listColumn++;
    lists.getColumn(listColumn).values = column.choices;
    const letter = lists.getColumn(listColumn).letter;
    const cell = sheet.getColumn(columnIndex).letter;
    const range = 'Lists!$' + letter + '$1:$' + letter + '$' + column.choices.length;
    const name = 'WorkImportList' + listColumn;
    workbook.definedNames.add(range, name);
    sheet.dataValidations.add(cell + '2:' + cell + (maxRows + 1), {
      type: 'list', allowBlank: true, formulae: [name], showErrorMessage: true, error: 'Select an available value.'
    });
  }
  sheet.getRow(1).fill = fill('FF20384E');
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.autoFilter = { from: 'A1', to: sheet.getCell(1, columns.length).address };
  return workbook.xlsx.writeBuffer();
}

const importNotesHu = {
  "Unknown or duplicate column. Use the current template.": "Ismeretlen vagy ismétlődő oszlop. Használd az aktuális sablont.",
  "Unknown or duplicate column. Use the current Clients template.": "Ismeretlen vagy ismétlődő oszlop. Használd az aktuális ügyfélsablont.",
  "Keep the ID, Year and Sequence number columns in A, B and C.": "Az ID, a Year és a Sequence number oszlop maradjon az A, B és C oszlopban.",
  "Keep the ID column in A.": "Az ID oszlop maradjon az A oszlopban.",
  "This work number occurs more than once in the file.": "Ez a munkaszám többször szerepel a fájlban.",
  "This ID occurs more than once in the file.": "Ez az azonosító többször szerepel a fájlban.",
  "There are no work rows to import.": "Nincs importálható munkasor.",
  "There are no client rows to import.": "Nincs importálható ügyfélsor.",
  "This tax number occurs more than once in the file.": "Ez az adószám többször szerepel a fájlban.",
  "This tax number belongs to another client.": "Ez az adószám másik ügyfélhez tartozik.",
  "This client changed or is no longer editable. Download a fresh export.": "Az ügyfél adatai megváltoztak, vagy már nem szerkeszthetők. Tölts le friss exportot.",
  "A client was added concurrently. Upload the workbook again.": "Eközben egy ügyfél hozzá lett adva. Töltsd fel újra a munkafüzetet.",
  "This ID does not identify a client linked to this tenant.": "Az azonosító nem ehhez a tenanthoz tartozó ügyfelet jelöl.",
  "This client changed or its export version is missing. Download a fresh export.": "Az ügyfél adatai megváltoztak, vagy az exportverzió hiányzik. Tölts le friss exportot.",
  "Keep the exported ID or use an empty template row.": "Tartsd meg az exportált azonosítót, vagy használj egy üres sablonsort.",
  "Enter a literal value without a formula.": "Képlet helyett közvetlen értéket adj meg.",
  "This client is shared with another tenant and cannot be edited here.": "Az ügyfél másik tenanttal is meg van osztva, ezért itt nem szerkeszthető.",
  "Tenant settings changed during validation. Upload the workbook again.": "Ellenőrzés közben megváltoztak a tenantbeállítások. Töltsd fel újra a munkafüzetet."
};

async function errorWorkbook(workbook, sheet, issues, language = 'en') {
  const affected = new Set(issues.map(({ row }) => row));
  for (const index of affected) {
    for (let col = 1; col <= sheet.columnCount; col++) sheet.getCell(index, col).fill = fill('FFFFE6E6');
  }
  const cells = new Map();
  for (const { row, col, message } of issues) {
    const cell = sheet.getCell(row, col);
    if (!cells.has(cell.address)) cells.set(cell.address, { cell, messages: new Set() });
    cells.get(cell.address).messages.add(language === 'hu' && Object.hasOwn(importNotesHu, message) ? importNotesHu[message] : message);
  }
  for (const { cell, messages } of cells.values()) {
    cell.fill = fill('FFFF7070');
    cell.note = [...messages].join('\n');
  }
  return workbook.xlsx.writeBuffer();
}

module.exports = { invalid, maxRows, maxWorkbookBytes, maxZipBytes, revisionKey, createWorkbook, readWorkbook, readAttachments, errorWorkbook };
