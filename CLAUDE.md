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
- **Excepción vigente (histórica):** el autor pidió avanzar **todas las fases seguidas, sin esperar visto bueno entre ellas**, y revisar al final. Por eso las Fases 1–9 se hicieron de corrido; la revisión de cada fase queda pendiente y cada cierre dejó dicho qué se asumió. Para cambios futuros vuelve a regir «una fase, alto, visto bueno».

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
| `npm run paridad -- compare … --open` | Al terminar abre el reporte en el navegador (Ctrl+C cierra el servidor local). |
| `npm run paridad -- report --dir out/escritorio --dir out/movil --label Escritorio --label Móvil` | Abre reportes ya generados; con varias carpetas, una pestaña por tamaño. |
| `npm run build -w @paridad/report` | Compila la app del reporte (si no está compilada, `--open` usa el modo desarrollo, más lento al arrancar). |
| `npm run app` | Abre la **app de comparaciones** en `127.0.0.1`: pantalla «Nueva comparación» (enlace del frame + URL de la página), avance en vivo, reporte e historial en `out/comparaciones/` (`--workspace <carpeta>`, `--no-open`). El token de Figma solo se lee de `.env.local`; la pantalla nunca lo pide. «Probar con el ejemplo» funciona sin token. |
| `npm run paridad -- compare --design d.json --page <URL>` | Modo **mixto**: diseño ya leído (sin llamar a Figma) + captura de la página en vivo. Es lo que usa el modo ejemplo de la app. |
| `npm run casos` | Genera el cuaderno de casos: una **tarjeta** `historia.jpg` por mutación (diseño, código, diferencia, hallazgos y el `diff` que causó el error) con su `caso.md`, en `docs/casos/` (36 casos, ~13 MB; solo se versionan los elegidos). Cada `npm run evals` además guarda solo los casos que **fallan** en `out/evals/fallos/`. |
| `npm run paridad -- compare … --ai` | Agrega la capa de IA (Claude, visión): agrupa hallazgos, propone descartar ruido evidente y redacta con sugerencia de CSS. Apagada por defecto; requiere `ANTHROPIC_API_KEY`. `--ai-model`, `--ai-max-cost 0.05`, `--no-ai-images`; `--ai-simulated` prueba la tubería sin modelo. |
| `npm run evals` | Mide si Paridad acierta: aplica errores conocidos a la página de ejemplo y reporta detección, precisión y severidad por tipo de error, los falsos positivos de la página de control y el cambio respecto a la corrida anterior. Sale con código 1 si no se cumplen las metas. `-- --validate` revisa las mutaciones propuestas sin abrir el navegador; `-- --only a,b` corre solo esas. |
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
packages/evals/     mutaciones (datos JSON), medición de aciertos, tabla y comparación entre corridas    [existe]
.claude/agents/     `mutation-proposer`: subagente que propone mutaciones nuevas como datos                [existe]
packages/ai/        capa opcional con Claude: agrupa, descarta ruido, redacta; valida contra la evidencia [existe]
apps/cli/           `paridad capture|figma|compare|app …` (`--no-visual` omite píxeles)                    [existe]
apps/report/        app web (Next.js 16): reporte (vistas, hallazgos, Markdown, PDF) y «Nueva comparación» [existe]
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

**Textos:** una copia distinta es «media» (solo mayúsculas, «baja»); si el texto cambia tanto que ya no se parece (< 80 %), no se empareja y sale como «falta» (crítica) y «sobra» (alta).

**Causa raíz, no síntomas:** la posición se mide respecto al contenedor (si una tarjeta baja 4 px, sus hijos no se reportan); si el corrimiento de un elemento lo explica su vecino (cambió su tamaño o la separación), se reporta una sola vez en la causa; si falta una caja, es un hallazgo con la cuenta de lo que había dentro; y la fuente que no cargó es uno solo.

## Evaluaciones (qué se mide y cómo)

