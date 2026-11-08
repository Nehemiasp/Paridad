# Paridad en cada pull request

> **Estado: sin probar en GitHub real.** Lo que sí está probado: `npm run paridad -- ci` (compara varias pantallas, escribe el comentario y devuelve el código de salida), el formato del comentario, y la estructura de la acción y del flujo de ejemplo (que sean YAML válido, que el token entre por una variable de entorno y no por la línea de comandos, que se comente aunque falle el puntaje, etc.). Lo que no: la ejecución dentro de GitHub Actions. Pruébelo primero en una rama.

## Cómo se usa

1. Cree `paridad.screens.json` en la raíz (hay un modelo en [`paridad.screens.example.json`](../paridad.screens.example.json)):

   ```json
   {
     "failUnder": 80,
     "screens": [
       { "name": "Inicio · escritorio", "figma": "https://www.figma.com/design/CLAVE/Nombre?node-id=1-2", "page": "http://localhost:3000/" },
       { "name": "Inicio · móvil", "figma": "https://www.figma.com/design/CLAVE/Nombre?node-id=1-9", "page": "http://localhost:3000/", "width": 390 }
     ]
   }
   ```

2. Guarde el token de Figma (solo lectura) como secreto del repositorio: `FIGMA_TOKEN`.
3. Copie [`docs/examples/paridad-pr.yml`](examples/paridad-pr.yml) a `.github/workflows/paridad.yml` y agregue el paso que levanta su aplicación en `localhost:3000`.

La acción ([`.github/actions/paridad/action.yml`](../.github/actions/paridad/action.yml)) instala dependencias y Chromium, corre `paridad ci`, sube los reportes completos como artefacto y **publica o actualiza** un comentario con una tabla de puntajes y los hallazgos críticos y altos de cada pantalla. Si una pantalla queda por debajo de `failUnder`, el paso falla (después de comentar).

## Seguridad

- El flujo corre con `pull_request`, **no** con `pull_request_target`: así el código de un fork no recibe secretos. Consecuencia: en pull requests de forks no hay token y la comprobación no puede correr.
- Permisos mínimos: `contents: read` y `pull-requests: write`.
- El token entra por una variable de entorno y nunca se interpola dentro de un script; ninguna entrada de la acción se interpola dentro de `run:` (una prueba lo vigila).
- Las acciones de terceros están fijadas a una versión mayor (`@v4`, `@v7`); fíjelas a un *commit* si su organización lo exige.

## Limitaciones

- Necesita una aplicación accesible por URL durante la ejecución (usted decide cómo levantarla).
- El resultado depende de que la fuente del diseño cargue igual en el entorno de integración continua.
- Compara un tamaño de ventana por pantalla: para escritorio y móvil, dos entradas.
