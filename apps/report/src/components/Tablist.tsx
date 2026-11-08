"use client";

import { useRef } from "react";

export interface TabItem {
  id: string;
  label: string;
}

/**
 * Pestañas accesibles (patrón WAI-ARIA): una sola con tabindex 0, flechas ← → para moverse, Inicio y Fin.
 * El panel asociado lo pinta quien la use, con `role="tabpanel"` y `aria-labelledby={`${prefix}-tab-${id}`}`.
 */
export function Tablist({ items, selected, onSelect, label, prefix, className, tabClassName }: { items: TabItem[]; selected: string; onSelect: (id: string) => void; label: string; prefix: string; className: string; tabClassName: string }) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const move = (to: number) => {
    const item = items[(to + items.length) % items.length];
    if (!item) return;
    onSelect(item.id);
    refs.current.get(item.id)?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") move(i + 1);
    else if (e.key === "ArrowLeft") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div role="tablist" aria-label={label} className={className}>
      {items.map((it, i) => (
        <button
          key={it.id}
          ref={(el) => {
            if (el) refs.current.set(it.id, el);
          }}
          role="tab"
          type="button"
          id={`${prefix}-tab-${it.id}`}
          aria-selected={it.id === selected}
          aria-controls={`${prefix}-panel`}
          tabIndex={it.id === selected ? 0 : -1}
          className={tabClassName}
          onClick={() => onSelect(it.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
