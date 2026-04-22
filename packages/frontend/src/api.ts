import type { BridgeEvent, BridgeState, BridgeStats } from "@bridge-tracker/shared";

const base = "";

export async function getStatus(): Promise<BridgeState | null> {
  const r = await fetch(`${base}/api/bridges/brickell`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as BridgeState;
}

export async function getHistory(days = 7): Promise<BridgeEvent[]> {
  const r = await fetch(`${base}/api/bridges/brickell/history?days=${days}`);
  if (!r.ok) throw new Error(`history ${r.status}`);
  const data = (await r.json()) as { events: BridgeEvent[] };
  return data.events;
}

export async function getStats(days = 7): Promise<BridgeStats> {
  const r = await fetch(`${base}/api/bridges/brickell/stats?days=${days}`);
  if (!r.ok) throw new Error(`stats ${r.status}`);
  return (await r.json()) as BridgeStats;
}
