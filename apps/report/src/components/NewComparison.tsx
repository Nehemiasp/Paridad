"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EnvStatus } from "../lib/env.ts";
import { LIMITS, type Field } from "../lib/validate.ts";

interface Draft {
  demo: boolean;
  figmaUrl: string;
  pageUrl: string;
  width: string;
  scale: "1" | "2";
  ignore: string;
  ai: boolean;
  aiMaxCost: string;
}
const EMPTY: Draft = { demo: false, figmaUrl: "", pageUrl: "", width: "", scale: "1", ignore: "", ai: false, aiMaxCost: String(LIMITS.defaultCost) };
export const DRAFT_KEY = "paridad.borrador";

// El almacenamiento del navegador puede no existir o fallar (ventana privada, datos bloqueados): la pantalla funciona igual sin él.
const readDraft = (): Draft => {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
};
const saveDraft = (d: Draft) => {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* sin almacenamiento: no se conserva el borrador */
  }
};

function FieldBox({ id, label, hint, error, children, optional }: { id: string; label: string; hint?: string; error?: string | undefined; children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="muted"> (opcional)</span> : null}
      </label>
      {hint ? (
        <p className="hint" id={`${id}-ayuda`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Formulario para iniciar una comparación. Valida el servidor; aquí solo se muestran sus mensajes junto a cada campo. */
export function NewComparison({ token, env }: { token: string; env: EnvStatus }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => setD(readDraft()), []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const aria = (f: Field, hint: boolean) => ({
    "aria-invalid": errors[f] ? true : undefined,
    "aria-describedby": [hint ? `${f}-ayuda` : "", errors[f] ? `${f}-error` : ""].filter(Boolean).join(" ") || undefined,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError("");
    saveDraft(d);
    try {
      const res = await fetch("/api/comparaciones", { method: "POST", headers: { "content-type": "application/json", "x-paridad": token }, body: JSON.stringify(d) });
      const body = (await res.json().catch(() => ({}))) as { id?: string; errors?: Partial<Record<Field, string>>; error?: string };
      if (res.status === 201 && body.id) {
        router.push(`/comparaciones/${encodeURIComponent(body.id)}`);
        return;
      }
      if (body.errors) {
        setErrors(body.errors);
        // Lleva el foco al primer campo con error, en el orden en que aparecen.
        const first = (["figmaUrl", "pageUrl", "width", "scale", "ignore", "aiMaxCost"] as const).find((f) => body.errors?.[f]);
        if (first) window.setTimeout(() => formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(), 0);
      } else setFormError(body.error ?? "No se pudo iniciar la comparación.");
    } catch {
      setFormError("No se pudo hablar con la app. ¿Sigue abierta la terminal con «npm run app»?");
    }
    setBusy(false);
  }

  return (
    <section className="card" aria-labelledby="nueva-titulo">
      <h2 id="nueva-titulo">Nueva comparación</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Compare un frame de Figma con la página ya construida. Un tamaño por comparación: para escritorio y móvil haga dos.
      </p>

      <form ref={formRef} onSubmit={submit} noValidate className="form">
        {formError ? (
          <p className="alert" role="alert">
            {formError}
          </p>
        ) : null}

        <label className="check demo">
          <input type="checkbox" name="demo" checked={d.demo} onChange={(e) => set("demo", e.target.checked)} />
          <span>
            <strong>Probar con el ejemplo (Casa Nube)</strong>
            <span className="hint">Usa el diseño guardado y la página de ejemplo. No necesita Figma ni token: sirve para ver cómo funciona todo.</span>
          </span>
        </label>

        <FieldBox id="figmaUrl" label="Enlace del frame de Figma" hint="En Figma: clic derecho sobre el frame → Copy link to selection. Debe incluir node-id." error={errors.figmaUrl}>
          <input id="figmaUrl" name="figmaUrl" type="url" inputMode="url" autoComplete="off" spellCheck={false} disabled={d.demo} value={d.demo ? "" : d.figmaUrl} placeholder="https://www.figma.com/design/…?node-id=1-2" onChange={(e) => set("figmaUrl", e.target.value)} {...aria("figmaUrl", true)} />
        </FieldBox>
        {!d.demo && !env.figma ? (
          <p className="notice" role="note">
            Falta el token de Figma: puede escribir el enlace, pero no se podrá comparar hasta guardarlo en <code>.env.local</code> (vea «Estado del entorno»).
          </p>
        ) : null}

        <FieldBox id="pageUrl" label="Dirección de la página" hint="http, https o file. Solo se captura la página que usted indica; no se siguen enlaces." error={errors.pageUrl}>
          <input id="pageUrl" name="pageUrl" type="url" inputMode="url" autoComplete="off" spellCheck={false} disabled={d.demo} value={d.demo ? "" : d.pageUrl} placeholder="http://localhost:3000" onChange={(e) => set("pageUrl", e.target.value)} {...aria("pageUrl", true)} />
        </FieldBox>

        <div className="row">
          <FieldBox id="width" label="Ancho de la ventana (px)" optional hint={`Entre ${LIMITS.minWidth} y ${LIMITS.maxWidth}. Vacío: el ancho del frame.`} error={errors.width}>
            <input id="width" name="width" type="text" inputMode="numeric" autoComplete="off" value={d.width} placeholder="Ancho del frame" onChange={(e) => set("width", e.target.value)} {...aria("width", true)} />
          </FieldBox>
          <FieldBox id="scale" label="Escala de la imagen" error={errors.scale}>
            <select id="scale" name="scale" value={d.scale} onChange={(e) => set("scale", e.target.value === "2" ? "2" : "1")} {...aria("scale", false)}>
              <option value="1">1× (más rápido)</option>
              <option value="2">2× (más nítido)</option>
            </select>
          </FieldBox>
        </div>

        <FieldBox id="ignore" label="Zonas a ignorar" optional hint={`Selectores CSS, uno por línea (hasta ${LIMITS.maxSelectors}). Útil para fechas, anuncios o contenido que cambia solo.`} error={errors.ignore}>
          <textarea id="ignore" name="ignore" rows={3} spellCheck={false} value={d.ignore} placeholder={".fecha-de-hoy\n#anuncio"} onChange={(e) => set("ignore", e.target.value)} {...aria("ignore", true)} />
        </FieldBox>

        <fieldset className="ai">
          <legend>Capa de IA (opcional)</legend>
          <label className="check">
            <input type="checkbox" name="ai" checked={d.ai && env.ai} disabled={!env.ai} onChange={(e) => set("ai", e.target.checked)} aria-describedby="ai-ayuda" />
            <span>
              <strong>Agrupar y redactar con Claude</strong>
              <span className="hint" id="ai-ayuda">
                {env.ai ? "Agrupa hallazgos con causa común y sugiere CSS. No cambia el puntaje ni inventa hallazgos." : "Deshabilitada: falta ANTHROPIC_API_KEY en .env.local."}
              </span>
            </span>
          </label>
          {env.ai && d.ai ? (
            <FieldBox id="aiMaxCost" label="Tope de costo (USD)" hint="Si la estimación no cabe en el tope, no se llama al modelo." error={errors.aiMaxCost}>
              <input id="aiMaxCost" name="aiMaxCost" type="text" inputMode="decimal" autoComplete="off" value={d.aiMaxCost} onChange={(e) => set("aiMaxCost", e.target.value)} {...aria("aiMaxCost", true)} />
            </FieldBox>
          ) : null}
        </fieldset>

        <div className="actions">
          <button type="submit" className="btn primary big" disabled={busy}>
            {busy ? "Iniciando…" : "Comparar"}
          </button>
          <p role="status" aria-live="polite" className="muted">
            {busy ? "Iniciando la comparación…" : ""}
          </p>
        </div>
      </form>
    </section>
  );
}
