import { describe, expect, it } from "vitest";
import {
  denoiseEvents,
  eventsToCycles,
  eventsToSegments,
} from "./analytics.js";
import type { BridgeEvent, BridgeState } from "./index.js";

const ev = (
  ts: string,
  from: BridgeEvent["from"],
  to: BridgeEvent["to"],
  durationOfPrevStateSec: number | null,
): BridgeEvent => ({ ts, from, to, durationOfPrevStateSec });

const state = (
  status: BridgeState["status"],
  statusChangedAt: string,
): BridgeState => ({
  pk: "BRICKELL",
  status,
  statusChangedAt,
  lastPolledAt: statusChangedAt,
  feedLastUpdatedAt: statusChangedAt,
  metadata: {
    roadway: null,
    location: null,
    direction: null,
    county: null,
    waterway: null,
    lat: null,
    lon: null,
  },
  nearbyAlerts: [],
  rawSnapshotPointer: null,
});

describe("denoiseEvents", () => {
  it("returns input untouched when threshold is 0", () => {
    const events = [
      ev("2026-04-01T00:00:00.000Z", "DOWN", "UP", 600),
      ev("2026-04-01T00:00:30.000Z", "UP", "DOWN", 30),
      ev("2026-04-01T00:01:00.000Z", "DOWN", "UP", 30),
      ev("2026-04-01T00:11:00.000Z", "UP", "DOWN", 600),
    ];
    expect(denoiseEvents(events, 0)).toEqual(events);
  });

  it("collapses an interior 30s flap pair", () => {
    const events = [
      ev("2026-04-01T00:00:00.000Z", "DOWN", "UP", 600),
      ev("2026-04-01T00:00:30.000Z", "UP", "DOWN", 30),
      ev("2026-04-01T00:01:00.000Z", "DOWN", "UP", 30),
      ev("2026-04-01T00:11:00.000Z", "UP", "DOWN", 600),
    ];
    const out = denoiseEvents(events, 60);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      ts: "2026-04-01T00:01:00.000Z",
      from: "DOWN",
      to: "UP",
      durationOfPrevStateSec: 660,
    });
    expect(out[1]).toEqual({
      ts: "2026-04-01T00:11:00.000Z",
      from: "UP",
      to: "DOWN",
      durationOfPrevStateSec: 600,
    });
  });

  it("does not collapse a trailing short segment with no successor", () => {
    const events = [
      ev("2026-04-01T00:00:00.000Z", "DOWN", "UP", 600),
      ev("2026-04-01T00:10:00.000Z", "UP", "DOWN", 600),
      ev("2026-04-01T00:10:30.000Z", "DOWN", "UP", 30),
    ];
    const out = denoiseEvents(events, 60);
    expect(out).toHaveLength(3);
    expect(out[2].durationOfPrevStateSec).toBe(30);
  });

  it("cascades — collapses multiple flaps in sequence", () => {
    const events = [
      ev("2026-04-01T00:00:00.000Z", "DOWN", "UP", 600),
      ev("2026-04-01T00:00:30.000Z", "UP", "DOWN", 30),
      ev("2026-04-01T00:01:00.000Z", "DOWN", "UP", 30),
      ev("2026-04-01T00:01:30.000Z", "UP", "DOWN", 30),
      ev("2026-04-01T00:02:00.000Z", "DOWN", "UP", 30),
      ev("2026-04-01T00:12:00.000Z", "UP", "DOWN", 600),
    ];
    const out = denoiseEvents(events, 60);
    expect(out).toHaveLength(2);
    expect(out[0].durationOfPrevStateSec).toBe(720);
    expect(out[1].durationOfPrevStateSec).toBe(600);
  });
});

describe("eventsToCycles", () => {
  it("derives DOWN→UP→DOWN as a closed cycle", () => {
    const events = [
      ev("2026-04-01T12:00:00.000Z", "DOWN", "UP", 1000),
      ev("2026-04-01T12:10:00.000Z", "UP", "DOWN", 600),
      ev("2026-04-01T13:00:00.000Z", "DOWN", "UP", 3000),
      ev("2026-04-01T13:08:00.000Z", "UP", "DOWN", 480),
    ];
    const cycles = eventsToCycles(events, state("DOWN", "2026-04-01T13:08:00.000Z"));
    expect(cycles).toHaveLength(2);
    expect(cycles[0]).toEqual({
      openedAt: "2026-04-01T12:00:00.000Z",
      closedAt: "2026-04-01T12:10:00.000Z",
      durationSec: 600,
      gapBeforeSec: null,
      isOpen: false,
    });
    expect(cycles[1]).toEqual({
      openedAt: "2026-04-01T13:00:00.000Z",
      closedAt: "2026-04-01T13:08:00.000Z",
      durationSec: 480,
      gapBeforeSec: 3000,
      isOpen: false,
    });
  });

  it("appends a dangling open cycle when current status is UP", () => {
    const events = [
      ev("2026-04-01T12:00:00.000Z", "DOWN", "UP", 1000),
      ev("2026-04-01T12:10:00.000Z", "UP", "DOWN", 600),
      ev("2026-04-01T13:00:00.000Z", "DOWN", "UP", 3000),
    ];
    const cycles = eventsToCycles(events, state("UP", "2026-04-01T13:00:00.000Z"));
    expect(cycles).toHaveLength(2);
    expect(cycles[1]).toEqual({
      openedAt: "2026-04-01T13:00:00.000Z",
      closedAt: null,
      durationSec: null,
      gapBeforeSec: 3000,
      isOpen: true,
    });
  });

  it("filters UNKNOWN — neither opens nor closes a cycle", () => {
    const events = [
      ev("2026-04-01T12:00:00.000Z", "UNKNOWN", "UP", null),
      ev("2026-04-01T12:10:00.000Z", "UP", "DOWN", 600),
      ev("2026-04-01T13:00:00.000Z", "DOWN", "UP", 3000),
      ev("2026-04-01T13:08:00.000Z", "UP", "DOWN", 480),
    ];
    const cycles = eventsToCycles(events, state("DOWN", "2026-04-01T13:08:00.000Z"));
    expect(cycles).toHaveLength(1);
    expect(cycles[0].openedAt).toBe("2026-04-01T13:00:00.000Z");
  });
});

describe("eventsToSegments", () => {
  it("produces segments alternating UP/DOWN with correct durations", () => {
    const events = [
      ev("2026-04-01T12:00:00.000Z", "DOWN", "UP", 600),
      ev("2026-04-01T12:10:00.000Z", "UP", "DOWN", 600),
      ev("2026-04-01T12:30:00.000Z", "DOWN", "UP", 1200),
    ];
    const segs = eventsToSegments(events);
    expect(segs).toHaveLength(3);
    expect(segs[0].status).toBe("DOWN");
    expect(segs[0].durationSec).toBe(600);
    expect(segs[1].status).toBe("UP");
    expect(segs[1].durationSec).toBe(600);
    expect(segs[2].status).toBe("DOWN");
    expect(segs[2].durationSec).toBe(1200);
  });
});
