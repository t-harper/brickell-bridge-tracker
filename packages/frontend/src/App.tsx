import { useEffect, useState } from "react";
import type {
  BridgeCycle,
  BridgeEvent,
  BridgeState,
  BridgeStats,
} from "@bridge-tracker/shared";
import { getCycles, getHistory, getStats, getStatus } from "./api.js";
import { StatsPanel } from "./components/StatsPanel.js";
import { Heatmap } from "./components/Heatmap.js";
import { BarChart } from "./components/BarChart.js";
import { RecentCycles } from "./components/RecentCycles.js";
import { NextOpen } from "./components/NextOpen.js";

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

function fmtHourLabel(h: number): string {
  const ampm = h < 12 ? "a" : "p";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ampm}`;
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
      <h1>
        {isUp
          ? "UP — traffic stopped"
          : state.status === "DOWN"
            ? "DOWN — open to traffic"
            : "UNKNOWN"}
      </h1>
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
            <dd>
              {state.metadata.lat.toFixed(5)}, {state.metadata.lon.toFixed(5)}
            </dd>
          </>
        )}
        <dt>Last polled</dt><dd>{fmtTime(state.lastPolledAt)}</dd>
      </dl>
    </div>
  );
}

function RawHistoryList({ events }: { events: BridgeEvent[] }) {
  if (events.length === 0)
    return <div className="card">No status changes recorded yet.</div>;
  return (
    <div className="card history">
      <h2>Raw status changes (no filter)</h2>
      <ul>
        {events.map((e, i) => (
          <li key={`${e.ts}-${i}`}>
            <span className="ts">{fmtTime(e.ts)}</span>
            <span className={`pill ${e.to.toLowerCase()}`}>
              {e.from} → {e.to}
            </span>
            {e.durationOfPrevStateSec !== null && (
              <span className="dur">
                (was {e.from} for {fmtDuration(e.durationOfPrevStateSec)})
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [cycles, setCycles] = useState<BridgeCycle[]>([]);
  const [rawEvents, setRawEvents] = useState<BridgeEvent[]>([]);
  const [denoise, setDenoise] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const minDur = denoise ? 60 : 0;
    async function refresh() {
      try {
        const [s, st, cy, hist] = await Promise.all([
          getStatus(),
          getStats(7, minDur),
          getCycles(7, 20, minDur),
          denoise ? Promise.resolve([] as BridgeEvent[]) : getHistory(7, 0),
        ]);
        if (!alive) return;
        setState(s);
        setStats(st);
        setCycles(cy);
        setRawEvents(hist);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      }
    }
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [denoise]);

  const opensByHourData =
    stats?.breakdown.opensByHourLocal.map((value, h) => ({
      label: fmtHourLabel(h),
      value,
      tooltip: `${fmtHourLabel(h)}: ${value} open${value === 1 ? "" : "s"}`,
    })) ?? [];

  const opensByDayData =
    stats?.breakdown.opensByDay.map(({ date, opens }) => {
      const [, m, d] = date.split("-");
      const label = `${parseInt(m, 10)}/${parseInt(d, 10)}`;
      return {
        label,
        value: opens,
        tooltip: `${date}: ${opens} open${opens === 1 ? "" : "s"}`,
      };
    }) ?? [];

  return (
    <div className="app">
      <header>
        <h1>Brickell Avenue Bridge</h1>
        <small>Miami • data: FL511</small>
      </header>
      {error && <div className="card error">error: {error}</div>}
      <StatusCard state={state} />
      <NextOpen stats={stats} />

      <div className="toolbar">
        <button
          type="button"
          className={`toggle ${denoise ? "on" : ""}`}
          onClick={() => setDenoise((d) => !d)}
          aria-pressed={denoise}
        >
          {denoise ? "✓ " : ""}Filter brief flaps (&lt;60s)
        </button>
        <span className="toolbar-hint">
          {denoise
            ? "Removes likely FL511 misreads from stats."
            : "Showing every transition, including 30s flaps."}
        </span>
      </div>

      <StatsPanel stats={stats} />

      {stats && stats.breakdown.heatmap.length > 0 && (
        <Heatmap breakdown={stats.breakdown} />
      )}

      {opensByHourData.length > 0 && (
        <BarChart
          title="Openings by hour of day (window total, local)"
          data={opensByHourData}
          ariaLabel="Openings by hour of day"
        />
      )}

      {opensByDayData.length > 0 && (
        <BarChart
          title="Openings by day"
          data={opensByDayData}
          ariaLabel="Openings by day"
        />
      )}

      <RecentCycles cycles={cycles} />

      {!denoise && <RawHistoryList events={rawEvents} />}
    </div>
  );
}
