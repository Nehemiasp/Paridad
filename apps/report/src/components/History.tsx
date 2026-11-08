"use client";

import { useState } from "react";
import type { Severity } from "@paridad/core";
import { SEVERITY_COLORS, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_SHAPE, formatDate, sizeLabel } from "../lib/labels.ts";
import type { HistoryItem } from "../lib/workspace.ts";

/** Comparaciones guardadas. Se abren una a una o varias juntas (una pestaña por tamaño). No hay botón de borrar: no se borran datos de la persona. */
export function History({ items }: { items: HistoryItem[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (folder: string) => setPicked((p) => (p.includes(folder) ? p.filter((f) => f !== folder) : [...p, folder]));
  const openTogether = `/comparaciones/abrir?${picked.map((f) => `c=${encodeURIComponent(f)}`).join("&")}`;

  return (
    <section className="card" aria-labelledby="historial-titulo" id="historial">
      <div className="card-head">
        <h2 id="historial-titulo">Comparaciones anteriores</h2>
        {items.length > 1 ? (
          picked.length >= 2 ? (
            <a className="btn primary" href={openTogether}>
              Abrir {picked.length} juntas
            </a>
          ) : (
            <span className="muted" style={{ fontSize: "0.88rem" }}>
              Marque dos o más para verlas juntas, una pestaña por tamaño.
            </span>
          )
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="muted">Aún no hay comparaciones. La primera que haga aparecerá aquí.</p>
      ) : (
        <ul className="history">
          {items.map((it) => (
            <li key={it.id} className="history-item">
              {items.length > 1 ? (
                <label className="pick">
                  <input type="checkbox" checked={picked.includes(it.folder)} onChange={() => toggle(it.folder)} />
                  <span className="sr-only">Elegir «{it.title}», {sizeLabel(it.width)}, para abrir junto con otras</span>
                </label>
              ) : null}
              <a className="history-link" href={`/comparaciones/${encodeURIComponent(it.folder)}/reporte`}>
                <span className="history-score" aria-label={`Puntaje ${it.score} de 100`}>
                  {it.score}
                </span>
                <span className="history-main">
                  <span className="history-title">{it.title}</span>
                  <span className="muted history-sub">
                    {sizeLabel(it.width)} · {formatDate(it.createdAt)}
                    {it.pageUrl ? ` · ${it.pageUrl}` : ""}
                  </span>
                  <span className="history-chips">
                    {SEVERITY_ORDER.filter((s: Severity) => (it.bySeverity[s] ?? 0) > 0).map((s) => {
                      const c = SEVERITY_COLORS[s];
                      const n = it.bySeverity[s] ?? 0;
                      return (
                        <span key={s} className="sev" style={{ color: c.fg, background: c.bg, borderColor: c.border }}>
                          <span aria-hidden="true">{SEVERITY_SHAPE[s]}</span> {n} {SEVERITY_LABEL[s].toLowerCase()}
                          {n === 1 ? "" : "s"}
                        </span>
                      );
                    })}
                    {it.total === 0 ? <span className="muted">Sin hallazgos</span> : null}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
