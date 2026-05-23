import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBrickellBridge, parseFL511Timestamp } from "./fl511Client.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockBridgeRows(rows: unknown[]) {
  globalThis.fetch = vi.fn(async () => {
    const payload = { draw: 1, recordsTotal: rows.length, recordsFiltered: rows.length, data: rows };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("fetchBrickellBridge", () => {
  it("parses the Brickell row out of the list", async () => {
    mockBridgeRows([
      { DT_RowId: "1", name: "Some Other Bridge", status: "Bridge Down", roadway: "X", location: "X", county: "X", direction: "N", networkName: "X", lastUpdated: null, lastNotificationTime: null },
      { DT_RowId: "253", name: "Brickell Avenue Bridge", status: "Bridge Up", roadway: "US-1", location: "Brickell Avenue", county: "Miami-Dade", direction: "N", networkName: "District 6", lastUpdated: "5/21/26, 12:06 AM", lastNotificationTime: "1" },
    ]);

    const b = await fetchBrickellBridge();
    expect(b.name).toBe("Brickell Avenue Bridge");
    expect(b.status).toBe("UP");
    expect(b.metadata.roadway).toBe("US-1");
    expect(b.metadata.county).toBe("Miami-Dade");
    expect(b.metadata.waterway).toBe("Miami River");
    // Coordinates are hardcoded — FL511's list payload doesn't carry them.
    expect(b.metadata.lat).toBeCloseTo(25.770124, 5);
    expect(b.metadata.lon).toBeCloseTo(-80.190208, 5);
    expect(b.feedLastUpdatedAt).toBe("2026-05-21T04:06:00.000Z");
  });

  it("throws when Brickell is absent", async () => {
    mockBridgeRows([{ DT_RowId: "1", name: "Other", status: "Bridge Down" }]);
    await expect(fetchBrickellBridge()).rejects.toThrow(/Brickell/);
  });

  it("parses DOWN status with null lastUpdated", async () => {
    mockBridgeRows([
      { DT_RowId: "253", name: "Brickell Avenue Bridge", status: "Bridge Down", roadway: null, location: null, county: null, direction: null, networkName: null, lastUpdated: null, lastNotificationTime: null },
    ]);
    const b = await fetchBrickellBridge();
    expect(b.status).toBe("DOWN");
    expect(b.feedLastUpdatedAt).toBeNull();
  });
});

describe("parseFL511Timestamp", () => {
  it("parses M/D/YY, h:mm AM in ET → UTC", () => {
    // 12:06 AM ET on 5/21 — EDT is UTC-4 in May, so it's 04:06 UTC.
    expect(parseFL511Timestamp("5/21/26, 12:06 AM")).toBe("2026-05-21T04:06:00.000Z");
  });

  it("parses M/D/YY, h:mm PM in ET → UTC", () => {
    // 11:00 AM ET → 15:00 UTC (EDT).
    expect(parseFL511Timestamp("5/22/26, 11:00 AM")).toBe("2026-05-22T15:00:00.000Z");
    // 1:30 PM ET → 17:30 UTC (EDT).
    expect(parseFL511Timestamp("5/22/26, 1:30 PM")).toBe("2026-05-22T17:30:00.000Z");
  });

  it("handles 12 PM / 12 AM correctly", () => {
    expect(parseFL511Timestamp("5/22/26, 12:00 PM")).toBe("2026-05-22T16:00:00.000Z");
    expect(parseFL511Timestamp("5/22/26, 12:00 AM")).toBe("2026-05-22T04:00:00.000Z");
  });

  it("falls back to midnight when only a date is present", () => {
    expect(parseFL511Timestamp("4/21/26")).toBe("2026-04-21T04:00:00.000Z");
  });

  it("respects EST in winter (UTC-5)", () => {
    // January is EST (no DST). Noon ET → 17:00 UTC.
    expect(parseFL511Timestamp("1/15/26, 12:00 PM")).toBe("2026-01-15T17:00:00.000Z");
  });

  it("returns null for unparseable input", () => {
    expect(parseFL511Timestamp(null)).toBeNull();
    expect(parseFL511Timestamp("")).toBeNull();
    expect(parseFL511Timestamp("yesterday")).toBeNull();
    expect(parseFL511Timestamp("13/45/26")).toBeNull();
  });
});
