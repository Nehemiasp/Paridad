import { describe, expect, it } from "vitest";
import { ReportSchema, compare, deltaE2000, resolveConfig, type Finding } from "../index.ts";
import { byName, byText, clone, designSnapshot, pageSnapshot, remove, shift } from "./helpers.test-util.ts";

const run = (mutate: (page: ReturnType<typeof pageSnapshot>, design: ReturnType<typeof designSnapshot>) => void, config?: Parameters<typeof compare>[2] extends infer O ? (O extends { config?: infer C } ? C : never) : never) => {
  const design = designSnapshot();
  const page = pageSnapshot();
  mutate(page, design);
  return compare(design, page, { now: () => new Date("2026-11-08T00:00:00Z"), ...(config ? { config } : {}) });
};
const rules = (r: { findings: Finding[] }) => r.findings.map((f) => f.rule);
const only = (r: { findings: Finding[] }, rule: string) => r.findings.filter((f) => f.rule === rule);

describe("control: la página sin errores", () => {
  const r = run(() => {});
  it("no reporta nada y da 100", () => {
    expect(r.findings).toEqual([]);
    expect(r.score.value).toBe(100);
    expect(r.matching).toMatchObject({ pairs: 23, missing: 0, extra: 0 });
  });
  it("el reporte es válido según su esquema y sobrevive a JSON", () => {
    expect(ReportSchema.safeParse(JSON.parse(JSON.stringify(r))).success).toBe(true);
    expect(r.design.name).toContain("diseño");
  });
  it("es determinista", () => {
    expect(run(() => {})).toEqual(r);
  });
});

describe("presencia", () => {
  it("una tarjeta que falta es UN hallazgo crítico que resume lo que había dentro", () => {
    const r = run((page) => remove(page, byName(page, "article.card", 1).id));
    expect(rules(r)).toEqual(["missing"]);
    const f = r.findings[0]!;
    expect(f.severity).toBe("critical");
    expect(f.related).toHaveLength(3); // icono, título y texto
    expect(f.title).toContain("con 3 elementos dentro");
    expect(f.design?.box).toBeDefined();
    expect(r.score.value).toBe(85);
  });

  it("un texto que falta es crítico", () => {
    const r = run((page) => remove(page, byText(page, "Piezas únicas para la mesa de todos los días, modeladas y horneadas en nuestro taller.").id));
    expect(r.findings.map((f) => [f.rule, f.severity])).toEqual([["missing", "critical"]]);
  });

  it("un elemento que sobra es alto, y su color fuera de la paleta se reporta una vez", () => {
    const r = run((page) => {
      const root = page.elements[0]!;
      page.elements.push(
        { id: "x1", kind: "box", parentId: root.id, z: 99, name: "banner", box: { x: 84, y: 860, width: 300, height: 40 }, style: { background: "#ff0000" } },
        { id: "x2", kind: "text", parentId: "x1", z: 100, name: "aviso", box: { x: 90, y: 866, width: 100, height: 20 }, text: { content: "Oferta", normalized: "Oferta" }, style: { color: "#ffffff", fontSize: 16 } },
      );
    });
    expect(only(r, "extra")).toHaveLength(1);
    expect(only(r, "extra")[0]).toMatchObject({ severity: "high", related: ["x2"] });
    expect(only(r, "palette")).toHaveLength(1);
    expect(only(r, "palette")[0]!.title).toContain("#ff0000");
  });

  it("un elemento dentro de una zona a ignorar (en cualquiera de los dos lados) no cuenta", () => {
    const r = run((page) => {
      const footer = byText(page, "© 2026 Casa Nube · Estudio de cerámica");
      page.ignore.push({ rect: { x: footer.box.x - 2, y: footer.box.y - 2, width: footer.box.width + 4, height: footer.box.height + 4 } });
      remove(page, footer.id); // en el código ese texto es dinámico y cambió
    });
    expect(r.findings).toEqual([]); // el marcador del diseño en esa zona también se ignora
    expect(r.matching.ignoredInDesign).toBe(1);
  });

  it("los textos repetidos se emparejan por posición", () => {
    const r = run((page, design) => {
      for (const s of [page, design]) {
        s.elements.push(
          { id: "r1", kind: "text", parentId: "page", z: 90, box: { x: 84, y: 700, width: 80, height: 20 }, text: { content: "Leer más", normalized: "Leer más" }, style: { color: "#0e1116", fontSize: 16 } },
          { id: "r2", kind: "text", parentId: "page", z: 91, box: { x: 600, y: 700, width: 80, height: 20 }, text: { content: "Leer más", normalized: "Leer más" }, style: { color: "#0e1116", fontSize: 16 } },
        );
      }
      page.elements.find((e) => e.id === "r2")!.box.y += 5; // solo el segundo está 5 px más abajo
    });
    const pos = only(r, "position");
    expect(pos).toHaveLength(1);
    expect(pos[0]!.design?.elementId).toBe("r2");
    expect(pos[0]!.page?.elementId).toBe("r2");
  });
});

