import type { EnvStatus as Status } from "../lib/env.ts";

function Row({ ok, name, yes, no }: { ok: boolean; name: string; yes: string; no: string }) {
  return (
    <li className="env-row">
      <span className={`env-dot ${ok ? "ok" : "no"}`} aria-hidden="true">
        {ok ? "✓" : "!"}
      </span>
      <span>
        <strong>{name}:</strong> {ok ? yes : no}
      </span>
    </li>
  );
}

/** Estado del entorno, solo lectura. Dice si algo está configurado, nunca su valor. */
export function EnvStatus({ status }: { status: Status }) {
  return (
    <section className="card" aria-labelledby="entorno">
      <h2 id="entorno">Estado del entorno</h2>
      <ul className="env-list">
        <Row ok={status.figma} name="Figma" yes="token configurado." no="falta el token." />
        <Row ok={status.chromium} name="Chromium" yes="listo para capturar páginas." no="no está instalado." />
        <Row ok={status.ai} name="IA (opcional)" yes="clave configurada." no="sin clave; la capa de IA queda apagada." />
      </ul>
      {!status.figma ? (
        <details className="how">
          <summary>Cómo crear y guardar el token de Figma</summary>
          <ol>
            <li>
              En Figma abra <em>Settings → Security → Personal access tokens</em> y cree uno con permiso de solo lectura de archivos.
            </li>
            <li>
              En la carpeta del proyecto, en el archivo <code>.env.local</code>, escriba <code>FIGMA_TOKEN=su_token</code> (use <code>.env.example</code> como guía; ese archivo nunca se sube).
            </li>
            <li>
              Cierre la app (Ctrl+C) y vuelva a abrirla con <code>npm run app</code>.
            </li>
          </ol>
          <p className="muted">La app nunca le pide el token en esta pantalla ni lo guarda. Mientras tanto puede probar con el ejemplo.</p>
        </details>
      ) : null}
      {!status.chromium ? (
        <p className="alert" role="alert" style={{ marginTop: 12 }}>
          Instale Chromium con <code>npx playwright install chromium</code>.
        </p>
      ) : null}
    </section>
  );
}
