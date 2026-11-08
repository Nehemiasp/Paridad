import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { snapshotJsonSchema } from "../packages/core/src/snapshot/json-schema.ts";

const out = fileURLToPath(new URL("../docs/snapshot.schema.json", import.meta.url));
writeFileSync(out, JSON.stringify(snapshotJsonSchema(), null, 2) + "\n");
console.log(`JSON Schema escrito en ${out}`);
