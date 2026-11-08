"use client";

import { useState } from "react";
import type { Finding, Report } from "@paridad/core";
import { toMarkdown } from "../lib/markdown.ts";

/** Exportar: Markdown para pegar en un issue de GitHub (con lo que se ve en la lista) y PDF. */
export function ExportBar({ report, findings, label, entryId }: { report: Report; findings: Finding[]; label: string; entryId: string }) {
  const [status, setStatus] = useState("");
  const markdown = () => toMarkdown(report, { findings, label });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setStatus("Markdown copiado: péguelo en un issue de GitHub.");
    } catch {
      setStatus("No se pudo copiar automáticamente. Use «Descargar Markdown».");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paridad-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reporte"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Markdown descargado.");
  };

  return (
    <section className="card exports-card" aria-labelledby="exportar">
      <h2 id="exportar">Exportar</h2>
      <div className="exports" style={{ marginTop: 10 }}>
        <button type="button" className="btn primary" onClick={copy}>
          Copiar Markdown
        </button>
        <button type="button" className="btn" onClick={download}>
          Descargar Markdown
        </button>
        <a className="btn" href={`/api/pdf?tab=${encodeURIComponent(entryId)}`} download>
          Descargar PDF
        </a>
        <button type="button" className="btn" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
        El Markdown incluye los {findings.length} hallazgos que ve en la lista (con sus filtros).
      </p>
      <p role="status" aria-live="polite" style={{ marginTop: 6, minHeight: "1.5em" }} data-testid="estado-exportar">
        {status}
      </p>
    </section>
  );
}
