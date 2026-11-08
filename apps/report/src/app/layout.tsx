import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fuentes de la marca, locales (SIL OFL): el reporte se ve igual sin red.
const title = localFont({ src: "../fonts/bricolage-grotesque-latin-800-normal.woff2", weight: "800", variable: "--font-title", display: "swap" });
const text = localFont({
  src: [
    { path: "../fonts/instrument-sans-latin-400-normal.woff2", weight: "400" },
    { path: "../fonts/instrument-sans-latin-500-normal.woff2", weight: "500" },
    { path: "../fonts/instrument-sans-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-text",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reporte de paridad · Paridad",
  description: "Diferencias medibles entre un diseño de Figma y la página construida.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${title.variable} ${text.variable}`}>
      <body>{children}</body>
    </html>
  );
}
