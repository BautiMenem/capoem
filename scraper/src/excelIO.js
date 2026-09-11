const ExcelJS = require('exceljs');
const config = require('./config');

async function loadWorkbook(inputPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sheet = workbook.getWorksheet(config.SHEET_NAME);
  if (!sheet) {
    const names = workbook.worksheets.map((w) => w.name).join(', ');
    throw new Error(`No se encontro la hoja "${config.SHEET_NAME}". Hojas disponibles: ${names}`);
  }
  return { workbook, sheet };
}

// Busca la fila que contiene BOUNDARY_TEXT en BOUNDARY_COLUMN y devuelve el numero
// de la ultima fila de datos valida (la fila anterior al corte).
function findBoundaryRow(sheet) {
  let boundaryRow = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (boundaryRow) return;
    const cell = row.getCell(config.BOUNDARY_COLUMN);
    const value = cell.value;
    if (typeof value === 'string' && value.trim().toUpperCase() === config.BOUNDARY_TEXT) {
      boundaryRow = rowNumber;
    }
  });
  if (!boundaryRow) {
    throw new Error(`No se encontro el texto de corte "${config.BOUNDARY_TEXT}" en la columna ${config.BOUNDARY_COLUMN}.`);
  }
  return boundaryRow;
}

function cellText(cell) {
  if (cell == null) return null;
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object' && v.richText) {
    return v.richText.map((t) => t.text).join('').trim();
  }
  if (typeof v === 'object' && v.text) {
    return String(v.text).trim();
  }
  return String(v).trim();
}

// Devuelve las filas de datos clasificadas:
//  - rows: filas con un unico codigo Continental (aptas para buscar)
//  - multiCode: filas con varios codigos separados por "|" (se dejan sin tocar)
//  - empty: filas sin codigo Continental (se dejan sin tocar)
function extractRows(sheet) {
  const lastDataRow = findBoundaryRow(sheet) - 1;
  const rows = [];
  const multiCode = [];
  const empty = [];

  for (let r = config.DATA_START_ROW; r <= lastDataRow; r++) {
    const row = sheet.getRow(r);
    const raw = cellText(row.getCell(config.COL_CONTINENTAL));
    if (!raw || raw === '-' || raw === '—') {
      empty.push(r);
      continue;
    }
    if (raw.includes('|')) {
      multiCode.push({ row: r, raw });
      continue;
    }
    rows.push({ row: r, code: raw.trim() });
  }

  return { rows, multiCode, empty, lastDataRow };
}

function uniqueCodes(rows) {
  const set = new Set();
  for (const r of rows) set.add(r.code);
  return Array.from(set);
}

// Escribe los resultados encontrados en la columna destino.
// resultsMap: Map<code, { found: boolean, text: string }>
function writeResults(sheet, rows, resultsMap) {
  let written = 0;
  let notFound = 0;
  for (const { row, code } of rows) {
    const result = resultsMap.get(code);
    if (!result) continue; // no procesado (ej. limite de prueba)
    const cell = sheet.getRow(row).getCell(config.COL_OEM_CONTINENTAL);
    if (result.found && result.text) {
      cell.value = result.text;
      written++;
    } else {
      notFound++;
    }
  }
  return { written, notFound };
}

async function saveWorkbook(workbook, outputPath) {
  await workbook.xlsx.writeFile(outputPath);
}

module.exports = {
  loadWorkbook,
  findBoundaryRow,
  extractRows,
  uniqueCodes,
  writeResults,
  saveWorkbook,
};
