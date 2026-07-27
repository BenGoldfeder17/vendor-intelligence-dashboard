"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface DateRangeState {
  periods: number | null; // trailing period (week) count; null = all
  compare: boolean;
  setPeriods: (p: number | null) => void;
  setCompare: (c: boolean) => void;
}

const Ctx = createContext<DateRangeState | null>(null);
const KEY = "avc-daterange";

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [periods, setPeriodsState] = useState<number | null>(13); // default: last 3 months
  const [compare, setCompareState] = useState(true);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw) as { periods?: number | null; compare?: boolean };
        if (v.periods !== undefined) setPeriodsState(v.periods);
        if (typeof v.compare === "boolean") setCompareState(v.compare);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (p: number | null, c: boolean) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ periods: p, compare: c }));
    } catch {
      /* ignore */
    }
  };
  const setPeriods = (p: number | null) => {
    setPeriodsState(p);
    persist(p, compare);
  };
  const setCompare = (c: boolean) => {
    setCompareState(c);
    persist(periods, c);
  };

  return <Ctx.Provider value={{ periods, compare, setPeriods, setCompare }}>{children}</Ctx.Provider>;
}

export function useDateRange(): DateRangeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDateRange must be used within DateRangeProvider");
  return v;
}
