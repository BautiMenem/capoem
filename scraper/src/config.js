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
  COL_OEM_CONTINENTAL: 'F',

  // Fabricante a filtrar en la busqueda de RockAuto.
  MANUFACTURER: 'CONTINENTAL',

  ROCKAUTO_BASE_URL: 'https://www.rockauto.com/es/',

  // Separador usado al escribir varios numeros de intercambio en una celda.
  OUTPUT_SEPARATOR: ', ',
};
