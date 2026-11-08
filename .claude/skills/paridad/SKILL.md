---
name: paridad
description: Compara un frame de Figma con la página construida y resume los hallazgos críticos y altos con su evidencia (Paridad). Recibe el enlace del frame y la URL de la página.
argument-hint: <enlace del frame de Figma> <URL de la página> [ancho en px]
disable-model-invocation: true
allowed-tools: Bash(npm run paridad -- compare *), Bash(npm run paridad -- summary *), Read
---

# /paridad — ¿el código coincide con el diseño?

Usted compara **un frame de Figma** con **una página ya construida** y le dice a la persona qué no coincide, con números. No arregla nada salvo que se lo pidan.

Argumentos recibidos: `$ARGUMENTS`

Si la persona prefiere hacerlo con una pantalla en lugar de la terminal, existe `npm run app` (formulario, avance e historial); usted no la lanza: solo menciónela.

## 1. Entender qué se pidió

- El **primer** argumento es el enlace del frame (`https://www.figma.com/design/<clave>/…?node-id=1-2`). Debe traer `node-id`; si no, pídale a la persona que copie el enlace de la *selección* (clic derecho → *Copy link to selection*).
- El **segundo** es la URL de la página (`http://localhost:3000/…`, `https://…` o `file://…`). **Solo se captura lo que la persona indica**: nunca siga enlaces ni agregue otras páginas.
- Un **tercero** opcional es el ancho de la ventana en px. Si falta, se usa el ancho del frame (lo correcto casi siempre).
- Si falta alguno de los dos primeros, pregunte por él y no adivine.

## 2. Antes de correr

- Hace falta `FIGMA_TOKEN` en `.env.local` (token personal de solo lectura). **Nunca** le pida a la persona que pegue el token en la conversación, no lo imprima ni lo escriba en ningún archivo. Si falta, explique dónde se crea y dónde se guarda, y deténgase.
- Si la página es `localhost`, confirme (sin asumir) que el servidor de desarrollo está levantado; si la captura falla por conexión, dígalo.
- **No** use `--ai` salvo que la persona lo pida: gasta dinero y por defecto está apagada.

## 3. Correr la comparación

Elija una carpeta nueva con fecha y use **solo** estos comandos:

```bash
npm run paridad -- compare --figma "<enlace del frame>" --page "<URL de la página>" --out out/paridad-<AAAAMMDD-HHMM>
npm run paridad -- summary --dir out/paridad-<AAAAMMDD-HHMM> --json
```

No use `--open` (abriría un servidor y esperaría). El primer comando puede tardar unos segundos (lee Figma, abre Chromium y captura).

## 4. Resumir

Lea el JSON de `summary` y responda **en español, tratando de «usted»**, breve:

1. **Puntaje** de paridad (0–100) y el conteo por severidad.
2. Las **críticas**, y luego las **altas**, una línea cada una: qué es, valor del diseño frente a valor del código, y el elemento. Agrupe las que tienen una causa común (por ejemplo, varias de padding en las tarjetas) en una sola línea, diciendo cuántas son.
3. Si hay una de **fuente no cargada** (`font-not-loaded`), menciónela primero y dígalo una sola vez: es la causa de muchas diferencias de texto.
4. Si hay diferencias visuales **sin clasificar** (`visual.unclassified > 0`), dígalo: son píxeles que cambiaron sin que ninguna regla lo explique y conviene mirar el mapa de calor.
5. Cierre con la carpeta del reporte completo y cómo verlo: `npm run paridad -- report --dir <carpeta>`.

Reglas de redacción:

- **Cite solo cifras que estén en la salida.** No estime, no redondee a su gusto, no invente causas ni valores de CSS. Si propone una corrección, que el valor salga del campo `expected`.
- No minimice ni exagere: si no hay críticas ni altas, dígalo y mencione cuántas hay de menor severidad.
- Lo que Paridad no puede saber (contenido dinámico, estados hover, otros tamaños de ventana) no se afirma.

## 5. Si algo falla

| Síntoma | Qué decir |
|---|---|
| «Falta el token de Figma» | Dónde crear el token (Settings → Security → Personal access tokens, solo lectura) y guardarlo en `.env.local` como `FIGMA_TOKEN=…`. |
| «Figma rechazó el token (403)» | Token vencido, sin permiso de lectura o sin acceso a ese archivo. |
| «La URL no indica un frame» | Pedir el enlace de la selección, con `node-id`. |
| Error de conexión al capturar | La página no responde: ¿está levantado el servidor? |
| «no son comparables» (crítica de lienzo) | El ancho de la ventana no coincide con el del frame; repetir sin `--width` o con el del frame. |

No reintente en bucle ni cambie de estrategia para «hacerlo funcionar»: informe el error con sus palabras y pregunte.
