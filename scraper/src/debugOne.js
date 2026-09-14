const path = require('path');
const rockauto = require('./rockauto');

// Corre una sola busqueda en modo visible (headed) y guarda screenshots +
// texto de cada paso en scraper/debug/, para validar (o corregir) los
// selectores de rockauto.js contra el sitio real.
//
// Uso: node scraper/src/debugOne.js 60432

async function main() {
  const code = process.argv[2];
  if (!code) {
    console.error('Uso: node scraper/src/debugOne.js <codigo-continental>');
    process.exit(1);
  }

  const debugDir = path.join(__dirname, '..', 'debug');
  const { browser, context } = await rockauto.launchBrowser({ headless: false });
  const page = await rockauto.openSearchPage(context);

  console.log(`Buscando codigo Continental ${code}...`);
  const result = await rockauto.searchContinentalPart(page, code, { debugDir });
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nRevisa las capturas y textos guardados en: ${debugDir}`);

  console.log('\nDejo el navegador abierto 30s para que puedas inspeccionar manualmente...');
  await page.waitForTimeout(30000);
  await browser.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
