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
import { getHistory, getStats } from "./routes.js";
import { BRIDGE_ID } from "@bridge-tracker/shared";

beforeEach(() => {
  const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
  c._items.clear();
  c._s3.clear();
  process.env.CURRENT_TABLE = "t";
  process.env.HISTORY_BUCKET = "b";
});

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function key(d: Date) {
  return `events/brickell/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}.jsonl`;
}

describe("history + stats", () => {
  it("reads events from multiple days, newest first", async () => {
    const today = new Date();
    const yday = new Date(today); yday.setUTCDate(today.getUTCDate() - 1);
    const c = clients as unknown as { _s3: Map<string, string> };
    c._s3.set(key(today), JSON.stringify({ ts: today.toISOString(), from: "DOWN", to: "UP", durationOfPrevStateSec: 100 }) + "\n");
    c._s3.set(key(yday), JSON.stringify({ ts: yday.toISOString(), from: "UP", to: "DOWN", durationOfPrevStateSec: 600 }) + "\n");
    const h = await getHistory(3);
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
      metadata: {}, nearbyAlerts: [], rawSnapshotPointer: null,
    });
    c._s3.set(key(today),
      [
        JSON.stringify({ ts: today.toISOString(), from: "DOWN", to: "UP", durationOfPrevStateSec: 3600 }),
        JSON.stringify({ ts: today.toISOString(), from: "UP", to: "DOWN", durationOfPrevStateSec: 600 }),
        JSON.stringify({ ts: today.toISOString(), from: "DOWN", to: "UP", durationOfPrevStateSec: 1800 }),
        JSON.stringify({ ts: today.toISOString(), from: "UP", to: "DOWN", durationOfPrevStateSec: 900 }),
      ].join("\n") + "\n",
    );
    const s = await getStats(1);
    expect(s.opens).toBe(2);
    expect(s.avgOpenDurationSec).toBe(Math.round((600 + 900) / 2));
    expect(s.longestOpenDurationSec).toBe(900);
    expect(s.currentStatus).toBe("DOWN");
    expect(s.currentStatusSinceSec).toBeGreaterThanOrEqual(30);
  });
});
