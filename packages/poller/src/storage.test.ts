import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./awsClients.js", () => {
  const items = new Map<string, unknown>();
  const s3Objects = new Map<string, string>();
  return {
    _items: items,
    _s3: s3Objects,
    ddb: {
      send: vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const name = cmd.constructor.name;
        if (name === "GetCommand") {
          const key = JSON.stringify(cmd.input.Key);
          return { Item: items.get(key) };
        }
        if (name === "PutCommand") {
          const item = cmd.input.Item as Record<string, unknown>;
          items.set(JSON.stringify({ pk: item.pk }), item);
          return {};
        }
        throw new Error(`Unknown DDB command: ${name}`);
      }),
    },
    s3: {
      send: vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const name = cmd.constructor.name;
        const key = cmd.input.Key as string;
        if (name === "GetObjectCommand") {
          const body = s3Objects.get(key);
          if (body === undefined) {
            const err = new Error("NoSuchKey");
            (err as { name: string }).name = "NoSuchKey";
            throw err;
          }
          return { Body: { transformToString: async () => body } };
        }
        if (name === "PutObjectCommand") {
          s3Objects.set(key, cmd.input.Body as string);
          return {};
        }
        throw new Error(`Unknown S3 command: ${name}`);
      }),
    },
  };
});

import { reconcile } from "./storage.js";
import * as clients from "./awsClients.js";
import type { FL511Bridge } from "@bridge-tracker/shared";

const baseMeta = {
  roadway: "US-1",
  location: "Brickell Avenue",
  direction: "N",
  county: "Miami-Dade",
  waterway: "Miami River",
  lat: 25.77,
  lon: -80.19,
};

function bridge(status: "UP" | "DOWN", observedAt: string): FL511Bridge {
  return {
    name: "Brickell Avenue Bridge",
    status,
    metadata: baseMeta,
    alerts: [],
    raw: { status },
    observedAt,
  };
}

beforeEach(() => {
  const c = clients as unknown as { _items: Map<string, unknown>; _s3: Map<string, string> };
  c._items.clear();
  c._s3.clear();
  process.env.CURRENT_TABLE = "t";
  process.env.HISTORY_BUCKET = "b";
});

describe("reconcile", () => {
  it("on first poll, sets statusChangedAt and writes no event", async () => {
    const r = await reconcile(bridge("DOWN", "2026-04-21T12:00:00.000Z"));
    expect(r.eventWritten).toBeNull();
    expect(r.state.status).toBe("DOWN");
    expect(r.state.statusChangedAt).toBe("2026-04-21T12:00:00.000Z");
  });

  it("writes an event when status changes and computes prev-state duration", async () => {
    await reconcile(bridge("DOWN", "2026-04-21T12:00:00.000Z"));
    const r = await reconcile(bridge("UP", "2026-04-21T12:10:00.000Z"));
    expect(r.eventWritten).toEqual({
      ts: "2026-04-21T12:10:00.000Z",
      from: "DOWN",
      to: "UP",
      durationOfPrevStateSec: 600,
    });
    expect(r.state.statusChangedAt).toBe("2026-04-21T12:10:00.000Z");
  });

  it("does not write an event when status is unchanged", async () => {
    await reconcile(bridge("DOWN", "2026-04-21T12:00:00.000Z"));
    const r = await reconcile(bridge("DOWN", "2026-04-21T12:01:00.000Z"));
    expect(r.eventWritten).toBeNull();
    expect(r.state.statusChangedAt).toBe("2026-04-21T12:00:00.000Z");
    expect(r.state.lastPolledAt).toBe("2026-04-21T12:01:00.000Z");
  });

  it("appends successive poll snapshots to the same hourly JSONL", async () => {
    const t1 = new Date("2026-04-21T12:00:00.000Z");
    const t2 = new Date("2026-04-21T12:30:00.000Z");
    await reconcile(bridge("DOWN", t1.toISOString()), t1);
    await reconcile(bridge("DOWN", t2.toISOString()), t2);
    const c = clients as unknown as { _s3: Map<string, string> };
    const key = "polls/brickell/2026/04/21/12.jsonl";
    const content = c._s3.get(key);
    expect(content).toBeDefined();
    expect(content!.trim().split("\n")).toHaveLength(2);
  });
});
