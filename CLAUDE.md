# Paridad · Comparador entre diseño y código

Proyecto personal de Nehemias Pérez (Diseñador UI/UX) para su sección «Laboratorio» en nehemiasperez.com. Se presenta con su **marca personal**, no con una empresa.
«Paridad» es un nombre de trabajo (ver D-001).

## Objetivo

Tomar un **frame de Figma** y la **página ya construida**, compararlos y reportar lo que no coincide (espaciados, colores fuera de la paleta, tipografías, textos cortados, elementos que faltan o sobran, contraste), cada diferencia con **evidencia medible y severidad**. Es la frase «Interfaces pensadas para implementarse» convertida en herramienta.

Es un proyecto **para aprender** con Claude Code: modo plan, este `CLAUDE.md` vivo, hooks, un subagente, una skill propia (`/paridad`) y evaluaciones que midan si la herramienta acierta.

## Idea central

Todo se convierte al mismo formato, el **snapshot** (`docs/snapshot.md`): tamaño del lienzo, imagen y lista de elementos con posición, tamaño y estilos. El motor (`core`) solo compara snapshots, sin red, y se prueba con snapshots guardados.

## Reglas de trabajo

- Trabajar **por fases** (ver «Estado de fases»). Cada fase: especificación antes del código, pruebas, y un cierre que diga qué se hizo, cómo probarlo y qué se decidió y por qué.
- **TypeScript estricto**, **Vitest**. Nada se da por terminado sin pruebas.
- Las decisiones técnicas importantes se explican **en una línea** en «Decisiones» (es un proyecto para aprender).
- **Secretos:** el token de Figma va en `.env.local` y nunca se sube. `.env.example` lista las variables sin valores.
- **Solo se capturan páginas que el usuario indique** (localhost o URLs explícitas). Nada de rastrear sitios.
- **Interfaz en español, tratando de «usted».**
- **Sin diseños reales de clientes ni de NIU** en el repositorio, datos de prueba o caso de estudio. Solo la página de ejemplo y diseños propios.
- No crear pull requests salvo que se pidan.

## Marca del reporte

