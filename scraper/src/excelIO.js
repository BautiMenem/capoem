const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const config = require('./config');

async function loadWorkbook(inputPath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(inputPath);
  } catch (err) {
    // Algunos xlsx (ej. generados con otras herramientas) usan un XML con
    // namespace prefijado (<x:workbook> en vez de <workbook>) que exceljs
    // no soporta, aunque el archivo es valido. SheetJS es mas tolerante:
    // lo usamos como fallback para leer los valores y reconstruimos un
    // workbook de exceljs equivalente, asi el resto del pipeline (que usa
    // la API de exceljs para escribir) sigue funcionando igual.
    console.warn(`Aviso: el lector principal no pudo abrir el archivo (${err.message}). Reintentando con un lector mas tolerante...`);
    return loadWorkbookViaFallback(inputPath);
  }
  const sheet = workbook.getWorksheet(config.SHEET_NAME);
  if (!sheet) {
    const names = workbook.worksheets.map((w) => w.name).join(', ');
    throw new Error(`No se encontro la hoja "${config.SHEET_NAME}". Hojas disponibles: ${names}`);
  }
  return { workbook, sheet };
}

function loadWorkbookViaFallback(inputPath) {
  const wb = XLSX.readFile(inputPath);
  const sheetName = wb.SheetNames.includes(config.SHEET_NAME) ? config.SHEET_NAME : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws['!ref']) {
    throw new Error(`No se pudo leer la hoja "${sheetName}" ni con el lector de respaldo.`);
  }
  const range = XLSX.utils.decode_range(ws['!ref']);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(config.SHEET_NAME);

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell === undefined || cell.v === undefined) continue;
      sheet.getRow(r + 1).getCell(c + 1).value = cell.v;
    }
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

// Red de seguridad: confirma que las columnas configuradas en config.js
// todavia apuntan a donde dicen apuntar. El orden de columnas del catalogo
// ya cambio una vez (P/N DAYCO y OEM Continental se intercambiaron) - sin
// esta validacion el script hubiera pisado datos reales de otra columna
// en silencio.
function validateHeaders(sheet) {
  const headerRow = sheet.getRow(config.HEADER_ROW);
  const contiHeader = (cellText(headerRow.getCell(config.COL_CONTINENTAL)) || '').toUpperCase();
  const oemHeader = (cellText(headerRow.getCell(config.COL_OEM_CONTINENTAL)) || '').toUpperCase();

  if (!contiHeader.includes('CONTINENTAL')) {
    throw new Error(
      `La columna ${config.COL_CONTINENTAL} (fila ${config.HEADER_ROW}) deberia ser "P/N CONTINENTAL" pero dice "${contiHeader}". ` +
        `El orden de columnas del Excel puede haber cambiado - revisa config.js antes de seguir.`
    );
  }
  if (!(oemHeader.includes('OEM') && oemHeader.includes('CONTINENTAL'))) {
    throw new Error(
      `La columna ${config.COL_OEM_CONTINENTAL} (fila ${config.HEADER_ROW}) deberia ser "OEM Continental" pero dice "${oemHeader}". ` +
        `El orden de columnas del Excel puede haber cambiado - revisa config.js antes de seguir (si escribimos aca podriamos pisar otra columna).`
    );
  }
}

// Devuelve las filas de datos clasificadas:
//  - rows: filas con un unico codigo Continental (aptas para buscar)
//  - multiCode: filas con varios codigos separados por "|" (se dejan sin tocar)
//  - empty: filas sin codigo Continental (se dejan sin tocar)
function extractRows(sheet) {
  validateHeaders(sheet);
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
