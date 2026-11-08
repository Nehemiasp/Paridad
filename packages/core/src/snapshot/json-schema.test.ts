import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { snapshotJsonSchema } from "./json-schema.ts";

describe("docs/snapshot.schema.json", () => {
  it("está al día con el esquema de Zod (ejecute `npm run schema:json` si falla)", () => {
    const file = fileURLToPath(new URL("../../../../docs/snapshot.schema.json", import.meta.url));
    const committed = JSON.parse(readFileSync(file, "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(snapshotJsonSchema())));
  });
});
