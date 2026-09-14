const excelIO = require('./excelIO');

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Uso: node scraper/src/inspect.js <ruta-al-xlsx>');
    process.exit(1);
  }

  const { sheet } = await excelIO.loadWorkbook(input);
  const { rows, multiCode, empty, lastDataRow } = excelIO.extractRows(sheet);
  const codes = excelIO.uniqueCodes(rows);

  console.log(`Ultima fila de datos valida: ${lastDataRow}`);
  console.log(`Filas con codigo unico Continental: ${rows.length}`);
  console.log(`Filas con multiples codigos (se dejan vacias): ${multiCode.length}`);
  console.log(`Filas sin codigo Continental (se dejan vacias): ${empty.length}`);
  console.log(`Codigos Continental unicos a buscar: ${codes.length}`);

  console.log('\nEjemplos de filas con multiples codigos (no se tocan):');
  multiCode.slice(0, 10).forEach((m) => console.log(`  fila ${m.row}: ${m.raw}`));

  console.log('\nPrimeros 10 codigos a buscar:');
  codes.slice(0, 10).forEach((c) => console.log(`  ${c}`));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