describe("emparejar textos movidos", () => {
  it("un texto casi idéntico sigue siendo el mismo aunque se haya movido mucho", () => {
    const r = run((p) => shift(p, byText(p, "Casa Nube").id, 600, 0));
    expect(rules(r)).not.toContain("missing");
    expect(rules(r)).not.toContain("extra");
    expect(only(r, "position")[0]!.title).toContain("Posición horizontal: diseño 84 px · código 684 px");
  });

  it("uno que solo se parece debe estar cerca; lejos, es otro (falta + sobra)", () => {
    const r = run((p) => {
      const t = byText(p, "Ver la colección");
      t.text = { content: "Ver colección", normalized: "Ver colección" }; // similitud 0.81
      t.box.x += 700;
    });
    expect(rules(r)).toContain("missing");
    expect(rules(r)).toContain("extra");
  });
});

describe("posición y espaciado", () => {
  it("padding de 16 a 20: se reporta respecto al contenedor, con evidencia", () => {
    const r = run((page) => {
      const card = byName(page, "article.card", 0);
      for (const e of page.elements.filter((x) => x.parentId === card.id)) e.box.x += 4;
    });
    const pos = only(r, "position");
    expect(pos).toHaveLength(3);
    expect(pos.every((f) => f.severity === "low")).toBe(true);
    expect(pos[0]!.title).toContain("Padding izquierdo: diseño 16 px · código 20 px");
    expect(pos[0]!.evidence).toMatchObject({ unit: "px", delta: 4, expected: { x: 16, y: 16 }, actual: { x: 20, y: 16 } });
  });

  it("separación entre tarjetas de 24 a 28: un hallazgo por hueco y sin ruido en las demás tarjetas", () => {
    const r = run((page) => {
      shift(page, byName(page, "article.card", 1).id, 4, 0);
      shift(page, byName(page, "article.card", 2).id, 8, 0);
    });
    expect(rules(r)).toEqual(["spacing", "spacing"]);
    expect(r.findings[0]!.title).toMatch(/Separación horizontal entre «Tarjeta|Separación horizontal entre/);
    expect(r.findings.map((f) => f.evidence.delta)).toEqual([4, 4]);
    expect(r.findings[0]!.evidence).toMatchObject({ expected: 24, actual: 28, unit: "px" });
  });

  it("un bloque entero movido se reporta una vez, no por cada hijo, y como separación con su vecino", () => {
    const r = run((page) => shift(page, byName(page, "article.card", 0).id, 0, 20));
    expect(rules(r)).toEqual(["spacing"]);
    expect(r.findings[0]).toMatchObject({ severity: "high", evidence: { expected: 72, actual: 92, delta: 20, property: "separación vertical" } });
  });

  it("un elemento sin vecino que lo explique se reporta como posición", () => {
    const r = run((page) => shift(page, byText(page, "Casa Nube").id, 6, 0));
    expect(rules(r)).toEqual(["position"]);
    expect(r.findings[0]!.title).toContain("Posición horizontal: diseño 84 px · código 90 px");
  });

  it("1 px es ruido; más de la tolerancia es baja; más de 4 px, media; más de 12 px, alta", () => {
    const logo = (dx: number) => run((p) => shift(p, byText(p, "Casa Nube").id, dx, 0));
    expect(logo(1).findings).toEqual([]);
    expect(logo(3).findings[0]!.severity).toBe("low");
    expect(logo(8).findings[0]!.severity).toBe("medium");
    expect(logo(30).findings[0]!.severity).toBe("high");
  });

  it("un texto cuyo ancho cambia no genera hallazgo de posición horizontal (lo cubre tipografía)", () => {
    const r = run((page) => {
      const t = byText(page, "Contacto");
      t.box.x -= 3;
      t.box.width += 6;
    });
    expect(only(r, "position")).toEqual([]);
  });
});

