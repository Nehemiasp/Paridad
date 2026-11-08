import { MutationSchema, type Mutation, type MutationInput } from "./mutation.ts";

// Atajos para escribir ediciones sobre la página de ejemplo (fixtures/landing/page).
const css = (find: string, replace: string) => ({ file: "styles.css" as const, find, replace });
const html = (find: string, replace: string) => ({ file: "index.html" as const, find, replace });

const CARDS = [1, 2, 3] as const;
const each = <T>(f: (k: 1 | 2 | 3) => T[]): T[] => CARDS.flatMap(f);

/** Consecuencias en cadena que son legítimas cuando algo cambia de alto: lo de abajo se corre. */
const REFLOW_BELOW_CARDS = [{ rule: "page-height" as const }, { rule: "position" as const, designId: "pie-texto" }, { rule: "spacing" as const, designId: "pie-texto" }];
/** Consecuencias de que un texto del hero cambie de tamaño: se corre todo lo que hay debajo. */
const REFLOW_BELOW_HERO = [
  { rule: "page-height" as const },
  { rule: "text-lines" as const },
  { rule: "spacing" as const },
  { rule: "position" as const },
  { rule: "size" as const },
];

const INPUT: MutationInput[] = [
  // ── Padding y separación ────────────────────────────────────────────────
  {
    id: "padding-tarjetas-20",
    description: "El padding de las tarjetas pasa de 16 a 20 px.",
    errorType: "padding",
    edits: [css("  padding: 16px;\n  background: var(--white);", "  padding: 20px;\n  background: var(--white);")],
    expected: each((k) => [
      { rule: "position", designId: `tarjeta-${k}-icono`, severity: "low" },
      { rule: "position", designId: `tarjeta-${k}-titulo`, severity: "low" },
      { rule: "position", designId: `tarjeta-${k}-texto`, severity: "low" },
      { rule: "size", designId: `tarjeta-${k}`, severity: "medium", note: "la tarjeta crece 8 px de alto" },
    ]),
    acceptable: REFLOW_BELOW_CARDS,
  },
  {
    id: "separacion-tarjetas-28",
    description: "La separación entre tarjetas pasa de 24 a 28 px (las columnas se angostan).",
    errorType: "gap",
    edits: [css("  gap: 24px;\n  padding: 0 84px 96px;", "  gap: 28px;\n  padding: 0 84px 96px;")],
    expected: [
      { rule: "spacing", designId: "tarjeta-2", severity: "low" },
      { rule: "spacing", designId: "tarjeta-3", severity: "low" },
    ],
    acceptable: [
      { rule: "size", designIdPattern: "^tarjeta-\\d$" },
      { rule: "position", designIdPattern: "^tarjeta-\\d$" },
      { rule: "text-lines" },
      { rule: "page-height" },
    ],
  },
  {
    id: "separacion-navegacion-40",
    description: "La separación entre los enlaces de la navegación pasa de 32 a 40 px.",
    errorType: "gap",
    edits: [css(".nav { display: flex; gap: 32px; font-weight: 500; }", ".nav { display: flex; gap: 40px; font-weight: 500; }")],
    expected: [
      { rule: "spacing", designId: "nav-talleres", severity: "medium" },
      { rule: "spacing", designId: "nav-contacto", severity: "medium" },
    ],
    acceptable: [
      { rule: "position", designIdPattern: "^nav-" },
      { rule: "spacing", designIdPattern: "^nav-" },
      { rule: "spacing", designId: "btn-secundario" },
    ],
  },

  // ── Color ───────────────────────────────────────────────────────────────
  {
    id: "color-boton-fuera-de-paleta",
    description: "El botón primario usa #1d6fd1, un azul que no está en la paleta.",
    errorType: "color-fuera-de-paleta",
    edits: [css("  background: var(--blue);\n  color: var(--white);", "  background: #1d6fd1;\n  color: var(--white);")],
    expected: [{ rule: "color-background", designId: "btn-primario", severity: "high" }],
    acceptable: [],
  },
  {
    id: "color-boton-parecido",
    description: "El botón primario usa #073d72 en lugar de #043565 (ΔE ≈ 2.8: parecido pero distinto).",
    errorType: "color-parecido",
    edits: [css("  background: var(--blue);\n  color: var(--white);", "  background: #073d72;\n  color: var(--white);")],
    expected: [{ rule: "color-background", designId: "btn-primario", severity: "medium" }],
    acceptable: [],
  },
  {
    id: "color-texto-hero-otra-tinta",
    description: "El título del hero pasa de la tinta #0e1116 al color de texto #2b2f36 (ambos de la paleta).",
    errorType: "color-de-paleta-equivocado",
    edits: [css("  letter-spacing: -1.28px;\n  color: var(--ink);", "  letter-spacing: -1.28px;\n  color: var(--text);")],
    expected: [{ rule: "color-text", designId: "hero-titulo", severity: "medium" }],
    acceptable: [],
  },

  // ── Tipografía ──────────────────────────────────────────────────────────
  {
    id: "peso-texto-tarjetas-600",
    description: "El texto de las tarjetas pasa de peso 400 a 600.",
    errorType: "peso-tipografico",
    edits: [css(".card p { margin: 0; color: var(--muted); }", ".card p { margin: 0; color: var(--muted); font-weight: 600; }")],
    expected: each((k) => [{ rule: "font-weight", designId: `tarjeta-${k}-texto`, severity: "high" }]),
    acceptable: [{ rule: "text-lines" }, { rule: "size" }, { rule: "page-height" }, ...REFLOW_BELOW_CARDS],
  },
  {
    id: "tamano-bajada-22",
    description: "La bajada del hero pasa de 20 a 22 px.",
    errorType: "tamano-de-letra",
    edits: [css("  font-size: 20px;\n  line-height: 30px;", "  font-size: 22px;\n  line-height: 30px;")],
    expected: [{ rule: "font-size", designId: "hero-bajada", severity: "medium" }],
    acceptable: REFLOW_BELOW_HERO,
  },
  {
    id: "interlineado-bajada-36",
    description: "El interlineado de la bajada pasa de 30 a 36 px.",
    errorType: "interlineado",
    edits: [css("  font-size: 20px;\n  line-height: 30px;", "  font-size: 20px;\n  line-height: 36px;")],
    expected: [{ rule: "line-height", designId: "hero-bajada", severity: "medium" }],
    acceptable: REFLOW_BELOW_HERO,
  },
  {
    id: "espaciado-letras-titulo-0",
    description: "El título del hero pierde su espaciado entre letras (de −1.28 px a 0).",
    errorType: "espaciado-entre-letras",
    edits: [css("  letter-spacing: -1.28px;", "  letter-spacing: 0;")],
    expected: [{ rule: "letter-spacing", designId: "hero-titulo", severity: "medium" }],
    acceptable: REFLOW_BELOW_HERO,
  },
  {
    id: "fuente-del-titulo-no-carga",
    description: "El archivo de Bricolage Grotesque no existe: títulos y logotipo se pintan con la fuente de respaldo.",
    errorType: "fuente-no-carga",
    edits: [css('src: url("fonts/bricolage-grotesque-latin-800-normal.woff2") format("woff2");', 'src: url("fonts/no-existe.woff2") format("woff2");')],
    expected: [{ rule: "font-not-loaded", severity: "critical", note: "UN solo hallazgo para todos los textos afectados" }],
    acceptable: [
      { rule: "size" },
      { rule: "position" },
      { rule: "spacing" },
      { rule: "text-lines" },
      { rule: "page-height" },
      { rule: "line-height" },
    ],
  },

  // ── Texto ───────────────────────────────────────────────────────────────
  {
    id: "texto-cortado-tarjetas",
    description: "El texto de las tarjetas se corta a una línea con -webkit-line-clamp.",
    errorType: "texto-cortado",
    edits: [css(".card p { margin: 0; color: var(--muted); }", ".card p { margin: 0; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }")],
    expected: [
      { rule: "text-clipped", designId: "tarjeta-1-texto", severity: "high" },
      { rule: "text-clipped", designId: "tarjeta-2-texto", severity: "high" },
    ],
    acceptable: [{ rule: "text-lines" }, { rule: "size", designIdPattern: "^tarjeta-\\d" }, ...REFLOW_BELOW_CARDS],
  },
  {
    id: "texto-copia-distinta",
    description: "El botón dice «Ver colección» en lugar de «Ver la colección».",
    errorType: "texto-copia",
    edits: [html(">Ver la colección<", ">Ver colección<")],
    expected: [{ rule: "text-content", designId: "btn-primario-texto", severity: "medium" }],
    acceptable: [{ rule: "size", designId: "btn-primario" }],
  },
  {
    id: "texto-solo-mayusculas",
    description: "El enlace «Contacto» se escribe «CONTACTO».",
    errorType: "texto-copia",
    edits: [html(">Contacto<", ">CONTACTO<")],
    expected: [{ rule: "text-content", designId: "nav-contacto", severity: "low" }],
    acceptable: [{ rule: "spacing", designId: "nav-contacto" }, { rule: "position" }, { rule: "spacing" }],
  },

  // ── Presencia ───────────────────────────────────────────────────────────
  {
    id: "tarjeta-2-oculta",
    description: "La segunda tarjeta desaparece sin que la cuadrícula se reacomode (visibility: hidden).",
    errorType: "elemento-eliminado",
    edits: [html('<article class="card">\n          <div class="card-icon" aria-hidden="true"></div>\n          <h2>Talleres para principiantes</h2>', '<article class="card" style="visibility: hidden">\n          <div class="card-icon" aria-hidden="true"></div>\n          <h2>Talleres para principiantes</h2>')],
    expected: [{ rule: "missing", designId: "tarjeta-2", severity: "critical" }],
    acceptable: [],
  },
  {
    id: "bajada-eliminada",
    description: "Se borra la bajada del hero; todo lo de abajo sube.",
    errorType: "elemento-eliminado",
    edits: [html('        <p class="lead">Piezas únicas para la mesa de todos los días, modeladas y horneadas en nuestro taller.</p>\n', "")],
    expected: [{ rule: "missing", designId: "hero-bajada", severity: "critical" }],
    acceptable: [{ rule: "page-height" }, { rule: "spacing" }, { rule: "position" }],
  },
  {
    id: "tarjeta-2-eliminada-con-reacomodo",
    description: "La segunda tarjeta se elimina (display: none) y la tercera ocupa su lugar en la cuadrícula.",
    errorType: "elemento-eliminado",
    hard: true,
    edits: [html('<article class="card">\n          <div class="card-icon" aria-hidden="true"></div>\n          <h2>Talleres para principiantes</h2>', '<article class="card" style="display: none">\n          <div class="card-icon" aria-hidden="true"></div>\n          <h2>Talleres para principiantes</h2>')],
    expected: [{ rule: "missing", designId: "tarjeta-2", severity: "critical" }],
    acceptable: [{ rule: "position", designIdPattern: "^tarjeta-3" }, { rule: "spacing" }, { rule: "size" }],
  },
  {
    id: "aviso-agregado",
    description: "Se agrega un aviso naranja («Envíos gratis este mes») que no está en el diseño.",
    errorType: "elemento-agregado",
    edits: [
      html("    </main>", '      <aside class="promo">Envíos gratis este mes</aside>\n    </main>'),
      css(".site-footer {", ".promo { margin: 0 84px 32px; padding: 12px 16px; background: #ff9900; color: #ffffff; font-weight: 600; }\n\n.site-footer {"),
    ],
    expected: [
      { rule: "extra", severity: "high" },
      { rule: "palette", severity: "medium" },
    ],
    acceptable: [{ rule: "contrast" }, ...REFLOW_BELOW_CARDS],
  },

  // ── Contraste ───────────────────────────────────────────────────────────
  {
    id: "contraste-texto-tarjetas",
    description: "El texto de las tarjetas pasa a #aaaaaa sobre blanco (2.3:1).",
    errorType: "contraste-insuficiente",
    edits: [css(".card p { margin: 0; color: var(--muted); }", ".card p { margin: 0; color: #aaaaaa; }")],
    expected: each((k) => [
      { rule: "contrast", designId: `tarjeta-${k}-texto`, severity: "high" },
      { rule: "color-text", designId: `tarjeta-${k}-texto`, severity: "high" },
    ]),
    acceptable: [],
  },

  // ── Forma ───────────────────────────────────────────────────────────────
  {
    id: "radio-tarjetas-8",
    description: "El radio de las tarjetas pasa de 16 a 8 px.",
    errorType: "radio",
    edits: [css("  border-radius: 16px;", "  border-radius: 8px;")],
    expected: each((k) => [{ rule: "radius", designId: `tarjeta-${k}`, severity: "medium" }]),
    acceptable: [],
  },
  {
    id: "sombra-tarjetas",
    description: "Las tarjetas ganan una sombra que el diseño no tiene.",
    errorType: "sombra",
    edits: [css("  border-radius: 16px;\n}", "  border-radius: 16px;\n  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);\n}")],
    expected: each((k) => [{ rule: "shadow", designId: `tarjeta-${k}`, severity: "medium" }]),
    acceptable: [],
  },
  {
    id: "borde-tarjetas-3",
    description: "El borde de las tarjetas pasa de 1 a 3 px.",
    errorType: "borde",
    edits: [css("  border: 1px solid var(--line);\n  border-radius: 16px;", "  border: 3px solid var(--line);\n  border-radius: 16px;")],
    expected: each((k) => [{ rule: "border", designId: `tarjeta-${k}`, severity: "low" }]),
    acceptable: [
      { rule: "position", designIdPattern: "^tarjeta-\\d-" },
      { rule: "size", designIdPattern: "^tarjeta-\\d$" },
      { rule: "page-height" },
    ],
  },

  // ── Ruido: cambios que NO deben reportarse ──────────────────────────────
  {
    id: "ruido-tamano-bajada-20-2",
    description: "La bajada pasa de 20 a 20.2 px: menos que la tolerancia, no debe reportarse.",
    errorType: "ruido",
    edits: [css("  font-size: 20px;\n  line-height: 30px;", "  font-size: 20.2px;\n  line-height: 30px;")],
    expected: [],
    acceptable: [],
  },
  {
    id: "ruido-color-boton-delta-e-bajo",
    description: "El botón pasa de #043565 a #053666 (ΔE ≈ 0.3): imperceptible, no debe reportarse.",
    errorType: "ruido",
    edits: [css("  background: var(--blue);\n  color: var(--white);", "  background: #053666;\n  color: var(--white);")],
    expected: [],
    acceptable: [],
  },
  {
    id: "ruido-padding-tarjetas-16-4",
    description: "El padding de las tarjetas pasa de 16 a 16.4 px: menos que la tolerancia.",
    errorType: "ruido",
    edits: [css("  padding: 16px;\n  background: var(--white);", "  padding: 16.4px;\n  background: var(--white);")],
    expected: [],
    acceptable: [],
  },
  {
    id: "ruido-comentario-y-espacios",
    description: "Se agrega un comentario y espacios al CSS: la página es idéntica.",
    errorType: "ruido",
    edits: [css(":root {", "/* cambio sin efecto visual */\n\n\n:root {")],
    expected: [],
    acceptable: [],
  },
];

/** Las mutaciones incorporadas, ya validadas. */
export const BUILTIN_MUTATIONS: Mutation[] = INPUT.map((m) => MutationSchema.parse(m));
