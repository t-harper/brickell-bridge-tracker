import type {
  BridgeCycle,
  BridgeEvent,
  BridgeState,
  BridgeStats,
} from "@bridge-tracker/shared";

const base = "";

export async function getStatus(): Promise<BridgeState | null> {
  const r = await fetch(`${base}/api/bridges/brickell`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as BridgeState;
}

export async function getHistory(
  days = 7,
  minDurationSec = 0,
): Promise<BridgeEvent[]> {
  const r = await fetch(
    `${base}/api/bridges/brickell/history?days=${days}&minDurationSec=${minDurationSec}`,
  );
  if (!r.ok) throw new Error(`history ${r.status}`);
  const data = (await r.json()) as { events: BridgeEvent[] };
  return data.events;
}

export async function getStats(
  days = 7,
  minDurationSec = 60,
): Promise<BridgeStats> {
  const r = await fetch(
    `${base}/api/bridges/brickell/stats?days=${days}&minDurationSec=${minDurationSec}`,
  );
  if (!r.ok) throw new Error(`stats ${r.status}`);
  return (await r.json()) as BridgeStats;
}

export async function getCycles(
  days = 7,
  limit = 50,
  minDurationSec = 60,
): Promise<BridgeCycle[]> {
  const r = await fetch(
    `${base}/api/bridges/brickell/cycles?days=${days}&limit=${limit}&minDurationSec=${minDurationSec}`,
  );
  if (!r.ok) throw new Error(`cycles ${r.status}`);
  const data = (await r.json()) as { cycles: BridgeCycle[] };
  return data.cycles;
}
