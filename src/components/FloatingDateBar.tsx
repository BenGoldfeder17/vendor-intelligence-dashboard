"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { RANGES } from "@/components/RangePicker";
import { useDateRange } from "@/components/DateRangeContext";

/**
 * The only views that read the date range are Overview ("/") and PO &
 * Confirmation ("/po"). Showing the bar on Catalog, Insights, Product or Submit
 * implies a control that does nothing, so it hides itself there.
 */
function usesDateRange(pathname: string): boolean {
  // Sales overview and the Risk hub's confirmation tab consume the date range.
  return pathname.startsWith("/sales") || pathname.startsWith("/risk");
}

/** Floating date-range + comparison control, shown only on date-aware pages. */
export default function FloatingDateBar() {
  const pathname = usePathname();
  const { periods, compare, setPeriods, setCompare } = useDateRange();
  const [open, setOpen] = useState(true);
  const activeLabel = RANGES.find((r) => r.months === periods)?.label ?? "Custom";

  // Hooks above, early-return below — never conditionally call a hook.
  if (!usesDateRange(pathname)) return null;

  if (!open) {
    return (
      <button className="fdb-pill" onClick={() => setOpen(true)} title="Date range">
        📅 {activeLabel}
        {compare ? " · vs prior" : ""} ▴
      </button>
    );
  }

  return (
    <div className="fdb">
      <span className="fdb-label">📅 Date range</span>
      <div className="fdb-ranges">
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={r.months === periods ? "active" : ""}
            onClick={() => setPeriods(r.months)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <label className="fdb-compare">
        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
        Compare vs prior
      </label>
      <button className="fdb-min" onClick={() => setOpen(false)} title="Minimize" aria-label="Minimize">
        ▾
      </button>
    </div>
  );
}
