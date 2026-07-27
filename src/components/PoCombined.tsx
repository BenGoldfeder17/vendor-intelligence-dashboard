"use client";

import { useState } from "react";
import PoAcceptance from "@/components/PoAcceptance";
import Confirmation from "@/components/Confirmation";
import { useDateRange } from "@/components/DateRangeContext";

/** Single page combining raw PO acceptance and the code-aware confirmation report.
 *  Date range + comparison come from the app-wide floating control bar. */
export default function PoCombined({ initialView }: { initialView?: string }) {
  const [view, setView] = useState<"acceptance" | "confirmation">(
    initialView === "confirmation" ? "confirmation" : "acceptance"
  );
  const { periods, compare } = useDateRange();

  return (
    <>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === "acceptance"}
          className={`tab${view === "acceptance" ? " active" : ""}`}
          onClick={() => setView("acceptance")}
        >
          PO Acceptance
        </button>
        <button
          role="tab"
          aria-selected={view === "confirmation"}
          className={`tab${view === "confirmation" ? " active" : ""}`}
          onClick={() => setView("confirmation")}
        >
          Code-Aware Confirmation
        </button>
      </div>
      {view === "acceptance" ? (
        <PoAcceptance months={periods} compare={compare} />
      ) : (
        <Confirmation months={periods} compare={compare} />
      )}
    </>
  );
}
