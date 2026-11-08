/**
 * Motivo de la marca: una cuadrícula de cuadros con una píldora azul. Es decorativo (aria-hidden).
 * Se dibuja con un patrón SVG para que escale a cualquier ancho.
 */
export function BrandMotif() {
  return (
    <svg className="motif" aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMid slice">
      <defs>
        <pattern id="cuadros" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect x="1" y="1" width="26" height="26" rx="5" fill="none" stroke="#dadde2" strokeWidth="1" />
        </pattern>
        <linearGradient id="desvanecer" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="mascara">
          <rect width="100%" height="100%" fill="url(#desvanecer)" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="url(#cuadros)" mask="url(#mascara)" />
      <rect className="motif-pill" x="calc(100% - 214px)" y="30" width="154" height="28" rx="14" fill="#043565" />
      <rect className="motif-pill" x="calc(100% - 118px)" y="86" width="58" height="28" rx="14" fill="#ecedef" />
    </svg>
  );
}
