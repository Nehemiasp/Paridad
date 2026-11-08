import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureResult } from "./capture.ts";

/** Guarda `snapshot.json` y la imagen (la que nombra `canvas.image.path`) en una carpeta. */
export function writeCapture(result: CaptureResult, outDir: string): { snapshotPath: string; screenshotPath: string } {
  mkdirSync(outDir, { recursive: true });
  const snapshotPath = join(outDir, "snapshot.json");
  const screenshotPath = join(outDir, result.snapshot.canvas.image?.path ?? "screenshot.png");
  writeFileSync(snapshotPath, JSON.stringify(result.snapshot, null, 2) + "\n");
  writeFileSync(screenshotPath, result.screenshot);
  return { snapshotPath, screenshotPath };
}