describe("tamaño", () => {
  it("alto de una tarjeta +10 px", () => {
    const r = run((page) => (byName(page, "article.card", 0).box.height += 10));
    expect(r.findings.map((f) => [f.rule, f.severity])).toEqual([["size", "medium"]]);
    expect(r.findings[0]!.title).toContain("408×182 px · código 408×192 px");
  });

  it("un texto que pasa a más líneas: un hallazgo, y la caja que crece por eso no se repite", () => {
    const r = run((page) => {
      const p = byText(page, "Vajillas y piezas únicas diseñadas junto a usted.");
      p.box.height += 24; // una línea más
      byName(page, "article.card", 2).box.height += 24;
    });
    expect(rules(r)).toEqual(["text-lines"]);
    expect(r.findings[0]!.evidence).toMatchObject({ expected: 1, actual: 2 });
  });
});

describe("tipografía", () => {
  it("peso 800 → 600 es alto; tamaño 64 → 60 supera el umbral de severidad media", () => {
    const r = run((page) => {
      const h1 = byText(page, "Cerámica hecha con calma");
      h1.style.fontWeight = 600;
      h1.style.fontSize = 60;
    });
    expect(only(r, "font-weight")[0]).toMatchObject({ severity: "high" });
    expect(only(r, "font-size")[0]).toMatchObject({ severity: "high", evidence: { expected: 64, actual: 60, delta: -4 } });
  });

  it("interlineado y espaciado entre letras", () => {
    const r = run((page) => {
      const h1 = byText(page, "Cerámica hecha con calma");
      h1.style.lineHeight = 72;
      h1.style.letterSpacing = 0;
    });
    expect(only(r, "line-height")[0]).toMatchObject({ severity: "low" });
    expect(only(r, "letter-spacing")[0]).toMatchObject({ severity: "medium" });
  });

  it("otra familia declarada y pintada es «font-family», alta", () => {
    const r = run((page) => {
      const t = byText(page, "Contacto");
      t.style.fontFamily = "Inter";
      t.style.renderedFontFamily = "Inter";
    });
    expect(only(r, "font-family")[0]).toMatchObject({ severity: "high", evidence: { expected: "Instrument Sans", actual: "Inter" } });
  });

  it("una fuente que no cargó es UN hallazgo crítico, no uno por texto, y sin ruido de familia ni peso", () => {
    const r = run((page) => {
      for (const e of page.elements) if (e.style.fontFamily === "Instrument Sans") e.style.renderedFontFamily = "DejaVu Sans";
    });
    const f = only(r, "font-not-loaded");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "critical", evidence: { expected: "Instrument Sans", actual: "DejaVu Sans" } });
    expect(f[0]!.related!.length).toBeGreaterThanOrEqual(8);
    expect(only(r, "font-family")).toEqual([]);
    expect(only(r, "font-weight")).toEqual([]);
  });
});

