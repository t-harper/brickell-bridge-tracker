import { useEffect, useState } from "react";
import type { BridgeStats } from "@bridge-tracker/shared";

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtMinSec(absSec: number): string {
  if (absSec < 60) return `${absSec}s`;
  const m = Math.floor(absSec / 60);
  const s = absSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

interface Prediction {
  label: string; // "Next open" / "Closes"
  targetIso: string;
  basis: string; // "based on 21m median gap (last 7d)"
  overdueClass: "" | "overdue";
  overdueLabel: string; // "due any minute" / "closing any minute"
}

function pickPrediction(stats: BridgeStats, now: number): Prediction | null {
  if (stats.isOpen) {
    if (!stats.predictedNextCloseAt || stats.avgOpenDurationSec == null) return null;
    return {
      label: "Closes",
      targetIso: stats.predictedNextCloseAt,
      basis: `based on ${fmtMinSec(stats.avgOpenDurationSec)} avg open (last ${stats.windowDays}d)`,
      overdueClass: new Date(stats.predictedNextCloseAt).getTime() - now <= 0 ? "overdue" : "",
      overdueLabel: "closing any minute",
    };
  }
  const median = stats.breakdown.medianGapBetweenOpensSec;
  if (!stats.predictedNextOpenAt || median == null) return null;
  return {
    label: "Next open",
    targetIso: stats.predictedNextOpenAt,
    basis: `based on ${fmtMinSec(median)} median gap (last ${stats.windowDays}d)`,
    overdueClass: new Date(stats.predictedNextOpenAt).getTime() - now <= 0 ? "overdue" : "",
    overdueLabel: "due any minute",
  };
}

export function NextOpen({ stats }: { stats: BridgeStats | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return null;
  const p = pickPrediction(stats, now);
  if (!p) {
    return (
      <div className="card next-open">
        <div className="next-open-label">{stats.isOpen ? "Closes" : "Next open"}</div>
        <div className="next-open-value muted">not enough data yet</div>
      </div>
    );
  }

  const targetMs = new Date(p.targetIso).getTime();
  const deltaSec = Math.round((targetMs - now) / 1000);
  const overdue = deltaSec <= 0;

  return (
    <div className={`card next-open ${stats.isOpen ? "open" : ""} ${p.overdueClass}`}>
      <div className="next-open-label">{p.label}</div>
      <div className="next-open-value">
        {overdue ? (
          <>
            {p.overdueLabel} (overdue {fmtMinSec(-deltaSec)})
          </>
        ) : (
          <>
            ~{fmtClock(p.targetIso)}
            <span className="next-open-eta"> · in {fmtMinSec(deltaSec)}</span>
          </>
        )}
      </div>
      <div className="next-open-sub">{p.basis}</div>
    </div>
  );
}
