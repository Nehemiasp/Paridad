#!/usr/bin/env node
// Hook PostToolUse (Edit|Write|MultiEdit): corre las pruebas SOLO del paquete que se editó.
// Recibe por stdin el JSON del hook. Si fallan, escribe la salida en stderr y sale con código 2,
// que es lo que hace que Claude vea el fallo y lo corrija. Si no aplica, no hace nada (código 0).
import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_LINES = 60;
const TIMEOUT_MS = 120_000;

/**
 * Decide qué probar para un archivo editado.
 * @returns {{ label: string, cmd: string, args: string[] } | null}
 */
export function testTargetForFile(file, root = ROOT) {
  const rel = relative(root, resolve(root, file));
  if (rel.startsWith("..") || rel === "") return null; // fuera del repositorio
  const parts = rel.split(sep);
  const [top, name] = parts;

  if ((top === "packages" || top === "apps") && name && parts.length > 2) {
    return { label: `${top}/${name}`, cmd: "npm", args: ["test", "-w", `${top}/${name}`, "--if-present"] };
  }
  // Los datos de prueba se validan desde las pruebas de core.
  if (top === "fixtures" && parts.length > 1) {
    return { label: "fixtures (vía @paridad/core)", cmd: "npm", args: ["test", "-w", "packages/core", "--if-present"] };
  }
  if (top === "scripts") {
    return { label: "scripts", cmd: "npx", args: ["vitest", "run", "--project", "scripts"] };
  }
  return null; // docs, CLAUDE.md, configuración…: sin pruebas que correr
}

/** Recorta la salida a las últimas líneas para no inundar el contexto. */
export function tail(text, maxLines = MAX_LINES) {
  const lines = text.split("\n");
  return lines.length <= maxLines ? text : `[… ${lines.length - maxLines} líneas omitidas …]\n${lines.slice(-maxLines).join("\n")}`;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return 0; // sin JSON válido no hay nada que hacer
  }
  const file = input?.tool_input?.file_path ?? input?.tool_response?.filePath;
  if (typeof file !== "string") return 0;

  const target = testTargetForFile(file);
  if (!target) return 0;

  const res = spawnSync(target.cmd, target.args, { cwd: ROOT, encoding: "utf8", timeout: TIMEOUT_MS });
  if (res.status === 0) {
    process.stdout.write(`Pruebas de ${target.label}: en verde.\n`);
    return 0;
  }
  const reason = res.error?.code === "ETIMEDOUT" ? `se agotó el tiempo (${TIMEOUT_MS / 1000} s)` : "fallaron";
  process.stderr.write(`Pruebas de ${target.label}: ${reason}.\n${tail(`${res.stdout ?? ""}${res.stderr ?? ""}`)}\n`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
