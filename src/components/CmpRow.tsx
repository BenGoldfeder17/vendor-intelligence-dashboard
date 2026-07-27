"use client";

import { money, number } from "@/lib/format";

export function pctVal(r: number | null | undefined): number {
  return r == null ? 0 : r * 100;
}

/** One "previous vs current" comparison row (Metric · Previous · Current · Change). */
export default function CmpRow({
  label,
  prior,
  cur,
  currency,
  suffix,
  higherIsBetter,
}: {
  label: string;
  prior: number;
  cur: number;
  currency?: string;
  suffix?: string;
  higherIsBetter?: boolean;
}) {
  const fmt = (n: number) => (currency ? money(n, currency) : suffix ? `${n.toFixed(1)}${suffix}` : number(Math.round(n)));
  const d = cur - prior;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "·";
  const cls = d === 0 || higherIsBetter == null ? "" : (higherIsBetter ? d > 0 : d < 0) ? "cmp-up" : "cmp-down";
  const dStr = currency ? money(Math.abs(d), currency) : suffix ? `${Math.abs(d).toFixed(1)}${suffix}` : number(Math.round(Math.abs(d)));
  return (
    <tr>
      <td className="metric">{label}</td>
      <td className="num">{fmt(prior)}</td>
      <td className="num">{fmt(cur)}</td>
      <td className={`num ${cls}`}>
        {arrow} {dStr}
      </td>
    </tr>
  );
}
