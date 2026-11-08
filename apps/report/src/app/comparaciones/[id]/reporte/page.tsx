import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportApp } from "../../../../components/ReportApp.tsx";
import { isFolderName, workspaceItem } from "../../../../lib/workspace.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reporte de paridad · Paridad" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const item = isFolderName(id) ? workspaceItem(id) : undefined;
  if (!item) notFound();
  return <ReportApp items={[item]} initialTab={0} print={sp.print === "1"} />;
}