`npm run evals` toma la página de ejemplo, le aplica **errores controlados y conocidos** (mutaciones), la captura con Chromium, la compara con el diseño y mide:

| Métrica | Definición |
|---|---|
| **Detección** | expectativas encontradas / expectativas (cada mutación declara qué hallazgos, de qué regla, sobre qué elemento del diseño y con qué severidad debe producir) |
| **Precisión** | aciertos / (aciertos + falsos positivos). Los efectos colaterales legítimos que la mutación declara (`acceptable`: si algo crece, lo de abajo se corre) no cuentan como falsos positivos ni como aciertos |
| **Severidad** | de lo detectado con severidad esperada, qué fracción la tiene según el criterio de arriba |
| **Control** | la página intacta + cambios que NO deben reportarse (`ruido`: 0.2 px, ΔE 0.3, comentarios en el CSS…). Falsos positivos = elementos con algún hallazgo / elementos comparados. Además se cuentan las regiones de píxeles que ninguna regla explica |

**Metas iniciales (a ajustar):** detección ≥ 90 % y falsos positivos en control ≤ 10 %. Una prueba (`packages/evals/src/evals.test.ts`) las vigila: si una mejora de la herramienta las rompe, `npm test` falla.

**Resultado de la primera corrida completa (mutaciones propias):** detección 96 %, **precisión 58,5 %**, severidad 97,9 %. La precisión baja se debía a defectos reales, no a las expectativas: las diferencias de píxeles que eran *consecuencias* de un cambio de layout (el pie baja 8 px) quedaban «sin clasificar»; las cajas que se movían más que su tamaño no se emparejaban; un umbral de severidad era inestable (4,01 px); y una regla de espaciado estaba mal formulada. Tras corregirlos: 100 % / 100 % / 100 %.

**⚠ Cuidado con el sobreajuste:** esas mutaciones las escribí yo y ajusté la herramienta mirando sus resultados, así que ese 100 % no prueba nada. Por eso existe el subagente `mutation-proposer`: propone mutaciones **sin leer la implementación ni los resultados** (solo la página, el diseño y el criterio de severidad de este archivo) y las entrega como datos JSON en `packages/evals/mutations/`. **Resultado con las 10 propuestas del subagente (independientes): 9 pasan; detección 100 %, precisión 98,6 %, severidad 100 %, control 0 % de falsos positivos.**

**Limitación conocida (caso que falla):** `enlace-extra-navegacion` — al agregar un cuarto enlace, la navegación centrada corre los tres anteriores *y* aparece contenido nuevo en la misma región de píxeles; ya no es una «copia desplazada» pura y queda como diferencia visual sin clasificar (falso positivo medio). Arreglarlo exigiría separar la región en partes (lo que se movió / lo nuevo). No se ajustó la herramienta para esconderlo: es justo el tipo de hallazgo que da valor a medir con casos independientes.

## Capa de IA (opcional, medida, apagada por defecto)

`--ai` pasa el reporte del motor por Claude (por defecto **Haiku 5.5**, el más económico; configurable con `--ai-model`) con salidas estructuradas (JSON validado por esquema). Hace tres cosas: **agrupar** hallazgos con causa común («todo el bloque de tarjetas está 4 px más abajo» en vez de 12), **proponer descartar ruido evidente** y **redactar** cada grupo para el desarrollador con una corrección en CSS.

**La IA no inventa hallazgos.** Solo ve lo que midió el motor, y su respuesta se valida (`packages/ai/src/ground.ts`): cada grupo debe citar hallazgos que existen (sin repetir), y cada cifra y cada color de sus textos debe aparecer en la evidencia de lo que cita; si no, el grupo se **rechaza** y los hallazgos quedan como los redactó el motor. No se pueden descartar hallazgos críticos, faltantes/sobrantes ni fuente caída, y si descarta más de la mitad se desconfía de todos sus descartes. La sección `ai` del reporte **no cambia** `findings` ni el puntaje: solo suma agrupación, descartes (que el reporte pliega, no borra) y su costo.

