import { useEffect, useState } from "react";
import type { BridgeStats } from "@bridge-tracker/shared";

const TZ = "America/New_York";

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

function fmtHour12(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ampm}`;
}

const localHourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "2-digit",
  hourCycle: "h23",
});
function localHour(now: number): number {
  return parseInt(localHourFmt.format(new Date(now)), 10) || 0;
}

// Walk forward from currentHour to find the next local hour with at least
// `minOpens` historical opens — i.e. when the bridge is "active" again.
function nextActiveHour(
  opensByHour: number[],
  currentHour: number,
  minOpens = 1,
): number | null {
  for (let i = 1; i <= 24; i++) {
    const h = (currentHour + i) % 24;
    if ((opensByHour[h] ?? 0) >= minOpens) return h;
  }
  return null;
}

interface Prediction {
  label: string;
  targetIso: string;
  basis: string;
  overdueLabel: string;
  cardClass: string;
}

function pickPrediction(stats: BridgeStats, now: number): Prediction | null {
  if (stats.isOpen) {
    if (!stats.predictedNextCloseAt || stats.avgOpenDurationSec == null) return null;
    return {
      label: "Closes",
      targetIso: stats.predictedNextCloseAt,
      basis: `based on ${fmtMinSec(stats.avgOpenDurationSec)} avg open (last ${stats.windowDays}d)`,
      overdueLabel: "closing any minute",
      cardClass: "open",
    };
  }
  const median = stats.breakdown.medianGapBetweenOpensSec;
  if (!stats.predictedNextOpenAt || median == null) return null;
  return {
    label: "Next open",
    targetIso: stats.predictedNextOpenAt,
    basis: `based on ${fmtMinSec(median)} median gap (last ${stats.windowDays}d)`,
    overdueLabel: "due any minute",
    cardClass: "",
  };
}

export function NextOpen({ stats }: { stats: BridgeStats | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return null;

  // Feed offline — the server has marked the bridge UNKNOWN because FL511's
  // upstream row hasn't refreshed. Predictions are meaningless until the
  // feed catches up; the StatusCard surfaces the banner.
  if (stats.currentStatus === "UNKNOWN") return null;

  // Quiet-hour mode: bridge is DOWN, the current local hour has zero
  // historical opens in the window, and the prediction is meaningfully
  // overdue. Surface a "typically reopens at Xam" line instead of a
  // misleading negative countdown like "overdue 306m".
  if (!stats.isOpen) {
    const hour = localHour(now);
    const opensThisHour = stats.breakdown.opensByHourLocal[hour] ?? 0;
    const predIso = stats.predictedNextOpenAt;
    const predOverdueSec = predIso
      ? Math.max(0, Math.round((now - new Date(predIso).getTime()) / 1000))
      : 0;
    const isQuiet = opensThisHour === 0 && predOverdueSec > 30 * 60;
    if (isQuiet) {
      const next = nextActiveHour(stats.breakdown.opensByHourLocal, hour);
      return (
        <div className="card next-open quiet">
          <div className="next-open-label">Quiet window</div>
          <div className="next-open-value">
            {next != null
              ? `typically reopens around ${fmtHour12(next)}`
              : "no opens recorded in this window"}
          </div>
          <div className="next-open-sub">
            this hour ({fmtHour12(hour)}) has 0 opens in the last {stats.windowDays}d
          </div>
        </div>
      );
    }
  }

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
    <div className={`card next-open ${p.cardClass} ${overdue ? "overdue" : ""}`}>
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