describe("color", () => {
  it("ΔE menor que la tolerancia es ruido", () => {
    const de = deltaE2000("#043565", "#053666");
    expect(de).toBeLessThan(2);
    expect(run((p) => (byName(p, "a.btn.btn-primary").style.background = "#053666")).findings).toEqual([]);
  });

  it("color parecido pero distinto (ΔE pequeño) fuera de la paleta: se detecta, y no baja de media", () => {
    const sutil = "#073d72";
    const de = deltaE2000("#043565", sutil);
    expect(de).toBeGreaterThan(2);
    expect(de).toBeLessThan(4);
    const r = run((p) => (byName(p, "a.btn.btn-primary").style.background = sutil));
    const f = only(r, "color-background");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "medium", evidence: { expected: "#043565", actual: sutil, unit: "ΔE" } });
    expect(f[0]!.evidence.extra).toMatchObject({ fueraDePaleta: true, masCercanoDeLaPaleta: "#043565" });
    expect(f[0]!.title).toContain("fuera de la paleta");
  });

  it("un color de la paleta pero equivocado: severidad por ΔE", () => {
    const r = run((p) => (byName(p, "a.btn.btn-primary").style.background = "#0e1116"));
    const f = only(r, "color-background")[0]!;
    expect(f.severity).toBe("high");
    expect(f.evidence.extra).toMatchObject({ fueraDePaleta: false });
  });

  it("color de texto distinto", () => {
    const r = run((p) => (byText(p, "Cerámica hecha con calma").style.color = "#2b2f36"));
    expect(only(r, "color-text")[0]).toMatchObject({ severity: "medium" });
  });

  it("un fondo que desaparece es alto", () => {
    const r = run((p) => delete byName(p, "a.btn.btn-primary").style.background);
    expect(only(r, "color-background")[0]).toMatchObject({ severity: "high", evidence: { expected: "#043565", actual: null } });
  });
});

describe("forma", () => {
  it("el radio se compara recortado a la mitad del lado menor (999 ≡ 28 en un botón de 56 px)", () => {
    expect(run(() => {}).findings).toEqual([]); // el control ya lo prueba con 21/28 vs 999
    const r = run((p) => (byName(p, "article.card", 0).style.radius = 8));
    expect(only(r, "radius")[0]).toMatchObject({ severity: "medium", evidence: { delta: 8 } });
  });

  it("borde y sombra", () => {
    const r = run((p) => {
      byName(p, "article.card", 0).style.border = { width: 3, style: "solid", color: "#dadde2" };
      byName(p, "article.card", 1).style.shadows = [{ x: 0, y: 2, blur: 4, spread: 0, color: "#00000033" }];
    });
    expect(only(r, "border")[0]).toMatchObject({ severity: "low" });
    expect(only(r, "shadow")[0]).toMatchObject({ severity: "medium" });
  });
});

describe("texto", () => {
  it("copia distinta: severidad según cuánto cambia; solo mayúsculas es baja", () => {
    const r = run((p) => {
      byText(p, "Ver la colección").text = { content: "Ver colección", normalized: "Ver colección" };
      byText(p, "Contacto").text = { content: "CONTACTO", normalized: "CONTACTO" };
    });
    const f = only(r, "text-content");
    expect(f).toHaveLength(2);
    expect(f.find((x) => x.title.includes("CONTACTO"))).toMatchObject({ severity: "low" });
    expect(f.find((x) => x.title.includes("Ver colección"))).toBeDefined();
  });

  it("texto cortado es alto, con el motivo", () => {
    const r = run((p) => (byText(p, "Vajillas y piezas únicas diseñadas junto a usted.").text!.clipped = { reason: "ellipsis" }));
    expect(only(r, "text-clipped")[0]).toMatchObject({ severity: "high", evidence: { actual: "ellipsis" } });
    expect(only(r, "text-clipped")[0]!.title).toContain("puntos suspensivos");
  });

  it("si el diseño también corta el texto con el mismo motivo, no es un error", () => {
    const r = run((p, d) => {
      byText(p, "Contacto").text!.clipped = { reason: "ellipsis" };
      byText(d, "Contacto").text!.clipped = { reason: "ellipsis" };
    });
    expect(r.findings).toEqual([]);
  });
});