**Control de costo:** las imágenes se envían **recortadas** a las regiones relevantes (hasta 3, lado mayor ≤ 900 px) en lugar de la página entera; las respuestas se guardan en **caché local** (`.paridad-cache/ai/`; la misma pregunta no se paga dos veces); hay un **tope por corrida** (`--ai-max-cost`, 0.05 USD; se estima antes de llamar y, si no cabe, no se llama); y el **costo real** (de los tokens que informa la API) queda en el reporte. Si la llamada falla o el modelo declina, el reporte sigue completo y sin IA.

**Evaluación con y sin IA:** `npm run evals -- --ai` repite las mismas mutaciones con la IA aplicada y compara. Mide **precisión** (un descarte de un falso positivo la sube; uno de un acierto pierde detección y se cuenta como *descarte dañino*) y **claridad** (cuántos elementos tiene que leer una persona: grupos + hallazgos sueltos, frente a la lista original). **Regla de decisión (`decideAiDefault`):** la IA se enciende por defecto solo si mejora la precisión ≥ 2 pts **o** la claridad ≥ 20 %, sin perder detección, sin ocultar ningún error real y con ≤ 20 % de lo que devuelve rechazado; si no, queda apagada. Si no mejora, eso también es un resultado válido para el caso de estudio.

**⚠ Estado de la medición:** en este entorno **no había `ANTHROPIC_API_KEY`**, así que la capa se construyó y probó entera con modelos falsos (uno bueno y varios tramposos que inventan ids, cifras y colores, o intentan descartar críticos), pero **no se ha medido a Claude de verdad**. Por eso la IA queda apagada por defecto (D-053). Para decidir: poner la clave en `.env.local` y correr `npm run evals -- --ai` (≈ 40 llamadas de Haiku, centavos de dólar).

## Integración: skill, CLI para otras herramientas y Action

- **`/paridad <enlace del frame> <URL de la página>`** (`.claude/skills/paridad/SKILL.md`): corre `compare` y resume críticos y altos con `summary --json`. Solo la invoca la persona (`disable-model-invocation`), solo puede ejecutar esos dos comandos (`allowed-tools`) y tiene prohibido pedir o mostrar el token.
- **`paridad summary --dir <carpeta> [--json] [--severity …]`**: forma estable (texto o JSON) del resultado para otras herramientas.
- **`paridad ci --screens paridad.screens.json`**: compara varias pantallas, escribe un reporte por pantalla, `comment.md` (con marca oculta para actualizar en lugar de duplicar) y sale con código 2 si alguna queda bajo `--fail-under`.
- **Acción de GitHub** (`.github/actions/paridad/`, ejemplo en `docs/examples/paridad-pr.yml`, guía en `docs/github-action.md`): ⚠ **no probada en GitHub real**; sus piezas y su estructura sí tienen pruebas.
- **`npm run media`** regenera las capturas y el video del reporte (`docs/media/`) con una página con errores reales servida en localhost.

## El reporte (app web)

`apps/report` es una app Next.js que **lee `report.json` y sus imágenes de una carpeta** (no se compila con los datos): `paridad … --open` la levanta en `127.0.0.1` en un puerto libre y abre el navegador. Muestra el puntaje grande con su fórmula y desglose, el conteo por severidad y qué se comparó; cuatro vistas (**lado a lado, superpuesta con divisor, transparencia ajustable, mapa de calor** con regiones clicables); la lista de hallazgos filtrable por severidad y tipo, donde al hacer clic se **resaltan las cajas en ambas imágenes** y se muestra lo esperado contra lo obtenido; exportación a **Markdown** (listo para un issue de GitHub, con lo que se ve en la lista) y **PDF**; y **pestañas por tamaño** si se abren varios reportes.

Accesible por diseño y **auditado con axe-core** (WCAG 2.1 AA) en cada vista: se usa con teclado (pestañas con flechas/Inicio/Fin, enlace «Saltar al contenido»), los colores cumplen contraste (una prueba lo calcula con el motor de `core`) y **la severidad nunca depende solo del color** (cada una lleva su forma y su texto: ■ crítica, ▲ alta, ◆ media, ● baja).

