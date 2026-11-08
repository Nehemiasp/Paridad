# Página de ejemplo «Casa Nube»

Página propia y **ficticia** (un estudio de cerámica inventado), sin relación con clientes ni con diseños reales.
Es la base de todas las pruebas de Paridad.

| Archivo | Qué es |
|---|---|
| `page/index.html`, `page/styles.css` | La «página construida». HTML y CSS estáticos, sin JavaScript ni red. |
| `page/fonts/*.woff2` | Instrument Sans y Bricolage Grotesque (licencia SIL OFL, ver `LICENSE-*.txt`), locales para que la captura sea idéntica en cualquier máquina. |
| `design.snapshot.json` | Snapshot del «diseño», con la maqueta ideal a 1440 px. |
| `design.png` | Imagen del diseño (1440 × 927, escala 1). |

## Cómo se hizo el snapshot de diseño

Se midió la página una sola vez con Chromium y los valores se fijaron como datos. **No se regenera solo**: si se
cambia el HTML o el CSS hay que actualizar `design.snapshot.json` y `design.png` a propósito (y la prueba
`packages/core/src/fixtures.test.ts` avisa si dejan de ser coherentes).

Convenciones del snapshot (iguales a las que usará la captura de la Fase 1):

- Los elementos de **texto** miden la unión de sus líneas, con cada línea del alto de su interlineado (como una capa de texto en Figma).
- Un elemento de caja existe solo si tiene fondo, imagen o texto propio. El encabezado y el pie no tienen fondo, así que no aparecen; sus hijos cuelgan de `page`.
- Los bordes que no son iguales en los cuatro lados (la línea bajo el encabezado y sobre el pie) no se representan.

## Valores que las mutaciones de la Fase 5 romperán

Padding de las tarjetas (16 px), separación entre tarjetas (24 px), color del botón primario (`#043565`),
peso del título (800) y texto de la tarjeta 3 (una sola línea).
