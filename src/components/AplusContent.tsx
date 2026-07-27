"use client";

import { useMemo, useState } from "react";
import type { AplusDocument } from "@/lib/types";

/** Drop columns that are empty across the header and every row (keep col 0 = row labels). */
function pruneTable(t: { headers: string[]; rows: string[][] }): { headers: string[]; rows: string[][] } {
  const keep = t.headers.map(
    (h, c) => c === 0 || (h ?? "").trim() !== "" || t.rows.some((r) => (r[c] ?? "").trim() !== "")
  );
  return {
    headers: t.headers.filter((_, c) => keep[c]),
    rows: t.rows.map((r) => r.filter((_, c) => keep[c])),
  };
}

/**
 * Renders A+ content the way Amazon's "From the manufacturer" section does:
 * a centered, image-forward vertical stack of modules. When a product has more
 * than one A+ document (different versions / locales / Brand Story), each becomes
 * a tab.
 */
export default function AplusContent({ docs }: { docs: AplusDocument[] }) {
  const [active, setActive] = useState(0);

  // Build clean, de-duplicated tab labels.
  const labels = useMemo(() => {
    const seen = new Map<string, number>();
    return docs.map((d, i) => {
      const base = (d.name || `A+ Content ${i + 1}`).trim();
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return n > 1 ? `${base} (${n})` : base;
    });
  }, [docs]);

  if (!docs.length) return null;
  const doc = docs[Math.min(active, docs.length - 1)];

  // Keep only modules that actually have something to show.
  const modules = doc.blocks.filter(
    (b) => (b.text && b.text.trim()) || (b.images && b.images.length > 0) || (b.table && b.table.rows.length > 0)
  );

  return (
    <div className="aplus">
      {docs.length > 1 && (
        <div className="tabs" role="tablist">
          {docs.map((d, i) => (
            <button
              key={d.contentReferenceKey + i}
              role="tab"
              aria-selected={i === active}
              className={`tab${i === active ? " active" : ""}`}
              onClick={() => setActive(i)}
            >
              {labels[i]}
            </button>
          ))}
        </div>
      )}

      <div className="aplus-doc">
        {doc.status && (
          <div className="aplus-status subtle">
            {labels[active]} · <span className="tag">{doc.status}</span>
          </div>
        )}
        {modules.length ? (
          modules.map((b, i) => {
            const imgs = b.images ?? [];
            const cols = Math.min(imgs.length || 1, 4);
            const table = b.table && b.table.rows.length > 0 ? pruneTable(b.table) : null;
            const hasTable = !!table;
            return (
              <div className="aplus-module" key={i}>
                {b.heading && <h4 className="aplus-heading">{b.heading}</h4>}
                {imgs.length > 0 && (
                  <div className={`aplus-imgs cols-${cols}`}>
                    {imgs.map((src, j) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} src={src} alt="" loading="lazy" />
                    ))}
                  </div>
                )}
                {hasTable && (
                  <div className="aplus-table-wrap">
                    <table className="aplus-table">
                      <thead>
                        <tr>
                          {table!.headers.map((h, k) => (
                            <th key={k}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table!.rows.map((row, r) => (
                          <tr key={r}>
                            {row.map((cell, c) => (
                              <td key={c} className={c === 0 ? "rowhead" : ""}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!hasTable && b.text && b.text.trim() && (
                  <div className="aplus-copy">
                    {b.text
                      .split("\n")
                      .map((p) => p.trim())
                      .filter(Boolean)
                      .map((p, k) => (
                        <p key={k}>{p}</p>
                      ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="subtle">This A+ document has no rendered modules.</p>
        )}
      </div>
    </div>
  );
}
