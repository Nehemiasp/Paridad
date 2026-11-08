"use client";

import { useMemo, useState } from "react";
import type { Category, Report, Severity } from "@paridad/core";
import { filterFindings, NO_FILTERS, toggle, type Filters } from "../lib/filters.ts";
import { highlightsFor } from "../lib/geometry.ts";
import { AppNav } from "./AppNav.tsx";
import { ExportBar } from "./ExportBar.tsx";
import { FindingsPanel } from "./FindingsPanel.tsx";
import { Header } from "./Header.tsx";
import { Tablist } from "./Tablist.tsx";
import { Viewer, type ViewMode } from "./Viewer.tsx";

export interface Item {
  id: string;
  label: string;
  report: Report | null;
  error: string | null;
}

function ReportView({ item, report, print }: { item: Item; report: Report; print: boolean }) {
  const [mode, setMode] = useState<ViewMode>("lado");
  const [slider, setSlider] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [groupId, setGroupId] = useState<string | undefined>();
  const [regionId, setRegionId] = useState<string | undefined>();

  const discarded = useMemo(() => new Map((report.ai?.discarded ?? []).map((d) => [d.findingId, d.reason])), [report]);
  const visible = useMemo(() => filterFindings(report.findings, filters, new Set(discarded.keys())), [report, filters, discarded]);

  // Qué se resalta: el hallazgo elegido, o todos los de un grupo del resumen, o los de una región del mapa de calor.
  const highlighted = useMemo(() => {
    const group = report.ai?.groups.find((g) => g.id === groupId);
    const region = report.visual?.regions.find((r) => r.id === regionId);
    const ids = new Set<string>(group ? group.findingIds : region ? region.findingIds : selectedId ? [selectedId] : []);
    const list = report.findings.filter((f) => ids.has(f.id));
    const h = highlightsFor(list);
    if (region && list.length === 0) h.push({ key: region.id, label: region.id, region: region.box });
    return h;
  }, [report, selectedId, groupId, regionId]);

  const select = (id: string | undefined) => {
    setSelectedId(id);
    setGroupId(undefined);
    setRegionId(undefined);
  };

  return (
    <div className={print ? "print-mode" : undefined}>
      <Header report={report} label={item.label} />
      <div className="layout">
        <div>
          <Viewer
            report={report}
            entryId={item.id}
            mode={mode}
            onMode={setMode}
            slider={slider}
            onSlider={setSlider}
            opacity={opacity}
            onOpacity={setOpacity}
            highlights={highlighted}
            selectedRegion={regionId}
            onRegion={(id) => {
              setRegionId(id);
              setSelectedId(undefined);
              setGroupId(undefined);
            }}
            print={print}
          />
          {!print ? <ExportBar report={report} findings={visible} label={item.label} entryId={item.id} /> : null}
        </div>
        <FindingsPanel
          report={report}
          findings={report.findings}
          visible={visible}
          filters={filters}
          onToggleSeverity={(s: Severity) => setFilters((f) => ({ ...f, severities: toggle(f.severities, s) }))}
          onCategories={(c: Category | "") => setFilters((f) => ({ ...f, categories: new Set(c ? [c] : []) }))}
          onShowDiscarded={(b) => setFilters((f) => ({ ...f, showDiscarded: b }))}
          onClear={() => setFilters(NO_FILTERS)}
          selectedId={selectedId}
          onSelect={select}
          discarded={discarded}
          groupId={groupId}
          onGroup={(id) => {
            setGroupId(id);
            setSelectedId(undefined);
            setRegionId(undefined);
          }}
        />
      </div>
    </div>
  );
}

function Empty() {
  return (
    <main className="shell" id="contenido">
      <section className="hero">
        <h1>Aún no hay un reporte</h1>
        <p style={{ marginTop: 12 }}>Genere uno comparando un frame de Figma con su página y ábralo desde la terminal:</p>
        <p style={{ marginTop: 12 }}>
          <code>npm run paridad -- compare --figma &lt;url del frame&gt; --page http://localhost:3000 --open</code>
        </p>
        <p className="muted" style={{ marginTop: 12 }}>
          También puede abrir uno que ya tenga: <code>npm run paridad -- report --dir out/compare</code>
        </p>
        <p style={{ marginTop: 16 }}>
          <a className="btn primary" href="/nueva">
            Hacer una nueva comparación aquí
          </a>
        </p>
      </section>
    </main>
  );
}

/** Aplicación del reporte: una pestaña por tamaño (escritorio, móvil…) y, dentro, el reporte de ese tamaño. */
export function ReportApp({ items, initialTab, print }: { items: Item[]; initialTab: number; print: boolean }) {
  const [tab, setTab] = useState(items[initialTab]?.id ?? items[0]?.id ?? "0");
  if (items.length === 0) return <Empty />;
  const item = items.find((i) => i.id === tab) ?? items[0]!;

  return (
    <>
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <main className={`shell${print ? " print-mode" : ""}`} id="contenido">
        {!print ? <AppNav current="reporte" /> : null}
        {items.length > 1 ? (
          <div style={{ marginTop: 24 }}>
            <Tablist items={items.map((i) => ({ id: i.id, label: i.label }))} selected={item.id} onSelect={setTab} label="Tamaño de ventana" prefix="tam" className="tabs" tabClassName="tab" />
          </div>
        ) : null}
        <div id="tam-panel" role={items.length > 1 ? "tabpanel" : undefined} aria-labelledby={items.length > 1 ? `tam-tab-${item.id}` : undefined}>
          {item.report ? (
            <ReportView key={item.id} item={item} report={item.report} print={print} />
          ) : (
            <p className="alert" role="alert" style={{ marginTop: 24 }}>
              {item.error ?? "No se pudo cargar este reporte."}
            </p>
          )}
        </div>
      </main>
    </>
  );
}
