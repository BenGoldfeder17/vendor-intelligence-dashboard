"use client";

import { useCallback, useEffect, useState } from "react";
import { percent } from "@/lib/format";

interface Field {
  key: string;
  label: string;
  hint: string;
}

interface ContractsResponse {
  source: "storage" | "environment" | "none";
  meta: { updatedAt: string; codeCount: number } | null;
  byVendorCode: Record<string, Record<string, number>>;
  defaults: Record<string, number>;
  fields: Field[];
}

/** A row in the editor. Values are strings so a half-typed entry isn't destroyed. */
interface Row {
  code: string;
  values: Record<string, string>;
}

export default function ContractEditor() {
  const [data, setData] = useState<ContractsResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string; details?: string[] } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/contracts", { cache: "no-store" });
    const j = (await r.json()) as ContractsResponse;
    setData(j);
    setRows(
      Object.entries(j.byVendorCode).map(([code, terms]) => ({
        code,
        // Stored as fractions; show as percents, which is how people talk about them.
        values: Object.fromEntries(
          Object.entries(terms).map(([k, v]) => [k, (v * 100).toFixed(2).replace(/\.?0+$/, "")])
        ),
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function addRow() {
    setRows((r) => [...r, { code: "", values: {} }]);
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  function setCode(i: number, code: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, code: code.toUpperCase() } : row)));
  }

  function setValue(i: number, key: string, v: string) {
    setRows((r) =>
      r.map((row, idx) => (idx === i ? { ...row, values: { ...row.values, [key]: v } } : row))
    );
  }

  async function save() {
    setSaving(true);
    setMsg(null);

    const byVendorCode: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const code = row.code.trim().toUpperCase();
      if (!code) continue;
      const terms: Record<string, number> = {};
      for (const [k, raw] of Object.entries(row.values)) {
        const t = raw.trim().replace("%", "");
        if (t === "") continue; // omitted → inherits the default
        const n = Number(t);
        if (Number.isFinite(n)) terms[k] = n; // server normalises percent vs fraction
      }
      if (Object.keys(terms).length) byVendorCode[code] = terms;
    }

    const r = await fetch("/api/contracts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ byVendorCode }),
    });
    const j = (await r.json()) as { ok?: boolean; error?: string; errors?: string[] };
    setSaving(false);

    if (j.ok) {
      setMsg({ kind: "ok", text: `Saved ${Object.keys(byVendorCode).length} vendor code(s).` });
      void load();
    } else {
      setMsg({ kind: "bad", text: j.error ?? "Save failed.", details: j.errors });
    }
  }

  if (loading && !data) return <div className="panel panel-pad subtle">Loading contracts…</div>;
  if (!data) return null;

  const fields = data.fields;

  return (
    <div className="ce">
      <div className="ce-head">
        <div>
          <h2 style={{ margin: 0 }}>Vendor contracts</h2>
          <p className="subtle" style={{ margin: "4px 0 0" }}>
            Terms are negotiated per vendor code. A single global floor mis-ranks codes
            whenever they differ — a code at 31% under a 30% contract is healthy, while one
            at 34% under a 36% contract is underwater.
          </p>
        </div>
        <div className="ce-source">
          <span className={`ce-badge ${data.source}`}>
            {data.source === "storage"
              ? "saved here"
              : data.source === "environment"
                ? "from environment"
                : "none configured"}
          </span>
          {data.meta && (
            <div className="subtle small">
              updated {new Date(data.meta.updatedAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {data.source === "none" && (
        <div className="ce-warn">
          No contracts configured — every vendor code is judged against the fallback floor of{" "}
          <strong>{percent(data.defaults.floor)}</strong>. Add your codes below so the risk
          panels rank against real terms.
        </div>
      )}

      {msg && (
        <div className={`ce-msg ${msg.kind}`}>
          <div>{msg.text}</div>
          {msg.details && msg.details.length > 0 && (
            <ul>
              {msg.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="panel ce-table-wrap">
        <table className="ce-table">
          <thead>
            <tr>
              <th>Vendor code</th>
              {fields.map((f) => (
                <th key={f.key} className="num" title={f.hint}>
                  {f.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={fields.length + 2} className="subtle" style={{ padding: 20 }}>
                  No vendor codes yet — add one below.
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="ce-input ce-code"
                    value={row.code}
                    placeholder="ABCDE"
                    onChange={(e) => setCode(i, e.target.value)}
                  />
                </td>
                {fields.map((f) => (
                  <td key={f.key} className="num">
                    <input
                      className="ce-input ce-num"
                      value={row.values[f.key] ?? ""}
                      placeholder={
                        f.key === "floor"
                          ? (data.defaults.floor * 100).toFixed(2)
                          : "—"
                      }
                      onChange={(e) => setValue(i, f.key, e.target.value)}
                      inputMode="decimal"
                    />
                    <span className="ce-pct">%</span>
                  </td>
                ))}
                <td>
                  <button className="ce-remove" onClick={() => removeRow(i)} title="Remove">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ce-actions">
        <button className="btn-ghost" onClick={addRow} disabled={saving}>
          + Add vendor code
        </button>
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save contracts"}
        </button>
      </div>

      <p className="subtle small ce-foot">
        Enter percentages — <code>30</code> and <code>0.30</code> are both read as 30%. Leave a
        field blank to inherit the default. Saved to your app&apos;s storage, not to a config
        file, so no redeploy is needed and the values are never written to disk on a
        developer machine.
      </p>
    </div>
  );
}
