import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./awsClients.js", () => {
  const items = new Map<string, unknown>();
  const s3Objects = new Map<string, string>();
  return {
    _items: items,
    _s3: s3Objects,
    ddb: {
      send: vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (cmd.constructor.name === "GetCommand") {
          return { Item: items.get(JSON.stringify(cmd.input.Key)) };
        }
        throw new Error("unexpected ddb command");
      }),
    },
    s3: {
      send: vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const key = cmd.input.Key as string;
        const body = s3Objects.get(key);
        if (body === undefined) {
          const err = new Error("NoSuchKey");
          (err as { name: string }).name = "NoSuchKey";
          throw err;
        }
        return { Body: { transformToString: async () => body } };
      }),
    },
  };
});

import * as clients from "./awsClients.js";
import { getCycles, getHistory, getStats } from "./routes.js";
import { BRIDGE_ID } from "@bridge-tracker/shared";

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function key(d: Date) {
  return `events/brickell/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}.jsonl`;
}

beforeEach(() => {
  const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
  c._items.clear();
  c._s3.clear();
  process.env.CURRENT_TABLE = "t";
  process.env.HISTORY_BUCKET = "b";
});

describe("history + stats", () => {
  it("reads events from multiple days, newest first", async () => {
    const today = new Date();
    const yday = new Date(today); yday.setUTCDate(today.getUTCDate() - 1);
    const c = clients as unknown as { _s3: Map<string, string> };
    c._s3.set(key(today), JSON.stringify({ ts: today.toISOString(), from: "DOWN", to: "UP", durationOfPrevStateSec: 100 }) + "\n");
    c._s3.set(key(yday), JSON.stringify({ ts: yday.toISOString(), from: "UP", to: "DOWN", durationOfPrevStateSec: 600 }) + "\n");
    const h = await getHistory(3, 0);
    expect(h).toHaveLength(2);
    expect(h[0].ts > h[1].ts).toBe(true);
  });

  it("computes opens count and average open duration", async () => {
    const today = new Date();
    const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
    c._items.set(JSON.stringify({ pk: BRIDGE_ID }), {
      pk: BRIDGE_ID, status: "DOWN",
      statusChangedAt: new Date(Date.now() - 30_000).toISOString(),
      lastPolledAt: today.toISOString(),
      metadata: {}, nearbyAlerts: [], rawSnapshotPointer: null, feedLastUpdatedAt: null,
    });
    c._s3.set(key(today),
      [
        JSON.stringify({ ts: today.toISOString(), from: "DOWN", to: "UP", durationOfPrevStateSec: 3600 }),
        JSON.stringify({ ts: today.toISOString(), from: "UP", to: "DOWN", durationOfPrevStateSec: 600 }),
        JSON.stringify({ ts: today.toISOString(), from: "DOWN", to: "UP", durationOfPrevStateSec: 1800 }),
        JSON.stringify({ ts: today.toISOString(), from: "UP", to: "DOWN", durationOfPrevStateSec: 900 }),
      ].join("\n") + "\n",
    );
    const s = await getStats(1, 0);
    expect(s.opens).toBe(2);
    expect(s.avgOpenDurationSec).toBe(Math.round((600 + 900) / 2));
    expect(s.longestOpenDurationSec).toBe(900);
    expect(s.currentStatus).toBe("DOWN");
    expect(s.currentStatusSinceSec).toBeGreaterThanOrEqual(30);
  });

  it("denoise drops a 30s flap pair from /stats", async () => {
    const today = new Date();
    const baseMs = today.getTime() - 60 * 60 * 1000; // 1h ago
    const t = (offset: number) => new Date(baseMs + offset * 1000).toISOString();
    const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
    c._items.set(JSON.stringify({ pk: BRIDGE_ID }), {
      pk: BRIDGE_ID, status: "DOWN",
      statusChangedAt: t(720),
      lastPolledAt: today.toISOString(),
      metadata: {}, nearbyAlerts: [], rawSnapshotPointer: null, feedLastUpdatedAt: null,
    });
    c._s3.set(key(today),
      [
        JSON.stringify({ ts: t(0), from: "DOWN", to: "UP", durationOfPrevStateSec: 600 }),
        JSON.stringify({ ts: t(30), from: "UP", to: "DOWN", durationOfPrevStateSec: 30 }),
        JSON.stringify({ ts: t(60), from: "DOWN", to: "UP", durationOfPrevStateSec: 30 }),
        JSON.stringify({ ts: t(720), from: "UP", to: "DOWN", durationOfPrevStateSec: 660 }),
      ].join("\n") + "\n",
    );

    const raw = await getStats(1, 0);
    expect(raw.opens).toBe(2);

    const denoised = await getStats(1, 60);
    expect(denoised.opens).toBe(1);
    expect(denoised.avgOpenDurationSec).toBe(660);
    expect(denoised.longestOpenDurationSec).toBe(660);
  });

  it("returns dangling open cycle when current is UP", async () => {
    const today = new Date();
    const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
    const openTs = new Date(today.getTime() - 5 * 60 * 1000).toISOString();
    c._items.set(JSON.stringify({ pk: BRIDGE_ID }), {
      pk: BRIDGE_ID, status: "UP",
      statusChangedAt: openTs,
      lastPolledAt: today.toISOString(),
      metadata: {}, nearbyAlerts: [], rawSnapshotPointer: null, feedLastUpdatedAt: null,
    });
    c._s3.set(key(today),
      JSON.stringify({ ts: openTs, from: "DOWN", to: "UP", durationOfPrevStateSec: 1800 }) + "\n",
    );
    const cycles = await getCycles(1, 50, 60);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].isOpen).toBe(true);
    expect(cycles[0].closedAt).toBeNull();
    expect(cycles[0].durationSec).toBeNull();
  });

  it("getStats reads precomputed aggregates for default window and patches in live state", async () => {
    const today = new Date();
    const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
    const openTs = new Date(today.getTime() - 10 * 60 * 1000).toISOString();
    c._items.set(JSON.stringify({ pk: BRIDGE_ID }), {
      pk: BRIDGE_ID,
      status: "UP",
      statusChangedAt: openTs,
      lastPolledAt: today.toISOString(),
      metadata: {},
      nearbyAlerts: [],
      rawSnapshotPointer: null,
      feedLastUpdatedAt: null,
    });
    // Place a precomputed file with a stale "isOpen=false" snapshot to confirm
    // the API does NOT trust the precomputed live fields — it patches them.
    const precomputed = {
      generatedAt: new Date(today.getTime() - 30_000).toISOString(),
      windowDays: 7,
      minDurationSec: 60,
      opens: 12,
      avgOpenDurationSec: 600,
      longestOpenDurationSec: 1200,
      breakdown: {
        avgGapBetweenOpensSec: 1800,
        medianGapBetweenOpensSec: 1500,
        longestGapBetweenOpensSec: 5400,
        pctTimeUp: 0.05,
        opensToday: 4,
        busiestHourLocal: 15,
        quietestHourLocal: 3,
        opensByHourLocal: new Array(24).fill(0),
        opensByDay: new Array(7).fill({ date: "2026-04-25", opens: 0 }),
        heatmap: new Array(7).fill(new Array(24).fill(0)),
      },
      cycles: [
        { openedAt: openTs, closedAt: null, durationSec: null, gapBeforeSec: null, isOpen: true },
      ],
    };
    c._s3.set("precomputed/brickell/aggregates.json", JSON.stringify(precomputed));

    const stats = await getStats(7, 60);
    // From precomputed:
    expect(stats.opens).toBe(12);
    expect(stats.avgOpenDurationSec).toBe(600);
    expect(stats.breakdown.medianGapBetweenOpensSec).toBe(1500);
    // Live-patched (NOT what was in precomputed):
    expect(stats.isOpen).toBe(true);
    expect(stats.currentStatus).toBe("UP");
    expect(stats.currentStatusSinceSec).toBeGreaterThanOrEqual(600 - 1);
    expect(stats.predictedNextOpenAt).toBeNull();
  });

  it("getStats falls back to live compute when precomputed is missing", async () => {
    const today = new Date();
    const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
    c._items.set(JSON.stringify({ pk: BRIDGE_ID }), {
      pk: BRIDGE_ID,
      status: "DOWN",
      statusChangedAt: today.toISOString(),
      lastPolledAt: today.toISOString(),
      metadata: {},
      nearbyAlerts: [],
      rawSnapshotPointer: null,
      feedLastUpdatedAt: null,
    });
    c._s3.set(
      key(today),
      [
        JSON.stringify({ ts: today.toISOString(), from: "DOWN", to: "UP", durationOfPrevStateSec: 1800 }),
        JSON.stringify({ ts: today.toISOString(), from: "UP", to: "DOWN", durationOfPrevStateSec: 600 }),
      ].join("\n") + "\n",
    );
    // No precomputed file — must fall back.
    const stats = await getStats(7, 60);
    expect(stats.opens).toBe(1);
    expect(stats.avgOpenDurationSec).toBe(600);
  });

  it("stats payload includes breakdown with hourly + daily aggregates", async () => {
    const today = new Date();
    const baseMs = today.getTime() - 30 * 60 * 1000;
    const t = (offset: number) => new Date(baseMs + offset * 1000).toISOString();
    const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
    c._items.set(JSON.stringify({ pk: BRIDGE_ID }), {
      pk: BRIDGE_ID, status: "DOWN",
      statusChangedAt: t(600),
      lastPolledAt: today.toISOString(),
      metadata: {}, nearbyAlerts: [], rawSnapshotPointer: null, feedLastUpdatedAt: null,
    });
    c._s3.set(key(today),
      [
        JSON.stringify({ ts: t(0), from: "DOWN", to: "UP", durationOfPrevStateSec: 1800 }),
        JSON.stringify({ ts: t(600), from: "UP", to: "DOWN", durationOfPrevStateSec: 600 }),
      ].join("\n") + "\n",
    );
    const stats = await getStats(7, 60);
    expect(stats.tz).toBe("America/New_York");
    expect(stats.minDurationSec).toBe(60);
    expect(stats.breakdown.opensByDay).toHaveLength(7);
    expect(stats.breakdown.heatmap).toHaveLength(7);
    expect(stats.breakdown.heatmap[0]).toHaveLength(24);
    expect(stats.breakdown.opensByHourLocal).toHaveLength(24);
    expect(stats.breakdown.opensByHourLocal.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
