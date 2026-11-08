import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "../../../components/AppNav.tsx";
import { Progress } from "../../../components/Progress.tsx";
import { getJob } from "../../../lib/jobs.ts";
import { entryById, isFolderName, workspaceId } from "../../../lib/workspace.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Comparando… · Paridad" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isFolderName(id)) notFound();
  // Si la app se reinició pero el reporte ya está en disco, se abre directamente.
  if (!getJob(id) && entryById(workspaceId(id))) redirect(`/comparaciones/${id}/reporte`);
  return (
    <>
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <main className="shell narrow" id="contenido">
        <AppNav />
        <h1 className="sr-only">Avance de la comparación</h1>
        <div className="stack" style={{ marginTop: 24 }}>
          <Progress id={id} />
        </div>
      </main>
    </>
  );
}
