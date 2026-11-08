import { envStatus } from "../../../lib/env.ts";
import { guardWrite } from "../../../lib/guard.ts";
import { startJob } from "../../../lib/jobs.ts";
import { validateInput, type RawInput } from "../../../lib/validate.ts";

export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;

/** Crea una comparación: valida en el servidor, comprueba el entorno y lanza el CLI. Un trabajo a la vez. */
export async function POST(req: Request) {
  const denied = guardWrite(req);
  if (denied) return denied;

  let raw: RawInput;
  try {
    const body = await req.text();
    if (body.length > MAX_BODY) return Response.json({ error: "La petición es demasiado grande." }, { status: 413 });
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("forma");
    raw = parsed as RawInput;
  } catch {
    return Response.json({ error: "La petición no es un JSON válido." }, { status: 400 });
  }

  const checked = validateInput(raw);
  if (!checked.ok) return Response.json({ errors: checked.errors }, { status: 422 });

  const started = startJob(checked.value, { status: await envStatus() });
  if (!started.ok) return Response.json({ error: started.error }, { status: started.status });
  return Response.json({ id: started.job.id }, { status: 201 });
}
