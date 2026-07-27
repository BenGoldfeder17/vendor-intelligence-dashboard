// Lightweight dependency-free SVG charts.

import { shortDate } from "@/lib/format";

export interface Series {
  name: string;
  color: string;
  /** y values aligned to `labels`. Missing points can be null (line breaks). */
  values: Array<number | null>;
  /** Render as dashed (e.g. forecast). */
  dashed?: boolean;
}

interface LineChartProps {
  labels: string[]; // ISO dates
  series: Series[];
  height?: number;
  yLabel?: string;
}

/** Multi-series line chart. Auto-scales y to the max across all series. */
export function LineChart({ labels, series, height = 220, yLabel }: LineChartProps) {
  const width = 720;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allY = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const maxY = Math.max(1, ...allY);
  const n = labels.length;

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / maxY) * innerH;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxY / ticks) * i);

  // Show at most ~8 x labels to avoid crowding.
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <div>
      {yLabel && <div className="subtle" style={{ marginBottom: 4 }}>{yLabel}</div>}
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" preserveAspectRatio="xMidYMid meet">
        {/* gridlines + y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text className="axis" x={padL - 8} y={y(t) + 3} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {labels.map((lab, i) =>
          i % labelStep === 0 ? (
            <text key={i} className="axis" x={x(i)} y={height - 8} textAnchor="middle">
              {shortDate(lab)}
            </text>
          ) : null
        )}
        {/* series */}
        {series.map((s) => (
          <g key={s.name}>
            <path
              d={linePath(s.values, x, y)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
            {s.values.map((v, i) =>
              v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} />
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function linePath(
  values: Array<number | null>,
  x: (i: number) => number,
  y: (v: number) => number
): string {
  let d = "";
  let started = false;
  values.forEach((v, i) => {
    if (v == null) {
      started = false;
      return;
    }
    d += `${started ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    started = true;
  });
  return d.trim();
}

function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

interface SparkBarsProps {
  values: number[];
  color?: string;
  height?: number;
}

/** Compact bar chart for inline contribution display. */
export function SparkBars({ values, color = "var(--accent)", height = 36 }: SparkBarsProps) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const w = 4;
  const gap = 2;
  const width = values.length * (w + gap);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {values.map((v, i) => {
        const h = (Math.abs(v) / max) * height;
        return <rect key={i} x={i * (w + gap)} y={height - h} width={w} height={h} fill={color} rx={1} />;
      })}
    </svg>
  );
}