describe("contraste", () => {
  it("texto gris claro sobre blanco: alto; el diseño no tiene el problema", () => {
    const r = run((p) => {
      byText(p, "Vajillas y piezas únicas diseñadas junto a usted.").style.color = "#aaaaaa";
    });
    const f = only(r, "contrast");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "high" });
    expect(f[0]!.evidence).toMatchObject({ actual: "2.32:1", expected: "≥ 4.5:1" });
  });

  it("entre 3 y 4.5 es media; el texto grande exige solo 3", () => {
    const r = run((p) => {
      byText(p, "Vajillas y piezas únicas diseñadas junto a usted.").style.color = "#8a8f98"; // ~3.2:1
      byText(p, "Cerámica hecha con calma").style.color = "#8a8f98"; // 64 px: texto grande, pasa con 3:1
    });
    const f = only(r, "contrast");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "medium" });
  });

  it("si el diseño ya tiene el mismo problema, baja un nivel y lo dice", () => {
    const r = run((p, d) => {
      for (const s of [p, d]) byText(s, "Vajillas y piezas únicas diseñadas junto a usted.").style.color = "#aaaaaa";
    });
    const f = only(r, "contrast")[0]!;
    expect(f.severity).toBe("medium");
    expect(f.title).toContain("El diseño ya tiene el mismo problema");
  });

  it("usa el fondo efectivo: un fondo oscuro con transparencia se compone con lo de abajo", () => {
    const r = run((p) => {
      byName(p, "article.card", 0).style.background = "#00000099"; // negro al 60 % sobre el fondo
    });
    expect(only(r, "contrast").length).toBeGreaterThan(0);
  });
});

describe("página", () => {
  it("ancho de ventana distinto: crítico, «no son comparables»", () => {
    const r = run((p) => (p.canvas.width = 1280));
    expect(only(r, "canvas-size")[0]).toMatchObject({ severity: "critical" });
  });

  it("desborde horizontal y alto total", () => {
    const r = run((p) => {
      p.elements[0]!.box.width = 1600;
      p.canvas.height += 40;
    });
    expect(only(r, "page-overflow")[0]).toMatchObject({ severity: "high" });
    expect(only(r, "page-height")[0]).toMatchObject({ severity: "high", evidence: { expected: 927, actual: 967, delta: 40 } });
  });
});

describe("configuración", () => {
  it("las tolerancias se pueden subir", () => {
    const mutate = (p: ReturnType<typeof pageSnapshot>) => shift(p, byText(p, "Casa Nube").id, 3, 0);
    expect(run(mutate).findings).toHaveLength(1);
    expect(run(mutate, { tolerances: { position: 5 } }).findings).toEqual([]);
  });

  it("las reglas se pueden apagar", () => {
    const r = run((p) => (byText(p, "Cerámica hecha con calma").style.fontWeight = 600), { disabledRules: ["font-weight"] });
    expect(r.findings).toEqual([]);
  });

  it("los umbrales de severidad se pueden mover", () => {
    const mutate = (p: ReturnType<typeof pageSnapshot>) => shift(p, byText(p, "Casa Nube").id, 3, 0);
    expect(run(mutate, { severity: { pxMedium: 2 } }).findings[0]!.severity).toBe("medium");
  });

  it("una configuración inválida da un error en español", () => {
    expect(() => resolveConfig({ tolerances: { position: -1 } })).toThrow(/configuración de Paridad no es válida/);
    expect(() => resolveConfig({ matching: { minTextSimilarity: 2 } })).toThrow(/matching\.minTextSimilarity/);
    expect(resolveConfig().tolerances.position).toBe(1);
  });

  it("una configuración ya resuelta se usa tal cual", () => {
    const cfg = resolveConfig({ tolerances: { position: 9 } });
    expect(run((p) => shift(p, byText(p, "Casa Nube").id, 5, 0), cfg as never).findings).toEqual([]);
  });
});

describe("el reporte", () => {
  it("ordena por severidad y trae evidencia con las cajas de ambos lados", () => {
    const r = run((page) => {
      remove(page, byName(page, "article.card", 1).id);
      byText(page, "Cerámica hecha con calma").style.fontWeight = 600;
      shift(page, byText(page, "Casa Nube").id, 3, 0);
    });
    expect(r.findings.map((f) => f.severity)).toEqual(["critical", "high", "low"]);
    for (const f of r.findings.filter((x) => x.rule !== "missing")) expect(f.design && f.page).toBeTruthy();
    expect(r.summary.bySeverity).toEqual({ critical: 1, high: 1, medium: 0, low: 1 });
    expect(r.summary.byCategory).toMatchObject({ presencia: 1, tipografía: 1, posición: 1 });
    expect(clone(r).findings[0]!.id).toMatch(/^missing:/);
  });
});
