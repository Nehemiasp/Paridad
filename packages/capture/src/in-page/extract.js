// Extractor que corre DENTRO de la página (se serializa y se evalúa en el navegador).
// Es JS plano a propósito: un transpilador (tsx/esbuild) inyecta helpers como `__name`
// que no existen en la página al serializar una función TS (ver D-017 en CLAUDE.md).
//
// Es una expresión de función: recibe `opts` y devuelve datos serializables.
//   opts = { ignoreSelectors: string[], ignoreRects: {x,y,width,height}[] }
// Convenciones de los elementos: ver docs/snapshot.md y D-009/D-010.
(opts) => {
  const SKIP_TAGS = new Set(["HTML", "HEAD", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "TITLE", "BASE"]);
  const LEAF_TAGS = new Set(["SVG", "CANVAS", "VIDEO", "IFRAME", "OBJECT", "EMBED", "PICTURE", "IMG"]);
  const IMAGE_TAGS = new Set(["IMG", "SVG", "CANVAS", "VIDEO", "PICTURE"]);

  const r2 = (n) => Math.round(n * 100) / 100;
  const sx = window.scrollX;
  const sy = window.scrollY;

  // ── Colores ────────────────────────────────────────────────────────────────
  let canvasCtx = null;
  const h2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  /** CSS computado → `#rrggbb[aa]`, o null si es totalmente transparente o no se entiende. */
  function toHex(css) {
    if (!css) return null;
    let rgba = null;
    const m = css.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map((v) => (v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v)));
      const a = p.length > 3 ? (m[1].includes("%") && p[3] > 1 ? p[3] / 255 : p[3]) : 1;
      rgba = [p[0], p[1], p[2], a];
    } else {
      // oklch(), lab(), color(display-p3 …): se convierte a sRGB pintando un píxel.
      canvasCtx = canvasCtx || document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      canvasCtx.canvas.width = canvasCtx.canvas.height = 1;
      canvasCtx.clearRect(0, 0, 1, 1);
      canvasCtx.fillStyle = "#000";
      canvasCtx.fillStyle = css;
      canvasCtx.fillRect(0, 0, 1, 1);
      const d = canvasCtx.getImageData(0, 0, 1, 1).data;
      rgba = [d[0], d[1], d[2], d[3] / 255];
    }
    if (!rgba || rgba.some((v) => Number.isNaN(v))) return null;
    if (rgba[3] <= 0) return null;
    return "#" + h2(rgba[0]) + h2(rgba[1]) + h2(rgba[2]) + (rgba[3] < 1 ? h2(rgba[3] * 255) : "");
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  };
  function firstFamily(stack) {
    const m = stack.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
    return m ? (m[1] || m[2] || m[3] || "").trim() : "";
  }
  function applyTransform(text, transform) {
    if (transform === "uppercase") return text.toUpperCase();
    if (transform === "lowercase") return text.toLowerCase();
    if (transform === "capitalize") return text.replace(/(^|\s)(\S)/gu, (_, s, c) => s + c.toUpperCase());
    return text;
  }
  const normalize = (s) => s.normalize("NFKC").replace(/\s+/gu, " ").trim();

  function cssPath(el) {
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
        parts.unshift(part + "#" + cur.id);
        break;
      }
      const same = cur.parentElement ? Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName) : [];
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(cur) + 1) + ")";
      parts.unshift(part);
    }
    return parts.join(" > ");
  }
  function label(el) {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return el.tagName.toLowerCase() + cls.map((c) => "." + c).join("");
  }

  function pageBox(rect) {
    return { x: r2(rect.left + sx), y: r2(rect.top + sy), width: r2(rect.width), height: r2(rect.height) };
  }
  const insideRect = (b, z) => b.x >= z.x - 0.5 && b.y >= z.y - 0.5 && b.x + b.width <= z.x + z.width + 0.5 && b.y + b.height <= z.y + z.height + 0.5;
  const isIgnoredByRect = (b) => opts.ignoreRects.some((z) => insideRect(b, z));

  /** Región visible del elemento: recorta contra el ancestro más cercano (o él mismo) que corta el desbordamiento. */
  function clipRegion(el) {
    for (let cur = el; cur && cur !== document.documentElement && cur !== document.body; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const r = cur.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
    }
    return null;
  }

  // ── Cajas ─────────────────────────────────────────────────────────────────
  function uniformBorder(cs) {
    const sides = ["Top", "Right", "Bottom", "Left"];
    const w = sides.map((s) => px(cs["border" + s + "Width"]));
    const st = sides.map((s) => cs["border" + s + "Style"]);
    const co = sides.map((s) => cs["border" + s + "Color"]);
    if (w[0] <= 0 || w.some((v) => v !== w[0]) || st.some((v) => v !== st[0]) || co.some((v) => v !== co[0])) return null;
    if (!["solid", "dashed", "dotted", "double"].includes(st[0])) return null;
    const color = toHex(co[0]);
    return color ? { width: w[0], style: st[0], color } : null;
  }
  function parseShadows(value) {
    if (!value || value === "none") return [];
    const out = [];
    // Separa por comas fuera de paréntesis.
    const items = [];
    let depth = 0;
    let cur = "";
    for (const ch of value) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        items.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) items.push(cur);
    for (const it of items) {
      const inset = /\binset\b/.test(it);
      const colorMatch = it.match(/(rgba?\([^)]*\)|(?:oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8})/i);
      const color = colorMatch ? toHex(colorMatch[1]) : null;
      const nums = it.replace(colorMatch ? colorMatch[1] : "", "").replace("inset", "").trim().split(/\s+/).map(parseFloat).filter((n) => !Number.isNaN(n));
      if (!color || nums.length < 2) continue;
      const s = { x: nums[0], y: nums[1], blur: Math.max(0, nums[2] || 0), spread: nums[3] || 0, color };
      if (inset) s.inset = true;
      out.push(s);
    }
    return out;
  }
  function radiusOf(cs) {
    const c = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((k) => px(cs["border" + k + "Radius"]));
    if (c.every((v) => v === 0)) return undefined;
    return c.every((v) => v === c[0]) ? c[0] : c;
  }
  function boxStyle(cs) {
    const s = {};
    const bg = toHex(cs.backgroundColor);
    if (bg) s.background = bg;
    const border = uniformBorder(cs);
    if (border) s.border = border;
    const radius = radiusOf(cs);
    if (radius !== undefined) s.radius = radius;
    const shadows = parseShadows(cs.boxShadow);
    if (shadows.length) s.shadows = shadows;
    const op = parseFloat(cs.opacity);
    if (op < 1) s.opacity = r2(op);
    return s;
  }

  // ── Texto ─────────────────────────────────────────────────────────────────
  /** Unión de las líneas del texto; cada línea con el alto de su interlineado (D-009). */
  function textBoxOf(nodes, cs) {
    const fs = px(cs.fontSize);
    const lhRaw = cs.lineHeight === "normal" ? 0 : px(cs.lineHeight);
    const rects = [];
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 0.5 && r.height > 0) rects.push(r);
    }
    if (!rects.length) return null;
    const lines = [];
    for (const r of rects.sort((a, b) => a.top + a.height / 2 - (b.top + b.height / 2))) {
      const c = r.top + r.height / 2;
      const lh = lhRaw || r.height;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.c - c) < Math.max(2, 0.4 * lh)) {
        last.l = Math.min(last.l, r.left);
        last.r = Math.max(last.r, r.right);
      } else lines.push({ c, l: r.left, r: r.right, lh });
    }
    const left = Math.min(...lines.map((l) => l.l));
    const right = Math.max(...lines.map((l) => l.r));
    const top = Math.min(...lines.map((l) => l.c - l.lh / 2));
    const bottom = Math.max(...lines.map((l) => l.c + l.lh / 2));
    return { left, top, right, bottom, lines: lines.length, fs };
  }

  // ── Recorrido ────────────────────────────────────────────────────────────
  const elements = [];
  const ignoredRects = [];
  let seq = 0;
  let z = 0;
  let textIdx = 0;
  const nextId = () => "e" + ++seq;

  function emit(el) {
    elements.push(el);
  }

  function walk(el, parentId) {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    if (parseFloat(cs.opacity) === 0) return;

    for (const sel of opts.ignoreSelectors) {
      let hit = false;
      try {
        hit = el.matches(sel);
      } catch {
        hit = false;
      }
      if (hit) {
        const b = pageBox(el.getBoundingClientRect());
        if (b.width > 0 && b.height > 0) ignoredRects.push(b);
        return;
      }
    }

    const tag = el.tagName.toUpperCase();
    const visible = cs.visibility === "visible";
    const rect = el.getBoundingClientRect();
    const clip = clipRegion(el);
    let boxId = null;

    // Caja o imagen propia.
    // El <body> no se emite como caja: su fondo ya es el de la raíz «page».
    if (el !== document.body && visible && rect.width > 0 && rect.height > 0) {
      const isImage = IMAGE_TAGS.has(tag);
      const style = boxStyle(cs);
      const hasPaint = Object.keys(style).some((k) => k !== "opacity" && k !== "radius");
      if (isImage || hasPaint) {
        const box = pageBox(rect);
        if (!isIgnoredByRect(box)) {
          boxId = nextId();
          const e = { id: boxId, kind: isImage ? "image" : "box", name: label(el), path: cssPath(el), parentId, z: z++, box, style };
          if (isImage) {
            const img = tag === "IMG" ? el : tag === "PICTURE" ? el.querySelector("img") : null;
            const image = {};
            const src = img ? img.currentSrc || img.src : tag === "VIDEO" ? el.currentSrc || el.poster : "";
            if (src) image.src = src.startsWith("data:") ? "data:…" : src;
            const alt = img ? img.getAttribute("alt") : el.getAttribute("aria-label");
            if (alt) image.alt = alt;
            e.image = image;
          }
          emit(e);
        }
      }
    }

    // Texto propio (nodos de texto hijos directos).
    if (!LEAF_TAGS.has(tag) && visible) {
      const nodes = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim() !== "");
      if (nodes.length && px(cs.fontSize) > 0) {
        const raw = textBoxOf(nodes, cs);
        if (raw) {
          let left = raw.left;
          let top = raw.top;
          let right = raw.right;
          let bottom = raw.bottom;
          let shrunk = false;
          if (clip) {
            const l = Math.max(left, clip.left);
            const t = Math.max(top, clip.top);
            const rr = Math.min(right, clip.right);
            const b = Math.min(bottom, clip.bottom);
            shrunk = l - left > 1 || t - top > 1 || right - rr > 1 || bottom - b > 1;
            left = l;
            top = t;
            right = rr;
            bottom = b;
          }
          if (right - left > 0 && bottom - top > 0) {
            const box = pageBox({ left, top, width: right - left, height: bottom - top });
            if (!isIgnoredByRect(box)) {
              const content = applyTransform(nodes.map((n) => n.textContent).join(" "), cs.textTransform).replace(/\s+/gu, " ").trim();
              const ls = cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing);
              const style = { fontFamily: firstFamily(cs.fontFamily), fontSize: px(cs.fontSize), fontWeight: Number(cs.fontWeight) || 400, lineHeight: cs.lineHeight === "normal" ? null : px(cs.lineHeight), letterSpacing: r2(ls) };
              const color = toHex(cs.color);
              if (color) style.color = color;
              const op = parseFloat(cs.opacity);
              if (op < 1) style.opacity = r2(op);

              // Texto cortado o desbordado.
              let reason = null;
              const overflowing = cs.overflowX !== "visible" || cs.overflowY !== "visible";
              if (cs.textOverflow === "ellipsis" && overflowing && el.scrollWidth > el.clientWidth + 0.5) reason = "ellipsis";
              else if ((cs.getPropertyValue("-webkit-line-clamp") || "none") !== "none" && el.scrollHeight > el.clientHeight + 1) reason = "line-clamp";
              else if (shrunk) reason = "overflow";
              else if (overflowing && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && nodes.length) reason = "overflow";

              const idx = textIdx++;
              el.setAttribute("data-paridad-i", String(idx));
              const e = {
                id: nextId(),
                kind: "text",
                name: label(el),
                path: cssPath(el),
                parentId: boxId || parentId,
                z: z++,
                box,
                text: { content, normalized: normalize(content) },
                style,
                _textIdx: idx,
              };
              if (reason) e.text.clipped = { reason };
              emit(e);
            }
          }
        }
      }
    }

    if (LEAF_TAGS.has(tag)) return;
    const childParent = boxId || parentId;
    for (const child of el.children) walk(child, childParent);
  }

  walk(document.body, "page");

  const rootCs = getComputedStyle(document.body);
  const rootBg = toHex(rootCs.backgroundColor) || toHex(getComputedStyle(document.documentElement).backgroundColor) || "#ffffff";
  const fonts = Array.from(document.fonts)
    .filter((f) => f.status === "loaded")
    .map((f) => ({ family: f.family.replace(/^["']|["']$/g, ""), weight: f.weight }));

  return { elements, ignoredRects, rootBg, title: document.title, loadedFonts: fonts, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
}
