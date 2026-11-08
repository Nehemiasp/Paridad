#!/usr/bin/env node
// Punto de entrada: registra tsx para poder ejecutar el TypeScript de los paquetes sin compilar (D-003).
import { register } from "tsx/esm/api";

register();
const { run } = await import("../src/main.ts");
process.exitCode = await run(process.argv.slice(2));
