import type { Report, Severity } from "@paridad/core";
import { CATEGORY_LABEL, SEVERITY_COLORS, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_SHAPE, formatDate } from "../lib/labels.ts";
import { BrandMotif } from "./BrandMotif.tsx";

function Chip({ severity, count }: { severity: Severity; count: number }) {
  const c = SEVERITY_COLORS[severity];
  return (
    <li className="chip" style={{ color: c.fg, background: c.bg, borderColor: c.border }}>
      <span aria-hidden="true">{SEVERITY_SHAPE[severity]}</span>
      <span>
        {count} {SEVERITY_LABEL[severity].toLowerCase()}
        {count === 1 ? "" : "s"}
      </span>
    </li>
  );
}

/** Puntaje grande, conteo por severidad y qué se comparó (frame, URL, tamaño y fecha). */
export function Header({ report, label }: { report: Report; label: string }) {
  const { design, page, summary, score, visual } = report;
  const figma = design.origin.figma;
  return (
    <header className="hero" aria-labelledby="titulo">
      <BrandMotif />
      <div className="hero-body">
        <div>
          <div className="brand">
            <span className="pill">Paridad</span>
            <span className="muted">{label}</span>
          </div>
          <h1 id="titulo" className="sr-only">
            Reporte de paridad entre diseño y código
          </h1>
          <p className="score" role="img" aria-label={`Puntaje de paridad: ${score.value} de 100`}>
            <span className="score-number">{score.value}</span>
            <span className="score-of">/ 100</span>
          </p>
          <p className="muted">Puntaje de paridad</p>
        </div>
        <div>
          <h2>¿Qué se comparó?</h2>
          <ul className="chips" aria-label="Hallazgos por severidad">
            {SEVERITY_ORDER.map((s) => (
              <Chip key={s} severity={s} count={summary.bySeverity[s] ?? 0} />
            ))}
          </ul>
          <dl className="meta">
            <div>
              <dt>Frame de diseño</dt>
              <dd>
                {design.name}
                {figma ? <span className="muted"> · Figma {figma.fileKey}, nodo {figma.nodeId}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Página construida</dt>
              <dd>{page.origin.url ?? page.name}</dd>
            </div>
            <div>
              <dt>Tamaño</dt>
              <dd>
                {page.canvas.width} × {page.canvas.height} px · escala {page.canvas.scale}
              </dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{formatDate(report.createdAt)}</dd>
            </div>
            {visual ? (
              <div>
                <dt>Diferencia visual</dt>
                <dd>
                  {(visual.diffRatio * 100).toFixed(2)} % de los píxeles · {visual.regions.length} región{visual.regions.length === 1 ? "" : "es"}
                </dd>
              </div>
            ) : null}
          </dl>
          <details className="formula">
            <summary>¿Cómo se calcula el puntaje?</summary>
            <p className="muted" style={{ marginTop: 8 }}>
              {score.formula}
            </p>
            {score.breakdown.length ? (
              <table className="table">
                <caption className="sr-only">Puntos que resta cada categoría</caption>
                <thead>
                  <tr>
                    <th scope="col">Categoría</th>
                    <th scope="col">Hallazgos</th>
                    <th scope="col">Puntos que resta</th>
                  </tr>
                </thead>
                <tbody>
                  {score.breakdown.map((b) => (
                    <tr key={b.category}>
                      <th scope="row">{CATEGORY_LABEL[b.category]}</th>
                      <td>{b.count}</td>
                      <td>
                        {b.points}
                        {b.capped ? ` (tope; sin tope serían ${b.rawPoints})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ marginTop: 8 }}>No hay hallazgos: no se resta ningún punto.</p>
            )}
          </details>
        </div>
      </div>
    </header>
  );
}
