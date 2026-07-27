"use client";

// `months` is the trailing number of PERIODS to include. Periods are weeks, so
// week-level ranges are exact and month ranges are ~4-week approximations.
export const RANGES: Array<{ label: string; months: number | null }> = [
  { label: "Last week", months: 1 },
  { label: "Last 2 weeks", months: 2 },
  { label: "Last month", months: 4 },
  { label: "Last 3 months", months: 13 },
  { label: "Last 6 months", months: 26 },
  { label: "All", months: null },
];

export function rangeParam(months: number | null): string {
  return months == null ? "all" : String(months);
}

/** Segmented date-range control shared by the PO and Confirmation views. */
export default function RangePicker({
  months,
  onChange,
}: {
  months: number | null;
  onChange: (m: number | null) => void;
}) {
  return (
    <div className="segmented" role="tablist" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r.label}
          className={r.months === months ? "active" : ""}
          onClick={() => onChange(r.months)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
