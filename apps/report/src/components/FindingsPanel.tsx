"use client";

import type { Category, Finding, Report, Severity } from "@paridad/core";
import { CATEGORIES, CATEGORY_LABEL, SEVERITY_COLORS, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_SHAPE } from "../lib/labels.ts";
import { countBy, type Filters } from "../lib/filters.ts";
import { fmtValue } from "../lib/geometry.ts";

export function SeverityBadge({ severity }: { severity: Severity }) {
  const c = SEVERITY_COLORS[severity];
  return (
    <span className="sev" style={{ color: c.fg, background: c.bg, borderColor: c.border }}>
      <span aria-hidden="true">{SEVERITY_SHAPE[severity]}</span>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export interface FindingsPanelProps {
  report: Report;
  findings: Finding[];
  visible: Finding[];
  filters: Filters;
  onToggleSeverity: (s: Severity) => void;
  onCategories: (c: Category | "") => void;
  onShowDiscarded: (b: boolean) => void;
  onClear: () => void;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  discarded: Map<string, string>;
  groupId: string | undefined;
  onGroup: (id: string | undefined) => void;
}

/** Lista filtrable de hallazgos: al elegir uno se resaltan sus cajas en ambas imágenes y se muestra lo esperado contra lo obtenido. */
export function FindingsPanel(p: FindingsPanelProps) {
  const selected = p.visible.find((f) => f.id === p.selectedId);
  const sevCounts = countBy(p.findings, (f) => f.severity);
  const active = p.filters.severities.size + p.filters.categories.size > 0 || p.filters.showDiscarded;
  const category = [...p.filters.categories][0] ?? "";
  const ai = p.report.ai;

  return (
    <div>
      {ai ? (
        <section className="card" aria-labelledby="ia">
          <h2 id="ia">Resumen agrupado</h2>
          {ai.mode === "simulado" ? (
            <p className="notice" style={{ marginTop: 8 }}>
              <strong>Simulado:</strong> prueba de la tubería, no lo escribió un modelo.
            </p>
          ) : null}
          {ai.groups.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>La IA no agrupó nada{ai.warnings[0] ? `: ${ai.warnings[0]}` : "."}</p> : null}
          <ul className="list" style={{ marginTop: 8, maxHeight: 220 }}>
            {ai.groups.map((g) => (
              <li key={g.id}>
                <button type="button" className="item" aria-pressed={p.groupId === g.id} aria-current={p.groupId === g.id} onClick={() => p.onGroup(p.groupId === g.id ? undefined : g.id)}>
                  <span className="title">{g.title}</span>
                  <span className="muted">{g.explanation}</span>
                  {g.cssFix ? <code>{g.cssFix}</code> : null}
                  <span className="tag">{g.findingIds.length} hallazgos</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
            {ai.rejected.length} cosas rechazadas por no apoyarse en la evidencia · costo US$ {ai.costUsd.toFixed(4)} · {ai.model}
          </p>
        </section>
      ) : null}

      <section className="card" aria-labelledby="hallazgos">
        <div className="card-head">
          <h2 id="hallazgos">Hallazgos</h2>
          <p className="muted" role="status" aria-live="polite" data-testid="conteo">
            {p.visible.length} de {p.findings.length}
          </p>
        </div>

        <div className="filters" role="group" aria-label="Filtros">
          <div className="filter-row" role="group" aria-label="Severidad">
            {SEVERITY_ORDER.map((s) => (
              <button key={s} type="button" className="toggle" aria-pressed={p.filters.severities.has(s)} onClick={() => p.onToggleSeverity(s)}>
                <span aria-hidden="true">{SEVERITY_SHAPE[s]} </span>
                {SEVERITY_LABEL[s]} ({sevCounts[s] ?? 0})
              </button>
            ))}
          </div>
          <div className="filter-row">
            <label htmlFor="tipo">Tipo</label>
            <select id="tipo" value={category} onChange={(e) => p.onCategories(e.target.value as Category | "")}>
              <option value="">Todos</option>
              {CATEGORIES.filter((c) => p.findings.some((f) => f.category === c)).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            {p.discarded.size > 0 ? (
              <button type="button" className="toggle" aria-pressed={p.filters.showDiscarded} onClick={() => p.onShowDiscarded(!p.filters.showDiscarded)}>
                Mostrar posible ruido ({p.discarded.size})
              </button>
            ) : null}
            {active ? (
              <button type="button" className="toggle" onClick={p.onClear}>
                Quitar filtros
              </button>
            ) : null}
          </div>
        </div>

        {p.visible.length === 0 ? (
          <p className="notice">{p.findings.length === 0 ? "No hay diferencias: el código coincide con el diseño dentro de las tolerancias. ✅" : "Ningún hallazgo coincide con los filtros."}</p>
        ) : (
          <ul className="list" aria-label="Lista de hallazgos">
            {p.visible.map((f) => (
              <li key={f.id}>
                <button type="button" className="item" aria-current={f.id === p.selectedId} onClick={() => p.onSelect(f.id === p.selectedId ? undefined : f.id)} data-testid="hallazgo">
                  <span className="top">
                    <SeverityBadge severity={f.severity} />
                    <span className="tag">{CATEGORY_LABEL[f.category]}</span>
                    {p.discarded.has(f.id) ? <span className="badge">Posible ruido</span> : null}
                  </span>
                  <span className="title">{f.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? <Detail finding={selected} discardedReason={p.discarded.get(selected.id)} report={p.report} /> : null}
    </div>
  );
}

function Detail({ finding: f, discardedReason, report }: { finding: Finding; discardedReason: string | undefined; report: Report }) {
  const e = f.evidence;
  const group = report.ai?.groups.find((g) => g.findingIds.includes(f.id));
  return (
    <section className="card detail" aria-labelledby="detalle" data-testid="detalle">
      <h2 id="detalle">Detalle</h2>
      <p style={{ marginTop: 8 }}>
        <SeverityBadge severity={f.severity} /> <span className="tag">{CATEGORY_LABEL[f.category]}</span>
      </p>
      <p style={{ marginTop: 8, color: "var(--ink)", fontWeight: 500 }}>{f.title}</p>
      <div className="compare-row">
        <div>
          <p className="label">Diseño (esperado)</p>
          <p className="value" data-testid="esperado">
            {fmtValue(e.expected)}
          </p>
        </div>
        <div>
          <p className="label">Código (obtenido)</p>
          <p className="value" data-testid="obtenido">
            {fmtValue(e.actual)}
          </p>
        </div>
      </div>
      <dl>
        <dt>Propiedad</dt>
        <dd>{e.property}</dd>
        {e.delta !== undefined ? (
          <>
            <dt>Diferencia</dt>
            <dd>
              {e.delta}
              {e.unit ? ` ${e.unit}` : ""}
            </dd>
          </>
        ) : null}
        {e.extra ? (
          <>
            <dt>Datos</dt>
            <dd>{fmtValue(e.extra)}</dd>
          </>
        ) : null}
        <dt>Regla</dt>
        <dd>
          <code>{f.rule}</code>
        </dd>
        {f.design ? (
          <>
            <dt>Caja en el diseño</dt>
            <dd>
              {f.design.name ? `${f.design.name} · ` : ""}x {f.design.box.x}, y {f.design.box.y}, {f.design.box.width} × {f.design.box.height} px
            </dd>
          </>
        ) : null}
        {f.page ? (
          <>
            <dt>Caja en el código</dt>
            <dd>
              {f.page.name ? `${f.page.name} · ` : ""}x {f.page.box.x}, y {f.page.box.y}, {f.page.box.width} × {f.page.box.height} px
            </dd>
          </>
        ) : null}
        {f.related?.length ? (
          <>
            <dt>Relacionados</dt>
            <dd>{f.related.length} elemento{f.related.length === 1 ? "" : "s"} más afectado{f.related.length === 1 ? "" : "s"}</dd>
          </>
        ) : null}
        {group ? (
          <>
            <dt>Resumen</dt>
            <dd>
              {group.title}
              {group.cssFix ? (
                <>
                  {" "}
                  → <code>{group.cssFix}</code>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {discardedReason ? (
          <>
            <dt>Posible ruido</dt>
            <dd>{discardedReason}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
