import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBrickellBridge } from "./fl511Client.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockResponses(bridgeRows: unknown[], eventRows: unknown[]) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const payload = u.includes("/Event")
      ? { draw: 1, recordsTotal: eventRows.length, recordsFiltered: eventRows.length, data: eventRows }
      : { draw: 1, recordsTotal: bridgeRows.length, recordsFiltered: bridgeRows.length, data: bridgeRows };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("fetchBrickellBridge", () => {
  it("parses Brickell row and FL511 alerts", async () => {
    mockResponses(
      [
        { DT_RowId: "1", name: "Some Other Bridge", status: "Bridge Down", roadway: "X", location: "X", county: "X", direction: "N", networkName: "X", lastUpdated: null, lastNotificationTime: null },
        { DT_RowId: "253", name: "Brickell Avenue Bridge", status: "Bridge Up", roadway: "US-1", location: "Brickell Avenue", county: "Miami-Dade", direction: "N", networkName: "District 6", lastUpdated: "4/21/26", lastNotificationTime: "1" },
      ],
      [
        {
          id: 614367,
          type: "Closures",
          description: "Bridge Up at Brickell Ave",
          lastUpdated: "4/21/26",
          roadwayName: "US-1",
          direction: "Northbound",
          cameras: [
            { latLng: { geography: { wellKnownText: "POINT (-80.190208 25.770124)" } } },
          ],
        },
      ],
    );

    const b = await fetchBrickellBridge();
    expect(b.name).toBe("Brickell Avenue Bridge");
    expect(b.status).toBe("UP");
    expect(b.metadata.roadway).toBe("US-1");
    expect(b.metadata.county).toBe("Miami-Dade");
    expect(b.metadata.waterway).toBe("Miami River");
    expect(b.metadata.lat).toBeCloseTo(25.770124, 5);
    expect(b.metadata.lon).toBeCloseTo(-80.190208, 5);
    expect(b.alerts).toHaveLength(1);
    expect(b.alerts[0].description).toContain("Bridge Up");
  });

  it("throws when Brickell is absent", async () => {
    mockResponses([{ DT_RowId: "1", name: "Other", status: "Bridge Down" }], []);
    await expect(fetchBrickellBridge()).rejects.toThrow(/Brickell/);
  });

  it("parses DOWN status", async () => {
    mockResponses(
      [{ DT_RowId: "253", name: "Brickell Avenue Bridge", status: "Bridge Down", roadway: null, location: null, county: null, direction: null, networkName: null, lastUpdated: null, lastNotificationTime: null }],
      [],
    );
    const b = await fetchBrickellBridge();
    expect(b.status).toBe("DOWN");
    expect(b.metadata.lat).toBeNull();
  });
});
