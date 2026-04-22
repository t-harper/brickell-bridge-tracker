import { useEffect, useState } from "react";
import type { BridgeEvent, BridgeState, BridgeStats } from "@bridge-tracker/shared";
import { getHistory, getStats, getStatus } from "./api.js";

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function StatusCard({ state }: { state: BridgeState | null }) {
  if (!state) return <div className="card">Waiting for first poll…</div>;
  const isUp = state.status === "UP";
  const sinceSec = Math.max(
    0,
    Math.round((Date.now() - new Date(state.statusChangedAt).getTime()) / 1000),
  );
  return (
    <div className={`card status ${isUp ? "up" : "down"}`}>
      <h1>{isUp ? "UP — traffic stopped" : state.status === "DOWN" ? "DOWN — open to traffic" : "UNKNOWN"}</h1>
      <div className="since">for {fmtDuration(sinceSec)}</div>
      <dl>
        <dt>Roadway</dt><dd>{state.metadata.roadway ?? "—"}</dd>
        <dt>Location</dt><dd>{state.metadata.location ?? "—"}</dd>
        <dt>County</dt><dd>{state.metadata.county ?? "—"}</dd>
        <dt>Direction</dt><dd>{state.metadata.direction ?? "—"}</dd>
        <dt>Waterway</dt><dd>{state.metadata.waterway ?? "—"}</dd>
        {state.metadata.lat !== null && state.metadata.lon !== null && (
          <>
            <dt>Lat/Lon</dt>
            <dd>{state.metadata.lat.toFixed(5)}, {state.metadata.lon.toFixed(5)}</dd>
          </>
        )}
        <dt>Last polled</dt><dd>{fmtTime(state.lastPolledAt)}</dd>
      </dl>
    </div>
  );
}

function StatsPanel({ stats }: { stats: BridgeStats | null }) {
  if (!stats) return null;
  return (
    <div className="card stats">
      <h2>Last {stats.windowDays} day{stats.windowDays === 1 ? "" : "s"}</h2>
      <div className="row"><span>Openings</span><b>{stats.opens}</b></div>
      <div className="row">
        <span>Avg open duration</span>
        <b>{stats.avgOpenDurationSec !== null ? fmtDuration(stats.avgOpenDurationSec) : "—"}</b>
      </div>
      <div className="row">
        <span>Longest open</span>
        <b>{stats.longestOpenDurationSec !== null ? fmtDuration(stats.longestOpenDurationSec) : "—"}</b>
      </div>
    </div>
  );
}

function HistoryList({ events }: { events: BridgeEvent[] }) {
  if (events.length === 0) return <div className="card">No status changes recorded yet.</div>;
  return (
    <div className="card history">
      <h2>Recent status changes</h2>
      <ul>
        {events.map((e, i) => (
          <li key={`${e.ts}-${i}`}>
            <span className="ts">{fmtTime(e.ts)}</span>
            <span className={`pill ${e.to.toLowerCase()}`}>{e.from} → {e.to}</span>
            {e.durationOfPrevStateSec !== null && (
              <span className="dur">(was {e.from} for {fmtDuration(e.durationOfPrevStateSec)})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const [s, h, st] = await Promise.all([getStatus(), getHistory(7), getStats(7)]);
        if (!alive) return;
        setState(s);
        setEvents(h);
        setStats(st);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      }
    }
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="app">
      <header><h1>Brickell Avenue Bridge</h1><small>Miami • data: FL511</small></header>
      {error && <div className="card error">error: {error}</div>}
      <StatusCard state={state} />
      <StatsPanel stats={stats} />
      <HistoryList events={events} />
    </div>
  );
}
