import type { Metadata } from "next";
import { AppNav } from "../../components/AppNav.tsx";
import { EnvStatus } from "../../components/EnvStatus.tsx";
import { History } from "../../components/History.tsx";
import { NewComparison } from "../../components/NewComparison.tsx";
import { envStatus } from "../../lib/env.ts";
import { sessionToken } from "../../lib/guard.ts";
import { listComparisons } from "../../lib/workspace.ts";

// El estado del entorno y el historial se leen del disco en cada visita.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nueva comparación · Paridad" };

export default async function Page() {
  const [env, history] = [await envStatus(), listComparisons()];
  return (
    <>
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <main className="shell narrow" id="contenido">
        <AppNav current="nueva" />
        <h1 className="page-title">Paridad</h1>
        <p className="lead">Compare un diseño de Figma con la página construida y vea, con evidencia medible, lo que no coincide.</p>
        <div className="stack">
          <NewComparison token={sessionToken()} env={env} />
          <EnvStatus status={env} />
          <History items={history} />
        </div>
      </main>
    </>
  );
}
