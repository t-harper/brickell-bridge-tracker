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

function bridge(
  status: "UP" | "DOWN",
  observedAt: string,
  feedLastUpdatedAt: string | null = observedAt,
): FL511Bridge {
  return {
    name: "Brickell Avenue Bridge",
    status,
    metadata: baseMeta,
    alerts: [],
    raw: { status },
    observedAt,
    feedLastUpdatedAt,
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

  it("appends successive snapshots only on status change (routine polls skip S3)", async () => {
    const t1 = new Date("2026-04-21T12:00:00.000Z");
    const t2 = new Date("2026-04-21T12:30:00.000Z");
    await reconcile(bridge("DOWN", t1.toISOString()), t1);
    await reconcile(bridge("DOWN", t2.toISOString()), t2);
    const c = clients as unknown as { _s3: Map<string, string> };
    // Only the first-poll snapshot — the second poll was status-unchanged.
    const key = "polls/brickell/2026/04/21/12.jsonl";
    const content = c._s3.get(key);
    expect(content).toBeDefined();
    expect(content!.trim().split("\n")).toHaveLength(1);
  });

  it("promotes status to UNKNOWN when FL511 feed is stale (>15min)", async () => {
    // Fresh first poll establishes DOWN.
    await reconcile(bridge("DOWN", "2026-05-21T04:00:00.000Z", "2026-05-21T04:00:00.000Z"));

    // 20 min later we poll again, but FL511's lastUpdated hasn't advanced —
    // its feed is frozen. We should NOT trust the "DOWN" reading; record
    // UNKNOWN instead.
    const r = await reconcile(
      bridge("DOWN", "2026-05-21T04:20:00.000Z", "2026-05-21T04:00:00.000Z"),
    );
    expect(r.state.status).toBe("UNKNOWN");
    expect(r.eventWritten).not.toBeNull();
    expect(r.eventWritten!.from).toBe("DOWN");
    expect(r.eventWritten!.to).toBe("UNKNOWN");
  });

  it("does not write a duplicate event while feed stays stale", async () => {
    await reconcile(bridge("DOWN", "2026-05-21T04:00:00.000Z", "2026-05-21T04:00:00.000Z"));
    await reconcile(
      bridge("DOWN", "2026-05-21T04:20:00.000Z", "2026-05-21T04:00:00.000Z"),
    );
    // Third poll, still stale — no new event.
    const r = await reconcile(
      bridge("DOWN", "2026-05-21T04:30:00.000Z", "2026-05-21T04:00:00.000Z"),
    );
    expect(r.state.status).toBe("UNKNOWN");
    expect(r.eventWritten).toBeNull();
  });

  it("recovers to the real status when the feed unfreezes", async () => {
    await reconcile(bridge("DOWN", "2026-05-21T04:00:00.000Z", "2026-05-21T04:00:00.000Z"));
    await reconcile(
      bridge("DOWN", "2026-05-21T04:20:00.000Z", "2026-05-21T04:00:00.000Z"),
    );
    // Feed catches up — UNKNOWN → UP transition.
    const r = await reconcile(
      bridge("UP", "2026-05-22T15:00:00.000Z", "2026-05-22T15:00:00.000Z"),
    );
    expect(r.state.status).toBe("UP");
    expect(r.eventWritten!.from).toBe("UNKNOWN");
    expect(r.eventWritten!.to).toBe("UP");
  });

  it("records FL511's feedLastUpdatedAt on the current state", async () => {
    const r = await reconcile(
      bridge("DOWN", "2026-05-21T04:01:00.000Z", "2026-05-21T04:00:30.000Z"),
    );
    expect(r.state.feedLastUpdatedAt).toBe("2026-05-21T04:00:30.000Z");
  });
});
