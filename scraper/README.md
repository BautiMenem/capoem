# Scraper RockAuto → OEM Continental

Automatiza la carga de la columna **"OEM Continental"** del catálogo maestro
(`MASTER_PRICE...xlsx`), buscando cada código Continental en RockAuto y
copiando los "Números de Intercambio" que aparecen en su ficha de
información.

## Qué hace exactamente

- Lee la hoja `Hoja1`, filas desde la 4 hasta la fila anterior a
  `PRODUCTS UNDER REVIEW` (columna A).
- Para cada fila con **un único código** en la columna `P/N CONTINENTAL` (E):
  busca ese código en RockAuto y escribe los números de intercambio en la
  columna `OEM Continental` (F).
- Las filas con **varios códigos separados por `|`** y las filas **sin
  código Continental** se dejan sin tocar (se cargan a mano después).
- Cada código único se busca **una sola vez** aunque se repita en varias
  filas del catálogo (se reutiliza el resultado).
- Guarda un archivo de caché (`scraper/cache/cache.json`) después de cada 20
  búsquedas, así si se corta a mitad de camino podés volver a correr el
  mismo comando y sigue donde quedó, sin repetir búsquedas ya hechas.

## Instalación (una sola vez, en tu máquina)

```bash
npm install
npx playwright install chromium
```

## 1. Validar el flujo contra el sitio real (importante)

Este proyecto se armó sin poder probar contra rockauto.com en vivo (el
entorno donde se escribió el código no tiene salida a internet hacia ese
sitio). Antes de correr los 1500 productos, probá un solo código en modo
visible:

```bash
npm run debug-one -- 60432
```

Esto abre Chrome visible, hace la búsqueda completa y guarda en
`scraper/debug/`:
- capturas de pantalla de cada paso
- el texto completo de la página de "Información"

Revisá la consola: si dice `"found": true` y te muestra los números de
intercambio correctos, el flujo está andando bien. Si falla en algún paso
(no encuentra el campo de búsqueda, no encuentra el botón "Buscar", etc.),
mandame:
- el error que tiró
- las capturas guardadas en `scraper/debug/`

y ajusto los selectores en `scraper/src/rockauto.js`.

## 2. Ver estadísticas del archivo (no toca internet)

```bash
node scraper/src/inspect.js "/ruta/a/MASTER_PRICE__revision_catalogo.xlsx"
```

Te muestra cuántas filas tienen código único, cuántas se van a dejar vacías,
y la lista de códigos múltiples que quedan afuera.

## 3. Correr una prueba chica (ej. 10 códigos)

```bash
node scraper/src/run.js --input "/ruta/a/MASTER_PRICE__revision_catalogo.xlsx" --limit 10
```

Esto procesa 10 códigos, guarda el resultado parcial en
`scraper/output/MASTER_PRICE_resultado.xlsx` y te deja revisar que las
columnas quedaron bien cargadas antes de tirar los 1075 códigos completos.

## 4. Correr todo el catálogo

```bash
node scraper/src/run.js --input "/ruta/a/MASTER_PRICE__revision_catalogo.xlsx"
```

- Tarda un buen rato: hay una pausa aleatoria de 2 a 4 segundos entre cada
  búsqueda para no sobrecargar el sitio ni disparar bloqueos por bot. Con
  ~1075 códigos únicos, contá entre 45 y 75 minutos aproximadamente.
- Si se corta (por lo que sea), corré el mismo comando de nuevo: retoma
  desde el caché y no repite lo ya buscado.
- Al final escribe `scraper/output/MASTER_PRICE_resultado.xlsx` con la
  columna F completada.

### Opciones útiles

| Opción | Qué hace |
|---|---|
| `--output <ruta>` | Dónde guardar el Excel final (default: `scraper/output/MASTER_PRICE_resultado.xlsx`) |
| `--cache <ruta>` | Dónde guardar/leer el caché (default: `scraper/cache/cache.json`) |
| `--limit N` | Procesa como máximo N códigos nuevos en esta corrida |
| `--headed` | Corre con el navegador visible (por defecto corre oculto/headless) |
| `--delay-min` / `--delay-max` | Pausa mínima/máxima en ms entre búsquedas (default 2000/4000) |
| `--debug` | Guarda capturas y texto de cada búsqueda en `scraper/debug/` |

## Estructura del proyecto

```
scraper/
  src/
    config.js       columnas, fila de corte, fabricante (ajustar acá si cambia el Excel)
    excelIO.js       lectura/escritura del xlsx
    rockauto.js      automatización del navegador (Playwright) — la parte a validar
    run.js           script principal (procesa todo el catálogo)
    inspect.js       estadísticas del archivo sin tocar internet
    debugOne.js      corre un solo código en modo visible para depurar
  cache/             checkpoints de búsquedas ya hechas (no se sube a git)
  output/            resultado final (no se sube a git)
  debug/             capturas/texto de depuración (no se sube a git)
```

## Códigos que quedan afuera (a cargar a mano)

Después de correr `inspect.js` vas a ver la lista de filas con múltiples
códigos Continental separados por `|` — son la minoría y quedan para que
las compares y cargues manualmente, tal como charlamos.
