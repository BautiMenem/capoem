const fs = require('fs');
const path = require('path');
const excelIO = require('./excelIO');
const rockauto = require('./rockauto');

function parseArgs(argv) {
  const args = { headless: true, delayMin: 2000, delayMax: 4000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--cache') args.cache = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--headed') args.headless = false;
    else if (a === '--delay-min') args.delayMin = parseInt(argv[++i], 10);
    else if (a === '--delay-max') args.delayMax = parseInt(argv[++i], 10);
    else if (a === '--debug') args.debugDir = path.join(__dirname, '..', 'debug');
  }
  if (!args.input) throw new Error('Falta --input <ruta al xlsx de entrada>');
  args.output = args.output || path.join(__dirname, '..', 'output', 'MASTER_PRICE_resultado.xlsx');
  args.cache = args.cache || path.join(__dirname, '..', 'cache', 'cache.json');
  return args;
}

function loadCache(cachePath) {
  if (fs.existsSync(cachePath)) {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(cachePath, 'utf8'))));
  }
  return new Map();
}

function saveCache(cachePath, cache) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const obj = Object.fromEntries(cache.entries());
  fs.writeFileSync(cachePath, JSON.stringify(obj, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  return min + Math.random() * (max - min);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Leyendo catalogo: ${args.input}`);
  const { workbook, sheet } = await excelIO.loadWorkbook(args.input);
  const { rows, multiCode, empty, lastDataRow } = excelIO.extractRows(sheet);
  const codes = excelIO.uniqueCodes(rows);

  console.log(`Filas de datos: hasta la fila ${lastDataRow}`);
  console.log(`  Filas con codigo unico a buscar: ${rows.length}`);
  console.log(`  Filas con multiples codigos (se dejan vacias): ${multiCode.length}`);
  console.log(`  Filas sin codigo Continental (se dejan vacias): ${empty.length}`);
  console.log(`  Codigos unicos a buscar en RockAuto: ${codes.length}`);

  const cache = loadCache(args.cache);
  const pending = codes.filter((c) => !cache.has(c));
  const toProcess = args.limit ? pending.slice(0, args.limit) : pending;
  console.log(`  Ya en cache: ${codes.length - pending.length}`);
  console.log(`  A procesar ahora: ${toProcess.length}${args.limit ? ` (limite --limit ${args.limit})` : ''}`);

  if (toProcess.length > 0) {
    const { browser, context } = await rockauto.launchBrowser({ headless: args.headless });
    const page = await rockauto.openSearchPage(context);

    let processed = 0;
    let found = 0;
    let notFound = 0;
    let ambiguous = 0;
    let errors = 0;

    for (const code of toProcess) {
      const result = await rockauto.searchContinentalPart(page, code, { debugDir: args.debugDir });
      cache.set(code, result);
      processed++;
      if (result.found) found++;
      else if (result.error === 'NOT_FOUND') notFound++;
      else if (result.error === 'NO_EXACT_MATCH') ambiguous++;
      else errors++;

      const status = result.found
        ? `OK (${result.parts.length} numeros)`
        : `SIN RESULTADO (${result.error})`;
      console.log(`[${processed}/${toProcess.length}] ${code}: ${status}`);

      if (processed % 20 === 0) {
        saveCache(args.cache, cache);
        console.log(`  -- checkpoint guardado (${processed} procesados) --`);
      }

      await sleep(randomDelay(args.delayMin, args.delayMax));
    }

    saveCache(args.cache, cache);
    await browser.close();

    console.log('\nResumen de esta corrida:');
    console.log(`  Encontrados: ${found}`);
    console.log(`  Sin resultado en RockAuto: ${notFound}`);
    console.log(`  Ambiguos (varios resultados, ninguno matchea exacto - revisar a mano): ${ambiguous}`);
    console.log(`  Errores: ${errors}`);
  } else {
    console.log('No hay codigos pendientes por procesar (todo esta en cache o --limit ya se cumplio).');
  }

  console.log(`\nEscribiendo resultados en: ${args.output}`);
  const { written, notFound: notFoundInSheet } = excelIO.writeResults(sheet, rows, cache);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  await excelIO.saveWorkbook(workbook, args.output);
  console.log(`Listo. Celdas completadas: ${written}. Filas sin numero encontrado: ${notFoundInSheet}.`);

  const stillPending = codes.filter((c) => !cache.has(c));
  if (stillPending.length > 0) {
    console.log(`\nQuedan ${stillPending.length} codigos sin procesar. Volve a correr el mismo comando para continuar (usa el cache automaticamente).`);
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
