/** Navegación mínima entre las pantallas de la app (formulario, historial y reporte). */
export function AppNav({ current }: { current?: "nueva" | "reporte" }) {
  return (
    <nav className="appnav no-print" aria-label="Paridad">
      <a className="pill pill-link" href="/nueva" aria-current={current === "nueva" ? "page" : undefined}>
        Paridad
      </a>
      <a href="/nueva" aria-current={current === "nueva" ? "page" : undefined}>
        Nueva comparación
      </a>
      <a href="/nueva#historial">Comparaciones anteriores</a>
    </nav>
  );
}
