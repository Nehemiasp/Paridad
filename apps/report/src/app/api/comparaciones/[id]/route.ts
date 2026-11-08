import { guardHost } from "../../../../lib/guard.ts";
import { getJob, stepsOf } from "../../../../lib/jobs.ts";
import { isFolderName } from "../../../../lib/workspace.ts";

export const dynamic = "force-dynamic";

/** Estado de una comparación: pasos, últimas líneas del CLI (sin secretos) y, al terminar, el id del reporte. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guardHost(req);
  if (denied) return denied;
  const { id } = await params;
  const job = isFolderName(id) ? getJob(id) : undefined;
  if (!job) return Response.json({ error: "No encuentro esa comparación. Quizá se reinició la app: revise el historial." }, { status: 404, headers: { "cache-control": "no-store" } });
  return Response.json(
    {
      id: job.id,
      state: job.state,
      summary: job.summary,
      demo: job.demo,
      steps: stepsOf(job),
      lines: job.lines.slice(-30),
      error: job.error ?? null,
      reportId: job.reportId ?? null,
      elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
