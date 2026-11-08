# El formato «snapshot»

Todo en Paridad se convierte al mismo formato: tanto el frame de Figma (`source: "design"`) como la página construida (`source: "page"`).
El motor de comparación solo ve snapshots; no sabe de Figma ni de navegadores. Por eso se puede probar sin red.

- Definición: `packages/core/src/snapshot/schema.ts` (Zod, única fuente de verdad).
- JSON Schema generado: `docs/snapshot.schema.json` (`npm run schema:json`). Una prueba falla si está desactualizado.
- Validar datos: `parseSnapshot(data)` (devuelve errores en español) o `assertSnapshot(data)` (lanza).
- Ejemplo real: `fixtures/landing/design.snapshot.json`.

## Unidades y convenciones

| Convención | Detalle |
|---|---|
| Distancias | Píxeles CSS, con origen en la esquina superior izquierda del lienzo. |
| Colores | Cadena `#rrggbb` o `#rrggbbaa`, **siempre en minúsculas**. |
| Escala | `canvas.scale` (1 o 2) solo indica la escala de la imagen; todas las cajas están en px CSS. |
| Coordenadas | De lienzo (no de ventana): ya incluyen el desplazamiento de la página. |
| `lineHeight` | En px; `null` significa «normal» (lo calcula el navegador). |
| `letterSpacing` | En px; `0` si no hay. |

## Estructura

```
Snapshot
├─ schemaVersion        1
├─ source               "design" | "page"
├─ meta                 { name, capturedAt (ISO 8601), origin: { figma?: {fileKey,nodeId}, url? }, tool? }
├─ canvas               { width, height, scale: 1|2, image?: { path, width, height } }
├─ palette?             { colors: [{hex,name?}], fonts: [{family, weights[]}] }      (sobre todo del diseño)
├─ ignore               [ { selector } | { rect: {x,y,width,height} } ]              (por defecto [])
└─ elements[]           Element
```

### Element

| Campo | Tipo | Quién lo llena | Notas |
|---|---|---|---|
| `id` | string | ambos | Único en el snapshot. |
| `kind` | `"text"` \| `"box"` \| `"image"` | ambos | |
| `name` | string? | ambos | Capa de Figma o etiqueta/clase del DOM, para mostrar. |
| `path` | string? | ambos | Ruta de origen: selector DOM o ruta de capas de Figma. |
| `parentId` | string \| null | ambos | `null` en la raíz. Define la jerarquía y el fondo efectivo. |
| `z` | entero | ambos | Orden de pintura; mayor = encima. |
| `box` | `{x,y,width,height}` | ambos | `width` y `height` ≥ 0. Para texto: unión de sus líneas, cada una con el alto de su interlineado. |
| `text` | `{content, normalized, clipped?}` | ambos | Obligatorio si `kind="text"`; prohibido en los demás. |
| `style` | ver abajo | ambos | |
| `image` | `{src?, alt?}` | ambos | Solo si `kind="image"`. |

`text.normalized` es `normalizeText(content)`: NFKC, espacios (incluido el duro) colapsados y recortados; **no** cambia mayúsculas.
`text.clipped.reason` es `"overflow"`, `"ellipsis"` o `"line-clamp"` y solo aparece si el texto está cortado (lo detecta la captura; Figma no lo informa).

### Style (todo opcional)

`fontFamily`, `renderedFontFamily` (solo páginas: la fuente que el navegador pintó de verdad; si difiere de `fontFamily`, la fuente no cargó), `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `color` (del texto), `background`, `border {width, style?, color}`,
`radius` (número, o `[arriba-izq, arriba-der, abajo-der, abajo-izq]`), `shadows [{x,y,blur,spread,color,inset?}]`, `opacity` (0–1).

## Reglas que `parseSnapshot` aplica además del tipo de cada campo

1. Los `id` son únicos.
2. Todo `parentId` existe, no es el propio elemento y la jerarquía no forma ciclos.
3. `kind="text"` exige `text`; `text` solo en elementos de texto; `image` solo en elementos de imagen.
4. `text.normalized` coincide con `normalizeText(text.content)`.
5. Si hay `canvas.image`, mide `width × scale` por `height × scale` (se admite 1 px de diferencia: Figma redondea al exportar).
6. Las zonas `ignore` por `rect` quedan dentro del lienzo.

(JSON Schema no puede expresar 1–6; por eso la validación completa es `parseSnapshot`, no el `.schema.json`.)

## Limitaciones conocidas del formato

- Un elemento de caja solo existe si tiene fondo, imagen o texto propio; los contenedores sin fondo no aparecen (sus hijos cuelgan del ancestro más cercano que sí existe).
- Los bordes distintos en cada lado no se representan; solo un borde uniforme.
- No hay gradientes ni imágenes de fondo: son una extensión futura (`schemaVersion` 2).
- Cada snapshot corresponde a **un** tamaño de ventana; no se interpolan tamaños intermedios.

## Ejemplo mínimo

```json
{
  "schemaVersion": 1,
  "source": "page",
  "meta": { "name": "demo", "capturedAt": "2026-11-08T00:00:00.000Z", "origin": { "url": "http://localhost:3000" } },
  "canvas": { "width": 1440, "height": 900, "scale": 1 },
  "ignore": [{ "selector": ".fecha" }],
  "elements": [
    { "id": "page", "kind": "box", "parentId": null, "z": 0,
      "box": { "x": 0, "y": 0, "width": 1440, "height": 900 }, "style": { "background": "#fafaf8" } },
    { "id": "titulo", "kind": "text", "parentId": "page", "z": 1,
      "box": { "x": 84, "y": 175.5, "width": 619.47, "height": 136 },
      "text": { "content": "Cerámica hecha con calma", "normalized": "Cerámica hecha con calma" },
      "style": { "fontFamily": "Bricolage Grotesque", "fontSize": 64, "fontWeight": 800, "lineHeight": 68, "letterSpacing": -1.28, "color": "#0e1116" } }
  ]
}
```
