# Datos de Figma de la página de ejemplo

`nodes.json` e `images.json` tienen la **forma** de las respuestas de la API REST de Figma
(`GET /v1/files/:key/nodes?ids=…` y `GET /v1/images/:key?ids=…`), con un archivo y un frame **ficticios**
(`AbCdEf123456`, nodo `1:2`).

**No son una grabación de Figma real.** Se construyeron a partir de `../design.snapshot.json`, siguiendo la documentación de la API,
con dos rarezas puestas a propósito para que las pruebas las cubran:

- El frame vive lejos del origen del lienzo de Figma (x = 1200, y = 640), para probar las coordenadas relativas.
- Los textos de varias líneas tienen una capa más ancha que el texto (ancho fijo), y `absoluteRenderBounds` trae el ancho real.
- Hay una capa oculta (`visible: false`) que no debe aparecer.

Pendiente: validar el traductor contra un archivo real con `paridad figma --url <frame>` y un token propio, y
sustituir estos datos por una grabación (anonimizada) si la forma real difiere.