Bricolage Grotesque 800 para títulos; Instrument Sans para texto.
Tinta `#0E1116` · texto `#2B2F36` · apagado `#6A707A` · línea `#DADDE2` · suave `#ECEDEF` · fondo `#FAFAF8` · azul `#043565`.
Motivo de cuadros con píldora azul.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm install` | Instala todo el monorepo (npm workspaces). |
| `npm test` | Todas las pruebas (Vitest, un proyecto por paquete). |
| `npm test -w packages/core` | Solo las pruebas de un paquete (es lo que corre el hook). |
| `npm run typecheck` | `tsc --noEmit` en la raíz y en cada paquete. |
| `npm run schema:json` | Regenera `docs/snapshot.schema.json` desde Zod. |
| `npm run paridad -- capture --page <url> --width 1440` | Captura una página → `snapshot.json` + `screenshot.png` (por defecto en `out/capture`). |
| `npm run paridad -- compare --design d.json --page p.json` | Compara dos snapshots → `report.json` + resumen. Con `--figma <url> --page <url>` hace todo: lee Figma, captura la página y compara. `--fail-under 90` sale con código 2 si el puntaje es menor. |
| `npm run paridad -- figma --url <frame>` | Lee un frame de Figma → `snapshot.json` + `design.png` (por defecto en `out/design`). Requiere `FIGMA_TOKEN` en `.env.local`. |

## Estructura

```
packages/core/      snapshot (Zod), emparejamiento, reglas, severidad, puntaje, reporte. Sin red.          [existe]
fixtures/           datos de prueba compartidos; landing/ = página «Casa Nube» + snapshot de diseño       [existe]
scripts/            hook de pruebas y generador del JSON Schema                                          [existe]
docs/               snapshot.md y snapshot.schema.json                                                   [existe]
packages/capture/   Playwright: página construida → snapshot                                             [existe]
packages/figma/     API REST de Figma: frame → snapshot, con caché                                       [existe]
packages/visual/    diferencia de píxeles (pixelmatch), regiones y mapa de calor                         [existe]
packages/evals/     mutaciones y medición de aciertos                                                    [Fase 5]
packages/ai/        capa opcional con Claude                                                             [Fase 6]
apps/cli/           `paridad capture|figma|compare …` (`capture`, `figma` y `compare`; `--no-visual` omite píxeles)  [existe]
apps/report/        reporte web (Next.js)                                                                [Fase 7]
```

Los paquetes se crean al llegar su fase (no hay andamiaje vacío).

## Hook de pruebas

`.claude/settings.json` ejecuta `scripts/test-edited-package.mjs` tras cada `Edit|Write|MultiEdit`: corre solo las pruebas del paquete editado
(`fixtures/` → pruebas de `core`; `docs/` y raíz → nada). Si fallan, devuelve la salida a Claude con código 2.

## Severidad y puntaje (criterio propuesto — **para su revisión**)

Cada hallazgo trae una severidad. Todos los umbrales son configurables en `paridad.config.ts` (`severity`, `tolerances`, `score`).
Lo que queda por debajo de su **tolerancia** es ruido y no se reporta.

| Severidad | Qué es | Ejemplos |
|---|---|---|
| **Crítica** | Falta algo del diseño, o lo que se ve no se puede comparar o leer | Elemento que falta; la fuente no cargó (un solo hallazgo para todos los textos); la ventana no mide lo que el frame |
| **Alta** | Un usuario lo notaría sin ver el diseño al lado | Elemento que sobra; texto cortado; otra familia tipográfica; peso 800→600; fondo que desaparece; contraste < 3:1; página desbordada; diferencias > 12 px o ΔE > 10 |
| **Media** | Se nota al comparar | 4–12 px de posición o tamaño; ΔE 4–10; texto con otra copia; color fuera de la paleta (mínimo «media»); contraste entre 3:1 y 4.5:1; una línea más de texto |
| **Baja** | Se ve solo con lupa | 1–4 px; ΔE 2–4; mayúsculas distintas; interlineado o espaciado entre letras ligeramente distintos |

| Tolerancia (ruido) | Valor |
|---|---|
| Posición, espaciado, tamaño | 1 px |
| Tamaño de letra / interlineado / espaciado entre letras | 0.5 px / 1 px / 0.25 px |
| Color | ΔE2000 ≤ 2 (lo que el ojo no distingue) |
| Radio de esquina (ya recortado a la mitad del lado menor) | 1 px |
| Borde / sombra / opacidad | 0.5 px / 1 px / 0.05 |

**Puntaje de paridad (0–100):** `100 − puntos`, donde cada hallazgo resta **crítica 15 · alta 6 · media 2 · baja 0.5**, con un **tope de 40 puntos por categoría** (presencia, posición, tamaño, tipografía, color, texto, contraste, página) para que cien diferencias de 1 px no oculten un elemento que falta. El reporte trae el desglose por categoría y dice si algún tope se aplicó.

**Causa raíz, no síntomas:** la posición se mide respecto al contenedor (si una tarjeta baja 4 px, sus hijos no se reportan); si el corrimiento de un elemento lo explica su vecino (cambió su tamaño o la separación), se reporta una sola vez en la causa; si falta una caja, es un hallazgo con la cuenta de lo que había dentro; y la fuente que no cargó es uno solo.

## Decisiones

Una línea cada una: qué se decidió y por qué.

- **D-001 · Nombre «Paridad»** — corto, en español y nombra exactamente lo que se mide; no apareció uno mejor que justificara el cambio. Binario `paridad`, alcance npm privado `@paridad/*`.
- **D-002 · npm workspaces, sin Turborepo/Nx** — con pocos paquetes `npm test` basta; menos herramientas que aprender y mantener.
- **D-003 · Paquetes internos sin compilar** (`"exports": "./src/index.ts"`) — se edita y se prueba sin paso de `build`; Vitest y `tsx` leen TS, Next.js usará `transpilePackages`. Por eso los imports llevan extensión `.ts` (`allowImportingTsExtensions`).
- **D-004 · TypeScript 5.9 con `strict`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`** — atrapa en compilación los errores típicos de datos medidos (índices fuera de rango, `undefined` vs ausente). TS 7 existe, pero se revisará cuando Vitest/Next/Zod estén asentados en él.
- **D-005 · Vitest con `projects`** — un proyecto por paquete permite correr todo o solo el paquete editado, que es lo que necesita el hook.
- **D-006 · Zod 4 como única fuente de verdad** — de un mismo esquema salen los tipos TS, la validación (con mensajes en español, `z.locales.es`) y el JSON Schema documentado.
- **D-007 · Colores como hex `#rrggbb[aa]` en minúsculas** — legibles y fáciles de escribir a mano en datos de prueba; una sola representación evita comparar «#FFF» con «#ffffff».
- **D-008 · El snapshot guarda `parentId` y `z`** — sin jerarquía y orden de pintura no se puede calcular el fondo efectivo (para contraste con fondos transparentes) ni el espaciado entre vecinos.
- **D-009 · Texto = unión de sus líneas, cada una con el alto de su interlineado** — así un texto del DOM mide lo mismo que una capa de texto de Figma; sin esto toda comparación de altura de texto sería ruido.
- **D-010 · Solo existen elementos con fondo, imagen o texto propio** — los contenedores sin pintura no aportan nada que comparar; sus hijos cuelgan del ancestro visible más cercano.
- **D-011 · Bordes solo uniformes** — cubre los casos comunes (tarjetas, botones); los bordes por lado se dejan para `schemaVersion` 2 en lugar de complicar el formato ahora.
- **D-012 · `normalizeText`: NFKC + espacios colapsados, sin tocar mayúsculas** — «Comprar» y «COMPRAR» pueden ser un error real de copia.
- **D-013 · Contraste WCAG y ΔE (culori) se calcularán en `core`, sobre el snapshot** — deben funcionar también con Figma, que no tiene DOM. `axe-core` solo servirá de verificación cruzada del lado de la página (Fase 1).
- **D-014 · Página de ejemplo con fuentes locales (`woff2`, SIL OFL)** — las capturas deben ser idénticas en cualquier máquina; una fuente de sistema las haría variar.
- **D-015 · `fixtures/` sin dependencias, validado desde `core`** — evita un ciclo de dependencias (`core` usa los datos de prueba; los datos de prueba no usan `core`).
- **D-016 · Las dependencias se instalan cuando se usan** — `culori`, `fastest-levenshtein`, `pixelmatch`, etc. llegan con la fase que las necesita, no antes.
- **D-017 · El extractor del navegador es JS plano (`in-page/extract.js`), no TS** — al serializar una función TS hacia la página, tsx/esbuild inyecta helpers (`__name`) que allí no existen y rompe la captura.
- **D-018 · La imagen mide siempre el ancho de la ventana; si la página se desborda, la raíz `page` queda más ancha que el lienzo** — así la imagen sigue siendo comparable con el frame y el desborde horizontal queda como dato medible para la Fase 3, en lugar de perderse.
- **D-019 · La fuente realmente pintada se pide a Chromium (`CSS.getPlatformFontsForNode`) y se guarda en `renderedFontFamily`** — el CSS declara una fuente, no garantiza que cargó; comparar declarada vs pintada permite el hallazgo único «la fuente no cargó» en vez de uno por texto. Chromium da el nombre interno («Bricolage Grotesque 96pt ExtraBold»); si empieza con la familia declarada se normaliza a ella.
- **D-020 · Condiciones fijas de captura** — escala fija, zona horaria UTC, `es-MX`, `prefers-reduced-motion`, service workers bloqueados, CSS que apaga animaciones/transiciones, espera a red inactiva + `document.fonts.ready` + decodificación de imágenes + recorrido para imágenes perezosas. Dos capturas seguidas dan elementos y píxeles idénticos (hay prueba).
- **D-021 · El texto se mide recortado por el ancestro que corta el desbordamiento** — lo que no se ve no se compara; si el recorte quita más de 1 px, el texto se marca `clipped: overflow` (además de `ellipsis` y `line-clamp`, que se detectan por su CSS).
- **D-022 · `text-transform` se aplica al contenido** — Figma guarda el texto ya transformado o no según el diseñador; comparar lo que se ve evita falsos «texto distinto».
- **D-023 · Solo `http`, `https` y `file`; nunca se siguen enlaces** — cumple la regla de capturar únicamente lo que se indica.
- **D-024 · Zonas a ignorar por selector se resuelven también a rectángulos** — la diferencia visual (Fase 4) trabaja con píxeles y necesita rectángulos; el selector se conserva para el reporte.
- **D-025 · Límites conocidos de la captura (documentados, no escondidos)** — el orden `z` es el del DOM (no se resuelven contextos de apilamiento con `z-index`); no entra en Shadow DOM ni iframes; el texto mezclado (`<p>Hola <b>mundo</b></p>`) produce un elemento por cada nodo con texto propio; no hay imágenes de fondo ni valores de `<input>`.
- **D-026 · En Figma, el texto usa el ancho de `absoluteRenderBounds` (glifos) y la altura de la capa** — la capa de ancho fijo es más ancha que el texto; el DOM mide el texto tight. Así ambos lados miden lo mismo (D-009).
- **D-027 · Se traduce el relleno visible de más arriba; lo que no cabe en el formato se avisa, no se esconde** — degradados, bordes desiguales, trazos exteriores/centrados, rotación, estilos mezclados y tipos de nodo desconocidos salen como `Aviso:` en el CLI.
- **D-028 · Solo API REST, con caché en disco y el token confinado** — `GET /v1/files/:key/nodes` y `GET /v1/images/:key`; las variables (solo Enterprise) son un extra que falla en silencio. El token viaja solo a `api.figma.com` (nunca a la URL del PNG), nunca se guarda en la caché ni sale en errores. Caché de 24 h por hash de la petición; `--refresh` la ignora.
- **D-029 · ⚠ Los datos de Figma de las pruebas son sintéticos, no una grabación real** — se construyeron con la forma documentada de la API (`fixtures/landing/figma/`). Falta validar el traductor con un archivo real y un token propio; hasta entonces la Fase 2 está probada contra la documentación, no contra Figma.
- **D-030 · Los radios se normalizarán al comparar (Fase 3)** — un diseñador escribe radio = mitad del alto (21, 28) y el CSS suele poner 999px; ambos pintan igual. La regla debe recortar el radio a la mitad del lado menor antes de comparar.
- **D-031 · Un proyecto de Vitest por paquete exige listarlo en `projects`** — una vez `apps/*` quedó fuera y sus pruebas no corrían sin avisar; `scripts/workspaces.test.ts` lo vigila.
- **D-032 · Emparejar: textos primero, cajas después** — los textos anclan (similitud de Levenshtein sin mayúsculas + cercanía de posición, asignación voraz: los textos repetidos se resuelven por posición); las cajas se emparejan por IoU con bonos si sus padres son pareja o si contienen textos ya emparejados, de arriba hacia abajo.
- **D-033 · Posición relativa al contenedor, medida sin su borde** — lo que el desarrollador escribe en CSS es el padding; así el hallazgo dice «Padding izquierdo: diseño 16 px · código 20 px» y no 17.
- **D-034 · El espaciado se atribuye al elemento que está fuera de sitio** — si B está donde debe y A se movió, el hallazgo está en A; si B se corrió, el hallazgo es el hueco A→B y se suprime el de posición de B. Solo hay vecinos de flujo a ≤ 200 px (`maxNeighborGap`).
- **D-035 · Las zonas a ignorar de un lado valen también para el otro** — una fecha dinámica en la página tiene un marcador en el diseño en el mismo lugar; ignorar solo un lado produciría «falta» o «sobra» falsos.
- **D-036 · El contraste se calcula sobre el fondo efectivo y baja un nivel si el diseño ya lo tenía** — se componen los fondos con transparencia de los ancestros; si hay una imagen debajo no se opina (incierto). Si el diseño tiene el mismo problema, el código hizo lo pedido: baja un nivel y el título lo dice.
- **D-037 · Un color fuera de la paleta nunca baja de «media»** — aunque el ΔE sea pequeño, es un color que el diseño no usa. Los fuera de paleta en elementos que sobran se resumen en un hallazgo por color.
- **D-038 · El reporte es datos validados con Zod (`ReportSchema`)** — la app del reporte (Fase 7) y la IA (Fase 6) leen exactamente esto; cada hallazgo trae id estable, regla, categoría, severidad, título, las cajas en ambos lados y evidencia esperado/obtenido.
- **D-039 · Las pruebas del motor mutan snapshots en memoria** — rápidas y sin navegador; la página de control (diseño vs captura guardada) debe dar 0 hallazgos y 100. Las mutaciones sobre páginas reales llegan con la Fase 5. `page.snapshot.json` está vigilado contra deriva por una prueba de `capture`.
- **D-040 · Diferencia visual con pixelmatch (umbral 0.1, sin contar antialiasing) y alineación a la menor escala** — una imagen @2x se reduce promediando bloques para compararla con una @1x sin ruido; si una página es más alta, lo que le falta se rellena de magenta y cuenta como diferencia (queda como región). Las zonas a ignorar entran como máscara de píxeles (`ignoreMask`).
- **D-041 · Las regiones salen de una rejilla de 8 px con tolerancia de 2 celdas, caja ajustada a los píxeles y mínimo de 16 píxeles** — junta diferencias cercanas en un rectángulo útil para el reporte y descarta el ruido; las cajas que se solapan se fusionan.
- **D-042 · `visual` mide y `core` clasifica** — el paquete de imágenes no sabe de hallazgos y `core` no depende de librerías de imagen; `attachVisual` (pura) cruza las regiones con los hallazgos.
- **D-043 · Una región «la explica» un hallazgo según su tipo de regla** — las que mueven cosas (posición, espaciado, tamaño, falta, sobra) cuentan con sus hijos; radio, borde y sombra solo explican regiones junto al borde (franja de 24 px); fondo y opacidad exigen cubrir ≥ 25 % de la caja; el resto, que ≥ 60 % de la región caiga en la zona. Se descubrió con una prueba que un hallazgo de radio «explicaba» cualquier diferencia dentro de la tarjeta.
- **D-044 · Lo que ninguna regla explica es un hallazgo de categoría «visual»** — severidad por fracción del lienzo: ≥ 2 % alta, ≥ 0.2 % media, menos baja; entra al puntaje como cualquier otro.

## Estado de fases

- [x] **Fase 0** · Planificación y base
- [x] **Fase 1** · Capturar la página construida
- [x] **Fase 2** · Leer el diseño desde Figma (⚠ pendiente validar con un archivo real, ver D-029)
- [x] **Fase 3** · Motor de comparación
- [x] **Fase 4** · Diferencia visual
- [ ] Fase 5 · Evaluaciones
- [ ] Fase 6 · Capa de IA
- [ ] Fase 7 · Reporte
- [ ] Fase 8 · Integración y skill
- [ ] Fase 9 · Caso de estudio
