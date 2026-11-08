"use client";

import type { Report } from "@paridad/core";
import { Tablist } from "./Tablist.tsx";
import { boxStyle, fileUrl, stageSize, type Highlight } from "../lib/geometry.ts";

export type ViewMode = "lado" | "superpuesta" | "transparencia" | "calor";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "lado", label: "Lado a lado" },
  { id: "superpuesta", label: "Superpuesta" },
  { id: "transparencia", label: "Transparencia" },
  { id: "calor", label: "Mapa de calor" },
];

function Boxes({ highlights, side, stage }: { highlights: Highlight[]; side: "design" | "page" | "both"; stage: { width: number; height: number } }) {
  return (
    <>
      {highlights.flatMap((h) => {
        const out: React.ReactNode[] = [];
        if ((side === "design" || side === "both") && h.design) {
          out.push(
            <div key={`${h.key}-d`} className="hl design" data-testid="hl-design" style={boxStyle(h.design, stage)}>
              <span>Diseño</span>
            </div>,
          );
        }
        if ((side === "page" || side === "both") && (h.page || h.region)) {
          const b = h.page ?? h.region!;
          out.push(
            <div key={`${h.key}-p`} className="hl page" data-testid="hl-page" style={boxStyle(b, stage)}>
              <span>Código</span>
            </div>,
          );
        }
        return out;
      })}
    </>
  );
}

export interface ViewerProps {
  report: Report;
  entryId: string;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  slider: number;
  onSlider: (n: number) => void;
  opacity: number;
  onOpacity: (n: number) => void;
  highlights: Highlight[];
  selectedRegion: string | undefined;
  onRegion: (id: string | undefined) => void;
  print: boolean;
}

/** Cuatro vistas de comparación: lado a lado, superpuesta con divisor, transparencia ajustable y mapa de calor. */
export function Viewer(p: ViewerProps) {
  const { report, entryId } = p;
  const stage = stageSize(report);
  const ratio = `${stage.width} / ${stage.height}`;
  const designSrc = report.design.imagePath ? fileUrl(entryId, report.design.imagePath) : undefined;
  const pageSrc = report.page.imagePath ? fileUrl(entryId, report.page.imagePath) : undefined;
  const heatSrc = report.visual?.heatmapPath ? fileUrl(entryId, report.visual.heatmapPath) : undefined;
  const mode: ViewMode = p.print ? "lado" : p.mode;

  if (!designSrc || !pageSrc) {
    return (
      <section className="card" aria-labelledby="comparacion">
        <h2 id="comparacion">Comparación</h2>
        <p className="notice" style={{ marginTop: 12 }}>
          Este reporte no trae las imágenes del diseño y de la página, así que no hay vista de comparación. Los hallazgos de la derecha siguen siendo válidos.
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="comparacion">
      <div className="card-head">
        <h2 id="comparacion">Comparación</h2>
        <Tablist items={VIEWS} selected={p.mode} onSelect={(id) => p.onMode(id as ViewMode)} label="Vista de comparación" prefix="vista" className="viewtabs" tabClassName="viewtab" />
      </div>

      <div id="vista-panel" role="tabpanel" aria-labelledby={`vista-tab-${p.mode}`}>
        {mode === "lado" && (
          <>
            <div className="sides">
              <figure className="figure">
                <figcaption>Diseño (Figma)</figcaption>
                <div className="stage" style={{ aspectRatio: ratio }}>
                  <img src={designSrc} alt="Imagen del frame de diseño" />
                  <Boxes highlights={p.highlights} side="design" stage={stage} />
                </div>
              </figure>
              <figure className="figure">
                <figcaption>Código (página construida)</figcaption>
                <div className="stage" style={{ aspectRatio: ratio }}>
                  <img src={pageSrc} alt="Captura de la página construida" />
                  <Boxes highlights={p.highlights} side="page" stage={stage} />
                </div>
              </figure>
            </div>
            {p.print && heatSrc ? (
              <figure className="figure" style={{ marginTop: 12 }}>
                <figcaption>Mapa de calor de diferencias</figcaption>
                <div className="stage" style={{ aspectRatio: ratio }}>
                  <img src={heatSrc} alt="Mapa de calor: dónde difieren los píxeles" />
                </div>
              </figure>
            ) : null}
          </>
        )}

        {mode === "superpuesta" && (
          <>
            <div className="stage" style={{ aspectRatio: ratio }} data-testid="stage-superpuesta">
              <img src={designSrc} alt="Imagen del frame de diseño" />
              <img src={pageSrc} alt="Captura de la página construida" style={{ clipPath: `inset(0 0 0 ${p.slider}%)` }} data-testid="page-layer" />
              <div className="divider" style={{ left: `${p.slider}%` }} aria-hidden="true" />
              <Boxes highlights={p.highlights} side="both" stage={stage} />
            </div>
            <div className="controls">
              <label htmlFor="divisor">A la izquierda del divisor, el diseño; a la derecha, el código</label>
              <input id="divisor" type="range" min={0} max={100} value={p.slider} onChange={(e) => p.onSlider(Number(e.target.value))} aria-valuetext={`Divisor al ${p.slider} %`} />
              <output htmlFor="divisor">{p.slider} %</output>
            </div>
          </>
        )}

        {mode === "transparencia" && (
          <>
            <div className="stage" style={{ aspectRatio: ratio }}>
              <img src={designSrc} alt="Imagen del frame de diseño" />
              <img src={pageSrc} alt="Captura de la página construida" style={{ opacity: p.opacity / 100 }} data-testid="page-layer" />
              <Boxes highlights={p.highlights} side="both" stage={stage} />
            </div>
            <div className="controls">
              <label htmlFor="transparencia">Opacidad del código sobre el diseño</label>
              <input id="transparencia" type="range" min={0} max={100} value={p.opacity} onChange={(e) => p.onOpacity(Number(e.target.value))} aria-valuetext={`Opacidad ${p.opacity} %`} />
              <output htmlFor="transparencia">{p.opacity} %</output>
            </div>
          </>
        )}

        {mode === "calor" &&
          (heatSrc && report.visual ? (
            <>
              <div className="stage" style={{ aspectRatio: `${report.visual.aligned.width} / ${report.visual.aligned.height}` }}>
                <img src={heatSrc} alt="Mapa de calor: amarillo a rojo donde difieren los píxeles; recuadros azules en cada región" />
                {report.visual.regions.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="region"
                    aria-pressed={p.selectedRegion === r.id}
                    aria-label={`Región ${r.id}: ${r.classified ? "explicada" : "sin clasificar"}, ${Math.round(r.box.width)} por ${Math.round(r.box.height)} píxeles`}
                    style={boxStyle(r.box, report.visual!.aligned)}
                    onClick={() => p.onRegion(p.selectedRegion === r.id ? undefined : r.id)}
                  />
                ))}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                {report.visual.regions.length === 0 ? "No hay regiones con diferencias de píxeles." : "Cada recuadro azul es una región con diferencias; púlselo para ver qué la explica."}
              </p>
            </>
          ) : (
            <p className="notice">No hay mapa de calor: la diferencia por píxeles se omitió en esta corrida (falta alguna de las dos imágenes o se usó --no-visual).</p>
          ))}
      </div>
    </section>
  );
}
