import { ReportApp } from "../components/ReportApp.tsx";
import { loadAll } from "../lib/load.ts";

// El reporte se lee del disco en cada visita: se genera con `paridad compare` y no se conoce al compilar la app.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; print?: string }> }) {
  const sp = await searchParams;
  const items = loadAll().map((l) => ({ id: l.entry.id, label: l.entry.label || `Reporte ${Number(l.entry.id) + 1}`, report: l.report ?? null, error: l.error ?? null }));
  const tab = Math.min(Math.max(0, Number.parseInt(sp.tab ?? "0", 10) || 0), Math.max(0, items.length - 1));
  return <ReportApp items={items} initialTab={tab} print={sp.print === "1"} />;
}
