"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DRAFT_KEY } from "./NewComparison.tsx";

interface Status {
  state: "corriendo" | "listo" | "error";
  summary: string;
  demo: boolean;
  steps: { id: string; label: string; status: "pendiente" | "en curso" | "hecho" }[];
  lines: string[];
  error: string | null;
  reportId: string | null;
  elapsedMs: number;
}

const MARK = { hecho: "✓", "en curso": "…", pendiente: "·" } as const;

/** Avance en vivo: consulta el estado cada segundo y, al terminar, abre el reporte. */
export function Progress({ id }: { id: string }) {
  const router = useRouter();
  const [s, setS] = useState<Status | undefined>();
  const [problem, setProblem] = useState("");
  const done = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/comparaciones/${encodeURIComponent(id)}`, { cache: "no-store" });
        // Siempre se lee el cuerpo: una petición con el cuerpo sin leer queda abierta.
        const raw = (await res.json().catch(() => ({}))) as Partial<Status> & { error?: string };
        if (stop) return;
        if (res.status === 404 || !raw.state) {
          setProblem(res.status === 404 ? "No encuentro esa comparación. Quizá se reinició la app: revise el historial, que se guarda en disco." : (raw.error ?? "No se pudo leer el estado de la comparación."));
          return;
        }
        const body = raw as Status;
        setS(body);
        if (body.state === "listo" && body.reportId && !done.current) {
          done.current = true;
          try {
            window.sessionStorage.removeItem(DRAFT_KEY);
          } catch {
            /* sin almacenamiento */
          }
          router.replace(`/comparaciones/${encodeURIComponent(id)}/reporte`);
          return;
        }
        if (body.state === "error") return;
      } catch {
        if (!stop) setProblem("Se perdió la conexión con la app. ¿Sigue abierta la terminal con «npm run app»?");
        return;
      }
      timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, router]);

  const current = s?.steps.find((x) => x.status === "en curso");
  const live = problem ? problem : s?.state === "error" ? "La comparación falló." : s?.state === "listo" ? "Listo. Abriendo el reporte…" : current ? `En curso: ${current.label}.` : "Iniciando…";

  return (
    <section className="card" aria-labelledby="avance-titulo">
      <h2 id="avance-titulo">Comparando…</h2>
      {s ? <p className="muted" style={{ marginTop: 6 }}>{s.summary}</p> : null}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
      <ol className="steps" aria-label="Pasos de la comparación">
        {(s?.steps ?? []).map((x) => (
          <li key={x.id} className={`step ${x.status.replace(" ", "-")}`} aria-current={x.status === "en curso" ? "step" : undefined}>
            <span className="step-mark" aria-hidden="true">
              {MARK[x.status]}
            </span>
            <span>
              {x.label}
              <span className="sr-only">: {x.status}</span>
            </span>
          </li>
        ))}
      </ol>
      {s && s.state === "corriendo" ? <p className="muted">Lleva {Math.max(1, Math.round(s.elapsedMs / 1000))} s. Puede tardar hasta tres minutos.</p> : null}

      {problem || s?.state === "error" ? (
        <div className="stack">
          <p className="alert" role="alert">
            {problem || s?.error}
          </p>
          <div className="exports">
            <a className="btn primary" href="/nueva">
              Volver al formulario
            </a>
            <a className="btn" href="/nueva#historial">
              Ver comparaciones anteriores
            </a>
          </div>
          <p className="muted">Sus datos se conservan en el formulario.</p>
        </div>
      ) : null}

      {s && s.lines.length ? (
        <details className="how" open={s.state === "error"}>
          <summary>Salida del comando</summary>
          <pre className="log" tabIndex={0} aria-label="Salida del comando">
            {s.lines.join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
