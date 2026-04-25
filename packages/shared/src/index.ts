export const BRIDGE_ID = "BRICKELL" as const;

export type BridgeStatus = "UP" | "DOWN" | "UNKNOWN";

export interface BridgeMetadata {
  roadway: string | null;
  location: string | null;
  direction: string | null;
  county: string | null;
  waterway: string | null;
  lat: number | null;
  lon: number | null;
}

export interface FL511Alert {
  id: string;
  type: string | null;
  description: string | null;
  location: string | null;
  updatedAt: string | null;
}

export interface FL511Bridge {
  name: string;
  status: BridgeStatus;
  metadata: BridgeMetadata;
  alerts: FL511Alert[];
  raw: unknown;
  observedAt: string;
}

export interface BridgeState {
  pk: typeof BRIDGE_ID;
  status: BridgeStatus;
  statusChangedAt: string;
  lastPolledAt: string;
  metadata: BridgeMetadata;
  nearbyAlerts: FL511Alert[];
  rawSnapshotPointer: string | null;
}

export interface BridgeEvent {
  ts: string;
  from: BridgeStatus;
  to: BridgeStatus;
  durationOfPrevStateSec: number | null;
}

export * from "./devices.js";
export * from "./analytics.js";
export * from "./aggregate.js";

export interface BridgeStatsBreakdown {
  avgGapBetweenOpensSec: number | null;
  medianGapBetweenOpensSec: number | null;
  longestGapBetweenOpensSec: number | null;
  pctTimeUp: number;
  opensToday: number;
  busiestHourLocal: number | null;
  quietestHourLocal: number | null;
  opensByHourLocal: number[];
  opensByDay: { date: string; opens: number }[];
  heatmap: number[][];
}

export interface BridgeStats {
  windowDays: number;
  opens: number;
  avgOpenDurationSec: number | null;
  longestOpenDurationSec: number | null;
  currentStatus: BridgeStatus;
  currentStatusSinceSec: number;
  isOpen: boolean;
  currentOpenDurationSec: number | null;
  predictedNextOpenAt: string | null;
  predictedNextCloseAt: string | null;
  tz: string;
  minDurationSec: number;
  breakdown: BridgeStatsBreakdown;
}