### La pantalla «Nueva comparación» (extensión posterior a las diez fases)

`npm run app` levanta la misma app en `127.0.0.1` sin ningún reporte y abre `/nueva`: un formulario (enlace del frame de Figma, URL de la página, ancho, escala, zonas a ignorar, IA opcional con tope de costo), el **estado del entorno** (token de Figma, Chromium y clave de IA: solo «configurado / falta», nunca el valor), el **avance en vivo** (`/comparaciones/<id>`, sondeo cada segundo; al terminar abre el reporte) y el **historial** (`out/comparaciones/*`, con casillas para abrir varias juntas como pestañas por tamaño; no hay botón de borrar). «Probar con el ejemplo (Casa Nube)» usa el diseño guardado y la página de ejemplo, sin Figma ni token. Un tamaño por comparación. El servidor valida todo (`lib/validate.ts`), lanza el CLI como proceso hijo (un trabajo a la vez, 3 minutos máximo, salida sin secretos) y protege las rutas que ejecutan cosas con `Host`/`Origin` locales y un token de sesión (`lib/guard.ts`).

La lectura de Figma desde la pantalla ya se probó con un archivo real (en la máquina del autor, no aquí: este entorno no tiene token). Esa primera prueba con un sitio real descubrió tres defectos de la captura, ver D-082.

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
- **D-029 · ⚠ Los datos de Figma de las pruebas son sintéticos, no una grabación real** — se construyeron con la forma documentada de la API (`fixtures/landing/figma/`). Falta validar el traductor con un archivo real y un token propio; hasta entonces la Fase 2 está probada contra la documentación, no contra Figma. **Actualización:** el autor leyó un frame real desde la pantalla «Nueva comparación» y el traductor lo convirtió en snapshot con avisos legítimos (degradados, rotaciones, trazos centrados, estilos mezclados); lo que sigue sin revisarse es qué tan fiel es ese snapshot frente al diseño, medida por medida.
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
- **D-045 · Las mutaciones son datos, no código** — un JSON de ediciones de buscar y reemplazar (`find` debe aparecer exactamente una vez) más lo esperado; así un subagente puede proponerlas sin ejecutar nada, y una prueba comprueba que todas siguen aplicando si la página cambia.
- **D-046 · Cada mutación declara `expected` y `acceptable`** — sin lo segundo, cualquier consecuencia legítima (el pie baja) contaría como falso positivo y la precisión sería inútil; con comodines de más, ocultaría falsos positivos reales. Por eso los `acceptable` deben ser específicos.
- **D-047 · El subagente no lee `core/`, `visual/` ni los resultados** — sus expectativas deben salir de la especificación (el criterio de severidad) y no de lo que la implementación ya hace; si no, se mediría a la herramienta contra sí misma. Solo escribe JSON y valida con `npm run evals -- --validate`.
- **D-048 · Se mide también el ruido** — un cambio de 0.2 px o ΔE 0.3 no debe reportarse. Sus diferencias de píxeles se clasifican como «tolerancia» (un elemento emparejado sin hallazgos) o «desplazamiento», nunca como error.
- **D-049 · Lo que enseñó la primera corrida** — (a) una diferencia de píxeles puede ser una *copia desplazada* del diseño: se reconoce probando desplazamientos y es consecuencia, no error; (b) las cajas hijas se emparejan también por posición relativa a su padre; (c) los textos que ya son pareja pesan más que la geometría al emparejar cajas, con penalización si contradicen; (d) los umbrales de severidad redondean a 0.1 px; (e) dos huecos seguidos que cambian lo mismo son un `gap` de CSS: se reporta el hueco, no el corrimiento del elemento del extremo.
- **D-050 · La clasificación de una región visual sigue un orden** — una regla que la explique › el alto de la página › un desplazamiento › estar dentro de la tolerancia › sin clasificar. Las imágenes emparejadas no entran en «tolerancia»: ninguna regla revisa sus píxeles.
- **D-051 · Salidas estructuradas con esquema simple, validadas dos veces** — el SDK valida el JSON contra un esquema de Zod (sin opcionales: «sin corrección» es una cadena vacía) y después `ground()` lo valida contra los hallazgos reales; el esquema asegura la forma, la validación asegura la verdad.
- **D-052 · Una cifra solo es válida si sale de la evidencia que el grupo cita** — o del conteo del grupo, o de la diferencia entre lo *esperado* y lo *obtenido* de un mismo hallazgo (el «4 px» entre 16 y 20). Una versión inicial aceptaba la diferencia entre *cualquier* par de cifras de la evidencia (incluidas las cajas) y dejaba pasar un «24 px» inventado; una prueba lo descubrió y se acotó.
- **D-053 · La IA se queda apagada por defecto** — la especificación pide encenderla solo si mejora la precisión o la claridad, y eso no se ha medido con un modelo real. La decisión es código (`decideAiDefault`), no opinión: se recalcula cada vez que se corre `evals --ai`. El modelo simulado nunca decide.
- **D-054 · Se mide el daño además de la mejora** — descartar un falso positivo sube la precisión, pero descartar un acierto esconde un error real; por eso se cuentan los «descartes dañinos» y uno solo basta para dejar la IA apagada.
- **D-055 · El prompt trata hallazgos e imágenes como datos, no como instrucciones** — los títulos de los hallazgos incluyen texto de la página (que puede decir «ignore las reglas»); el sistema lo declara y, sobre todo, nada de lo que el modelo diga puede cambiar `findings` ni el puntaje.
- **D-056 · La clave nunca sale** — se lee de `.env.local`/entorno, no se escribe en la caché ni en los errores (se reemplaza por `***`), y el prompt no incluye rutas de archivos.
- **D-057 · La app lee el disco en cada visita, no se compila con los datos** — un reporte se genera con `paridad compare` cuando se quiere; la app es una vista. Por eso la página es dinámica y el CLI la arranca con `PARIDAD_REPORTS` (carpetas y etiquetas).
- **D-058 · Un reporte es una carpeta autocontenida** — `compare` copia las imágenes dentro de la carpeta de salida; así se puede compartir la carpeta entera y el servidor puede servir *solo* imágenes de ella (`safeResolve` rechaza `..`, rutas absolutas, codificaciones y todo lo que no sea imagen: nunca sirve `report.json` ni snapshots).
- **D-059 · Servidor solo en localhost, sin telemetría** — escucha en `127.0.0.1` con `NEXT_TELEMETRY_DISABLED`; la ruta del PDF solo acepta orígenes locales (Next toma el host de la conexión real, así que la guarda es defensa adicional).
- **D-060 · El PDF sale de la propia vista de impresión** — Playwright abre `/?print=1` (sin controles) y la imprime; no hay una segunda maqueta que mantener. «Imprimir» del navegador usa los mismos estilos `@media print`.
- **D-061 · Fuentes locales con `next/font/local`** — el reporte se ve igual sin red. Una prueba descubrió que una variable CSS propia en `:root` pisaba la de `next/font` y las fuentes de la marca **no cargaban** (caía a la del sistema, sin ningún error): ahora hay una prueba que verifica que las cuatro caras se descargan.
- **D-062 · Se prueba la accesibilidad con una herramienta y con los ojos** — axe-core no ve que una píldora decorativa tape un texto en móvil; una captura sí. Y una prueba comprueba que axe *detecta* una violación inyectada (para no confiar en un auditor que nunca falla).
- **D-063 · El Markdown escapa lo que viene de la página** — los textos de la página (que aparecen en los títulos de los hallazgos) pueden traer `|`, `<` o cualquier cosa; se escapan para no romper tablas ni inyectar HTML en un issue.
- **D-064 · La skill solo la invoca la persona y su alcance está acotado** — llama a la API de Figma, abre un navegador y puede gastar tiempo; por eso `disable-model-invocation`, y `allowed-tools` lista únicamente `compare` y `summary` (una prueba lo vigila, junto con que los comandos que menciona existan en el CLI).
- **D-065 · La acción nunca interpola valores dentro de un script** — todo entra por `env:` (el token y también las entradas de texto libre), porque `${{ … }}` dentro de `run:` permite inyectar comandos; corre con `pull_request` y no `pull_request_target` (un fork no recibe secretos); y el comentario se publica aunque falle el puntaje, devolviendo el código de salida al final.
- **D-066 · Se prueba la documentación** — cada enlace de los `.md` debe apuntar a algo que existe, las capturas deben estar, y ningún archivo versionado puede contener tokens (Figma, Anthropic, GitHub); `.env.example` no trae valores.
- **D-067 · El caso de estudio separa lo que sabe el proyecto de lo que solo sabe el autor** — la anécdota real y sus tiempos quedan como recuadros por completar (no se inventan); las cifras salen de corridas reproducibles; y lo que no se midió (la IA con un modelo real) se dice como pendiente.
- **D-068 · Los errores se guardan como historias, no como logs** — cada caso es una tarjeta con la marca (diseño · código · diferencia · hallazgos · `diff` de la causa) que se entiende sin contexto; los que fallan se guardan solos en cada corrida de `evals`, y todos se regeneran con `npm run casos`. Los errores del propio desarrollo van a mano en `docs/casos/bugs-de-desarrollo/`.
- **D-069 · Solo se versiona lo elegido** — 36 tarjetas pesan ~13 MB; el repositorio guarda las ~9 historias curadas (lista en `.gitignore` y `docs/casos/historias.md`) y el resto se regenera. El JPEG (calidad 84, 1,5x) pesa ~3 veces menos que el PNG y es igual de legible.
- **D-070 · Si la región es muy ancha, los paneles se apilan** — en tres columnas, tres tarjetas en fila quedaban diminutas e ilegibles (se vio al revisar la primera tarjeta); a partir de una relación ancho/alto de 2, los paneles van a todo el ancho.
- **D-071 · Las rutas relativas se cuentan desde donde se escribió el comando** — `npm run -w` ejecuta desde la carpeta del paquete (`INIT_CWD` lo corrige); antes `out/evals` caía dentro de `packages/evals` sin que nadie lo notara.
- **D-072 · Un documento que se edita con sustituciones de texto se verifica** — las ediciones automáticas de `CLAUDE.md` fallaron en silencio (un título mal puesto hizo que las siguientes no encontraran dónde insertar): se perdieron D-057…D-071 y la Fase 7 quedó sin marcar, y nadie lo notó hasta mirar el archivo. Ahora una prueba exige que existan todas las decisiones, numeradas sin huecos, y las diez fases marcadas.
- **D-073 · La app lanza el CLI como proceso hijo, no importa el motor** — Playwright y la captura quedan fuera del servidor de Next (un fallo no lo tumba) y se reutiliza el comando ya probado en lugar de duplicar la lógica; los argumentos van en arreglo, sin shell, y cada valor pegado a su opción con `--opción=valor` para que nunca se lea como otra opción.
- **D-074 · Un trabajo a la vez, con tiempo máximo** — Chromium y la red ya son carga suficiente para una máquina personal; el segundo envío recibe «ya hay una comparación en curso» (409) y a los 3 minutos el proceso se mata y se informa. Las comprobaciones (token, clave, Chromium) van **antes** de lanzar nada: sin token no nace ningún proceso.
- **D-075 · El token de Figma solo vive en `.env.local`** — decisión del autor: la pantalla informa si está configurado y explica cómo crearlo, pero no tiene campo para pegarlo, y ni el token ni la clave de IA viajan al navegador ni salen en la salida del comando (`maskSecrets` reemplaza sus valores y las formas de token conocidas por `***`).
- **D-076 · Las rutas que ejecutan cosas exigen origen local y un token de sesión** — es un formulario web que lanza procesos: `Host` y `Origin` deben ser locales y coincidir, y llega una cabecera propia (`x-paridad`) con un token aleatorio incrustado al servir la página. Otra pestaña del navegador no puede leerlo (CORS) y el `Host` frena el DNS rebinding. Es defensa en profundidad: el servidor ya solo escucha en `127.0.0.1`.
- **D-077 · El servidor valida todo, el formulario solo ayuda** — URL de Figma con `parseFigmaUrl`, URL de la página con `assertAllowedUrl` (solo http, https y file; sin usuario ni contraseña), ancho entero 200–4000, máximo 20 selectores de 200 caracteres sin caracteres de control. Los mensajes van en español junto a cada campo. Para no meter Playwright en el bundle de Next, esos dos validadores puros se exportan por subruta (`@paridad/figma/url`, `@paridad/capture/url`).
- **D-078 · El estado del servidor vive en `globalThis`** — Next puede cargar un módulo más de una vez (una copia por ruta); con una variable de módulo, la ruta que crea el trabajo y la que informa su avance no verían el mismo trabajo ni el mismo token de sesión.
- **D-079 · Los ids de comparación son carpetas que crea la app (`c:<carpeta>`, solo `[a-z0-9-]`)** — `entryById` es la única forma de llegar a una carpeta de comparación; `..`, rutas y mayúsculas no existen. `safeResolve` sigue siendo la única puerta a los archivos (solo imágenes). Una prueba comprueba imágenes, reporte y PDF con ids hostiles.
- **D-080 · Se lee siempre el cuerpo de una respuesta** — una prueba de extremo a extremo se colgaba esperando «red inactiva» porque la rama 404 del avance salía sin leer el cuerpo y la petición quedaba abierta; además, esa misma prueba descubrió que la página de avance no tenía `<h1>`.
- **D-081 · El historial es el disco, no la memoria** — el estado de un trabajo se pierde si la app se reinicia, pero el reporte ya está en `out/comparaciones/`: abrir `/comparaciones/<id>` de uno terminado redirige a su reporte, y uno desconocido da un mensaje claro en lugar de una pantalla rota.
- **D-082 · Un sitio real rompe supuestos que las páginas de prueba no rompen** — la primera captura de un sitio de verdad se colgó 3 minutos y descubrió tres defectos: (a) `img.decode()` no termina nunca con una imagen `loading="lazy"` que no está a la vista (el menú móvil), y esa espera no tenía tope; (b) un sitio real casi nunca llega a «red inactiva» (píxeles de analítica, anuncios), así que esa espera ahora tiene su propio tope de 10 s (`idleTimeoutMs`) y cada paso final está acotado; (c) la CSP del sitio bloqueaba la hoja de estilos que Paridad inyecta, y la ventana de captura usa `bypassCSP`. Cada una tiene una prueba con un servidor local que reproduce el problema, y se comprobó que falla sin la corrección.

## Estado de fases

- [x] **Fase 0** · Planificación y base
- [x] **Fase 1** · Capturar la página construida
- [x] **Fase 2** · Leer el diseño desde Figma (⚠ pendiente validar con un archivo real, ver D-029)
- [x] **Fase 3** · Motor de comparación
- [x] **Fase 4** · Diferencia visual
- [x] **Fase 5** · Evaluaciones
- [x] **Fase 6** · Capa de IA (⚠ construida y probada con modelos falsos; falta medir con una clave real, ver D-053)
- [x] **Fase 7** · El reporte
- [x] **Fase 8** · Integración y skill (⚠ la Action no está probada en GitHub real)
- [x] **Fase 9** · Caso de estudio (borrador en `docs/caso-de-estudio.md`; faltan la anécdota real y la cifra con IA)
- [x] **Extensión 1** · Pantalla «Nueva comparación», avance e historial (⚠ pendiente de su visto bueno; probada con un frame y un sitio reales del autor, ver D-082)
