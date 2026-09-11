const { chromium } = require('playwright');
const config = require('./config');

// ---------------------------------------------------------------------------
// AVISO: estos selectores se armaron mirando capturas de pantalla del sitio,
// no pudimos probarlos en vivo porque este entorno no tiene salida de red a
// rockauto.com. Corre `npm run debug-one -- <codigo>` en tu maquina para
// validar el flujo con un codigo real (guarda screenshots + HTML/texto en
// scraper/debug/) y avisame que hay que ajustar si algo no matchea.
// ---------------------------------------------------------------------------

async function launchBrowser({ headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    locale: 'es-AR',
    viewport: { width: 1400, height: 1000 },
  });
  context.setDefaultTimeout(30000);
  return { browser, context };
}

async function openSearchPage(context) {
  const page = await context.newPage();
  await page.goto(config.ROCKAUTO_BASE_URL, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);
  return page;
}

async function dismissCookieBanner(page) {
  // El sitio suele mostrar un banner de cookies/consentimiento. Intenta
  // cerrarlo con los textos mas comunes; si no aparece, sigue de largo.
  const candidates = ['Aceptar', 'Aceptar todas', 'OK', 'Accept', 'Accept All'];
  for (const text of candidates) {
    try {
      const btn = page.getByRole('button', { name: text, exact: false }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ timeout: 1500 });
        return;
      }
    } catch {
      // ignorar y probar el siguiente
    }
  }
}

function looksBlocked(text) {
  const t = text.toLowerCase();
  return (
    t.includes('access denied') ||
    t.includes('unusual traffic') ||
    t.includes('please verify you are a human') ||
    t.includes('are you a robot') ||
    t.includes('403 forbidden')
  );
}

// Busca un numero de parte Continental usando el formulario "Busqueda de
// Numero de Repuesto" y devuelve { found, text, parts, multipleRowsFound, error }.
async function searchContinentalPart(page, code, { debugDir = null } = {}) {
  try {
    // Vuelve a la home si hicimos click en un link que navego afuera del catalogo.
    if (!page.url().includes('rockauto.com')) {
      await page.goto(config.ROCKAUTO_BASE_URL, { waitUntil: 'domcontentloaded' });
    }

    await selectPartNumberTab(page);
    await fillPartNumberField(page, code);
    await clickBuscar(page);

    // Espera a que aparezcan resultados o un mensaje de "no encontrado".
    await page.waitForTimeout(1500);
    const bodyText = await page.innerText('body').catch(() => '');
    if (looksBlocked(bodyText)) {
      return { found: false, error: 'BLOCKED', text: null, parts: [] };
    }

    const infoLinks = page.locator('a:has-text("Información"), a:has-text("Informacion")');
    const count = await infoLinks.count();
    if (count === 0) {
      if (debugDir) await saveDebug(page, debugDir, code, 'no-results');
      return { found: false, error: 'NOT_FOUND', text: null, parts: [] };
    }

    const rowIndex = await pickContinentalRowIndex(page, infoLinks, count);

    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 15000 }),
      infoLinks.nth(rowIndex).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(1000);

    const popupText = await popup.innerText('body').catch(() => '');
    if (debugDir) await saveDebug(popup, debugDir, code, 'info-popup');

    const parts = extractInterchangeNumbers(popupText);
    await popup.close();

    if (!parts || parts.length === 0) {
      return { found: false, error: 'NO_INTERCHANGE_SECTION', text: null, parts: [] };
    }

    return {
      found: true,
      text: parts.join(config.OUTPUT_SEPARATOR),
      parts,
      multipleRowsFound: count > 1,
      error: null,
    };
  } catch (err) {
    if (debugDir) {
      try {
        await saveDebug(page, debugDir, code, 'error');
      } catch {
        // ignorar fallas al guardar debug
      }
    }
    return { found: false, error: `EXCEPTION: ${err.message}`, text: null, parts: [] };
  }
}

async function selectPartNumberTab(page) {
  // La lengueta "Busqueda de Numero de Repuesto" suele estar activa por
  // default en la home, pero por las dudas intentamos clickearla.
  try {
    const tab = page.getByText('Búsqueda de Número de Repuesto', { exact: false }).first();
    if (await tab.isVisible({ timeout: 3000 })) {
      await tab.click({ timeout: 3000 });
    }
  } catch {
    // si no existe la lengueta (ya estamos en la vista correcta), seguimos
  }
}

async function fillPartNumberField(page, code) {
  // Busca el input de texto que esta en el mismo contenedor que la etiqueta
  // "Número de Repuesto". Si esa heuristica falla, usa el primer input de
  // texto visible en pantalla como ultimo recurso.
  const byLabel = page.locator(
    'xpath=//*[contains(text(), "Número de Repuesto") or contains(text(), "Numero de Repuesto")]/following::input[@type="text" or not(@type)][1]'
  );
  let input = byLabel.first();
  if (!(await input.isVisible({ timeout: 3000 }).catch(() => false))) {
    input = page.locator('input[type="text"]').first();
  }
  await input.click({ clickCount: 3 });
  await input.fill('');
  await input.type(String(code), { delay: 20 });
}

async function clickBuscar(page) {
  // Puede haber mas de un boton "Buscar" en la pagina (busqueda por numero
  // de parte y busqueda por palabra clave). Preferimos el que esta cerca
  // del campo que acabamos de llenar; si no, el primero visible.
  const nearField = page.locator(
    'xpath=//*[contains(text(), "Número de Repuesto") or contains(text(), "Numero de Repuesto")]/following::*[self::button or self::input][contains(@value,"Buscar") or contains(text(),"Buscar")][1]'
  );
  if (await nearField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nearField.click();
    return;
  }
  const anyBuscar = page.getByRole('button', { name: 'Buscar', exact: false }).first();
  await anyBuscar.click();
}

async function pickContinentalRowIndex(page, infoLinks, count) {
  if (count === 1) return 0;
  // Si hay varias filas, preferimos la primera que mencione CONTINENTAL.
  for (let i = 0; i < count; i++) {
    const row = infoLinks.nth(i).locator('xpath=ancestor::*[self::tr or self::div][1]');
    const text = await row.innerText().catch(() => '');
    if (text.toUpperCase().includes(config.MANUFACTURER)) {
      return i;
    }
  }
  return 0; // fallback: primera fila
}

function extractInterchangeNumbers(pageText) {
  const idx = pageText.search(/N[uú]meros?\s+de\s+Intercambio/i);
  if (idx === -1) return null;
  const after = pageText.slice(idx);
  const colonIdx = after.indexOf(':');
  if (colonIdx === -1) return null;
  let rest = after.slice(colonIdx + 1);
  const stopMatch = rest.search(/\n\s*\n/);
  if (stopMatch !== -1) rest = rest.slice(0, stopMatch);
  const firstLine = rest
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!firstLine) return null;
  return firstLine
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function saveDebug(page, debugDir, code, tag) {
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(debugDir, { recursive: true });
  const base = path.join(debugDir, `${code}-${tag}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
  } catch {
    // ignorar
  }
  try {
    const text = await page.innerText('body');
    fs.writeFileSync(`${base}.txt`, text);
  } catch {
    // ignorar
  }
}

module.exports = {
  launchBrowser,
  openSearchPage,
  searchContinentalPart,
  extractInterchangeNumbers,
};
