// Configuracion del catalogo maestro. Ajustar aca si cambia la estructura del Excel.
module.exports = {
  SHEET_NAME: 'Hoja1',
  HEADER_ROW: 3,
  DATA_START_ROW: 4,
  // Fila que marca el corte (todo lo que esta en o despues de esta fila se ignora).
  BOUNDARY_TEXT: 'PRODUCTS UNDER REVIEW',
  BOUNDARY_COLUMN: 'A',

  // Columna con el codigo Continental a buscar en RockAuto.
  COL_CONTINENTAL: 'E',
  // Columna destino donde se escribe el resultado (OEM / numeros de intercambio).
  // OJO: en la version "AUDITORIA FINAL CORREGIDA" del catalogo esta columna
  // paso de F a G (se movio el orden con P/N DAYCO). Si cambia el archivo,
  // verificar el header antes de correr - excelIO.validateHeaders() tira un
  // error si esta columna no dice "OEM Continental", como red de seguridad.
  COL_OEM_CONTINENTAL: 'G',

  // Fabricante a filtrar en la busqueda de RockAuto.
  MANUFACTURER: 'CONTINENTAL',

  ROCKAUTO_BASE_URL: 'https://www.rockauto.com/es/',

  // Separador usado al escribir varios numeros de intercambio en una celda.
  OUTPUT_SEPARATOR: ', ',
};
