import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportApp } from "../../../components/ReportApp.tsx";
import { isFolderName, workspaceItem } from "../../../lib/workspace.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reportes de paridad · Paridad" };

/** Varias comparaciones juntas, una pestaña por tamaño: `/comparaciones/abrir?c=<carpeta>&c=<carpeta>`. */
export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string | string[]; print?: string }> }) {
  const sp = await searchParams;
  const folders = [...new Set([sp.c ?? []].flat())].filter(isFolderName).slice(0, 8);
  const items = folders.flatMap((f) => workspaceItem(f) ?? []);
  if (items.length === 0) notFound();
  return <ReportApp items={items} initialTab={0} print={sp.print === "1"} />;
}
