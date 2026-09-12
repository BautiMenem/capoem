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
  await dismissWelcomeModal(page);
  await dismissCookieBanner(page);
  return page;
}

// La home muestra un popup "¡Bienvenido!" (con un vehiculo de ejemplo y
// precios) que tapa el formulario de busqueda. Hay que cerrarlo antes de
// poder interactuar con la pagina.
async function dismissWelcomeModal(page) {
  try {
    const modal = page.getByText('¡Bienvenido!', { exact: false }).first();
    if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Boton de cierre "X" tipico de este modal: suele ser el unico link/
      // boton corto dentro del mismo contenedor que el titulo.
      const closeBtn = page.locator(
        'xpath=//*[contains(text(), "¡Bienvenido!")]/ancestor::*[self::div or self::table][1]//a[contains(@href,"javascript") or normalize-space(text())="X" or normalize-space(text())="x" or normalize-space(text())="×"]'
      ).first();
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeBtn.click({ timeout: 2000 });
        await page.waitForTimeout(300);
        return;
      }
      // Fallback: Escape suele cerrar modales tipo lightbox.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  } catch {
    // si no aparece el modal, seguimos de largo
  }
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
  // La home carga por default en la lengueta "Catalogo de Repuestos", asi
  // que siempre hay que clickear "Busqueda de Numero de Repuesto" para
  // llegar al formulario que necesitamos.
  try {
    const tab = page.getByText('Búsqueda de Número de Repuesto', { exact: false }).first();
    if (await tab.isVisible({ timeout: 3000 })) {
      await tab.click({ timeout: 3000 });
    }
  } catch {
    // si no existe la lengueta (ya estamos en la vista correcta), seguimos
  }
}

// El buscador universal de arriba tiene un placeholder largo y distintivo
// ("año fabricante modelo tipo de repuesto o número de repuesto..."). Lo
// usamos para identificarlo y excluirlo explicitamente, en vez de confiar
// en encontrar la etiqueta correcta del campo por texto (eso fallo dos
// veces: el XPath por texto terminaba enganchando el input equivocado).
const TOP_SEARCH_PLACEHOLDER_HINTS = ['año fabricante', 'ano fabricante', 'modelo'];

async function isTopUniversalSearchInput(el) {
  const placeholder = ((await el.getAttribute('placeholder').catch(() => '')) || '').toLowerCase();
  return TOP_SEARCH_PLACEHOLDER_HINTS.some((hint) => placeholder.includes(hint));
}

async function fillPartNumberField(page, code) {
  const textInputs = page.locator('input[type="text"], input:not([type])');
  const count = await textInputs.count();
  let target = null;

  for (let i = 0; i < count; i++) {
    const el = textInputs.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    if (await isTopUniversalSearchInput(el)) continue; // saltea el buscador de arriba
    target = el;
    break;
  }

  if (!target) {
    throw new Error('No se encontro el campo "Número de Repuesto" (solo aparecio el buscador universal de arriba).');
  }

  await target.click({ clickCount: 3 });
  await target.fill('');
  await target.type(String(code), { delay: 20 });
}

async function clickBuscar(page) {
  // El boton "Buscar" del formulario (distinto del icono de lupa del
  // buscador de arriba, que no tiene texto "Buscar").
  const byRole = page.getByRole('button', { name: 'Buscar', exact: false }).first();
  if (await byRole.isVisible({ timeout: 3000 }).catch(() => false)) {
    await byRole.click();
    return;
  }
  const byValue = page.locator('input[value="Buscar"], input[value*="Buscar"]').first();
  await byValue.click();
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
