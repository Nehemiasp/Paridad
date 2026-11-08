# Historias para el portafolio

Cada historia es un error de implementación **conocido** sobre la página de ejemplo ficticia («Casa Nube»): lo que se cambió en el código, lo que Paridad encontró y cómo se ve. La imagen `historia.jpg` es la tarjeta lista para publicar (diseño, código, diferencia de píxeles, hallazgos y el `diff` que causó el error) y `caso.md` trae la causa y la evidencia.

Sin nombres de empresas ni de clientes. Se pueden regenerar **todos** los casos (36) con `npm run casos`; en el repositorio solo van estos.

## Errores que Paridad encontró

| Historia | Por qué contarla |
|---|---|
| [El padding pasa de 16 a 20 px](padding-tarjetas-20/caso.md) | El error de la frase de marca: «Padding: diseño 16 px · código 20 px», en tres tarjetas, explicado como **una** causa y no como doce síntomas. |
| [La fuente de los títulos no carga](fuente-del-titulo-no-carga/caso.md) | Un solo hallazgo crítico para todos los textos afectados, no uno por texto. |
| [Una tarjeta desaparece](tarjeta-2-oculta/caso.md) | Falta un elemento: crítico, con lo que había dentro. |
| [Un azul «parecido»](color-boton-parecido/caso.md) | ΔE pequeño pero distinto, y fuera de la paleta: el ojo no lo distingue y la herramienta sí. |
| [Contraste insuficiente](contraste-texto-tarjetas/caso.md) | Texto gris claro sobre blanco (2,3:1): accesibilidad. |
| [Texto cortado](texto-cortado-tarjetas/caso.md) | Un recorte con `-webkit-line-clamp` que cambia más cosas de las que parece. |
| [Separación entre enlaces](separacion-navegacion-40/caso.md) | Un `gap` de CSS: dos huecos que cambian lo mismo se reportan como el hueco, no como «el enlace se movió». |

## Lo que Paridad no debe reportar

| Historia | Por qué contarla |
|---|---|
| [Un cambio de 0,4 px](ruido-padding-tarjetas-16-4/caso.md) | Los píxeles sí cambian, pero por debajo de la tolerancia: no hay hallazgos. Decidir qué *no* reportar fue la decisión de diseño más importante. |

## Donde Paridad se equivocó (y se cuenta)

| Historia | Por qué contarla |
|---|---|
| [Un enlace nuevo en una navegación centrada](enlace-extra-navegacion/caso.md) | El único caso que falla con las propuestas independientes de un subagente: una región mezcla contenido movido y contenido nuevo y queda «sin clasificar». No se ajustó la herramienta para esconderlo. |

## Errores del propio desarrollo

| Historia | Por qué contarla |
|---|---|
| [La píldora decorativa tapaba el texto en móvil](bugs-de-desarrollo/pastilla-sobre-el-texto-en-movil/caso.md) | Las pruebas automáticas y la auditoría de accesibilidad pasaban; una captura de pantalla revisada con los ojos encontró el defecto. |

## Cómo se guardan los errores nuevos

- Cada corrida de `npm run evals` guarda sola, como tarjeta, **cada caso que falla** en `out/evals/fallos/<caso>/`. Si alguno cuenta una buena historia, se promueve a esta carpeta (y se agrega una línea `!docs/casos/<caso>/` al `.gitignore`).
- Los errores del desarrollo (como el de la píldora) se guardan a mano en `bugs-de-desarrollo/<nombre>/` con una captura y un `caso.md`.
