import type { BridgeStats } from "@bridge-tracker/shared";

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtHour(h: number | null): string {
  if (h == null) return "—";
  const ampm = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ampm}`;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function StatsPanel({ stats }: { stats: BridgeStats | null }) {
  if (!stats) return null;
  const b = stats.breakdown;
  return (
    <div className="card">
      <h2>
        Last {stats.windowDays} day{stats.windowDays === 1 ? "" : "s"} · Miami
        time
      </h2>
      <div className="stats-grid">
        <Card label="Openings" value={String(stats.opens)} sub={`${b.opensToday} today`} />
        <Card label="Avg open" value={fmtDuration(stats.avgOpenDurationSec)} />
        <Card label="Longest open" value={fmtDuration(stats.longestOpenDurationSec)} />
        <Card label="Avg gap" value={fmtDuration(b.avgGapBetweenOpensSec)} sub={`median ${fmtDuration(b.medianGapBetweenOpensSec)}`} />
        <Card label="% time UP" value={`${(b.pctTimeUp * 100).toFixed(1)}%`} />
        <Card label="Busiest / quietest" value={`${fmtHour(b.busiestHourLocal)} / ${fmtHour(b.quietestHourLocal)}`} />
      </div>
    </div>
  );
}
