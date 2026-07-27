"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncStatus } from "@/lib/types";

/** Shared sync state: polls status, triggers a sync, fires onComplete when done. */
export function useSyncStatus(onComplete?: () => void) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [ppmNote, setPpmNote] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ppmPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const loadStatus = useCallback(async (): Promise<SyncStatus | null> => {
    try {
      const res = await fetch("/api/sync", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SyncStatus;
      setStatus(json);
      setNetError(null);
      return json;
    } catch {
      return null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await loadStatus();
      if (!s || !s.running) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (s?.phase === "done") onCompleteRef.current?.();
      }
    }, 2000);
  }, [loadStatus]);

  useEffect(() => {
    void loadStatus().then((s) => {
      if (s?.running) startPolling();
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (ppmPollRef.current) clearInterval(ppmPollRef.current);
    };
  }, [loadStatus, startPolling]);

  // Poll the Net PPM check endpoint until the query lands (or fails). Data Kiosk
  // can take several minutes, so this keeps checking gently in the background.
  const pollNetPpm = useCallback(() => {
    if (ppmPollRef.current) return;
    let tries = 0;
    ppmPollRef.current = setInterval(async () => {
      tries += 1;
      // Give up after ~15 min of background polling (45 × 20s) — but the query
      // isn't lost; the next sync's check will still pick it up if it lands later.
      if (tries > 45) {
        if (ppmPollRef.current) clearInterval(ppmPollRef.current);
        ppmPollRef.current = null;
        return;
      }
      try {
        const r = await fetch("/api/net-ppm/pull", { cache: "no-store" });
        const j = (await r.json()) as {
          state?: string; rowCount?: number; error?: string;
        };
        if (j.state === "pending" || j.state === "idle") return; // keep waiting
        // terminal
        if (ppmPollRef.current) clearInterval(ppmPollRef.current);
        ppmPollRef.current = null;
        if (j.state === "stored") setPpmNote(`Net PPM refreshed (${j.rowCount ?? 0} ASINs).`);
        else if (j.state === "empty") setPpmNote("Net PPM: Amazon returned no data for this range.");
        else setPpmNote(`Net PPM: ${j.error ?? "pull failed."}`);
      } catch {
        /* transient; keep polling */
      }
    }, 20_000);
  }, []);

  const triggerSync = useCallback(async () => {
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok && res.status !== 200 && res.status !== 202) throw new Error(`HTTP ${res.status}`);
      setNetError(null);

      // Start the Net PPM pull (returns instantly with a queryId), then poll the
      // check endpoint in the background until Amazon finishes. This avoids the
      // synchronous timeout — nothing holds a request open waiting on Data Kiosk.
      setPpmNote("Net PPM: requested from Amazon…");
      void fetch("/api/net-ppm/pull", { method: "POST" })
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { error?: string; alreadyRunning?: boolean };
          if (j.error) {
            setPpmNote(`Net PPM: ${j.error}`);
            return;
          }
          pollNetPpm();
        })
        .catch(() => setPpmNote("Net PPM: could not reach Amazon."));

      await loadStatus();
      startPolling();
    } catch (e) {
      setNetError(
        `Sync request failed (${e instanceof Error ? e.message : "network error"}). ` +
          `The server may have restarted — reload the page and try again.`
      );
    }
  }, [loadStatus, startPolling]);


  return { status, netError, ppmNote, triggerSync };
}

export function SyncButton({ status, onSync }: { status: SyncStatus | null; onSync: () => void }) {
  const running = status?.running ?? false;
  return (
    <button className="btn btn-cta" onClick={onSync} disabled={running}>
      {running ? "Syncing…" : "↻ Sync now"}
    </button>
  );
}

export function NetErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="warnbox"
      style={{ borderColor: "rgba(209,50,18,0.4)", background: "#fdf3f1", color: "var(--red)" }}
    >
      {message}
    </div>
  );
}

export function SyncBar({ status }: { status: SyncStatus | null }) {
  if (!status || status.phase === "idle") return null;
  const pct =
    status.progress.total > 0 ? Math.round((status.progress.current / status.progress.total) * 100) : 0;
  const dotClass = status.running
    ? "running"
    : status.phase === "error"
      ? "error"
      : status.phase === "done"
        ? "done"
        : "";
  return (
    <div className="panel syncbar">
      <span className={`dot ${dotClass}`} />
      <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{status.phase.replace(/-/g, " ")}</span>
      <span className="muted">— {status.error ?? status.message}</span>
      {status.running && status.progress.total > 0 && (
        <>
          <div className="progressbar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="subtle">
            {status.progress.current}/{status.progress.total}
          </span>
        </>
      )}
      {status.warnings.length > 0 && !status.running && (
        <span className="subtle" title={status.warnings.join("\n")}>
          ⚠ {status.warnings.length} warning(s)
        </span>
      )}
    </div>
  );
}

/**
 * Global navbar sync control. Self-contained: owns its own sync state so it works
 * on every page regardless of what that page mounts. Triggers the unified sync
 * (main sync + Net PPM pull) and shows compact live progress inline.
 */
export function NavSyncButton() {
  const { status, netError, ppmNote, triggerSync } = useSyncStatus();
  const running = status?.running ?? false;
  const pct =
    status && status.progress.total > 0
      ? Math.round((status.progress.current / status.progress.total) * 100)
      : 0;

  // Real ETA from actual progress rate: elapsed / fraction-done → projected total,
  // minus elapsed → remaining. Honest (derived from measured pace), not a fake bar.
  const eta = (() => {
    if (!running || !status?.startedAt || status.progress.total <= 0) return null;
    const done = status.progress.current;
    if (done <= 0) return null;
    const elapsedMs = Date.now() - new Date(status.startedAt).getTime();
    if (elapsedMs < 1500) return null; // too early to estimate meaningfully
    const fraction = done / status.progress.total;
    const projectedTotal = elapsedMs / fraction;
    const remainingMs = Math.max(0, projectedTotal - elapsedMs);
    return remainingMs;
  })();

  const etaLabel = eta == null ? null : formatEta(eta);

  return (
    <div className="nav-sync">
      {running && status && status.progress.total > 0 && (
        <span className="nav-sync-prog" title={status.message}>
          <span className="nav-sync-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="nav-sync-pct">
            {pct}%{etaLabel ? ` · ${etaLabel} left` : ""}
          </span>
        </span>
      )}
      {!running && ppmNote && (
        <span className="nav-sync-note" title={ppmNote}>
          {ppmNote.startsWith("Net PPM:") ? "⚠" : "✓"}
        </span>
      )}
      <button className="nav-sync-btn" onClick={() => void triggerSync()} disabled={running}>
        <i className={`ti ti-refresh ${running ? "spin" : ""}`} aria-hidden="true" />
        {running ? "Syncing…" : "Sync"}
      </button>
      {netError && <span className="nav-sync-err" title={netError}>!</span>}
    </div>
  );
}

function formatEta(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `~${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `~${min}m` : `~${min}m ${rem}s`;
}
