import type { FL511Alert, FL511Bridge, BridgeStatus } from "@bridge-tracker/shared";

const BRIDGE_LIST_URL = "https://fl511.com/List/GetData/Bridge";

const BRICKELL_MATCHER = /brickell avenue bridge/i;

// Brickell Ave bridge over the Miami River — physical location never changes,
// so we hardcode it instead of paying a second FL511 request per poll to pull
// it out of the event endpoint's camera WKT.
const BRICKELL_LAT = 25.770124;
const BRICKELL_LON = -80.190208;

const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 bridge-tracker/0.1 (+https://github.com/bridge-tracker)",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
};

interface FL511BridgeRow {
  DT_RowId: string;
  name: string;
  location: string | null;
  roadway: string | null;
  county: string | null;
  direction: string | null;
  status: string;
  networkName: string | null;
  lastUpdated: string | null;
  lastNotificationTime: string | null;
}

interface DataTablesResponse<T> {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: T[];
}

function parseStatus(s: string | null | undefined): BridgeStatus {
  if (!s) return "UNKNOWN";
  const lower = s.toLowerCase();
  if (lower.includes("up")) return "UP";
  if (lower.includes("down")) return "DOWN";
  return "UNKNOWN";
}

async function postDataTables<T>(url: string, search: string): Promise<DataTablesResponse<T>> {
  const body = new URLSearchParams({
    draw: "1",
    start: "0",
    length: "100",
    "search[value]": search,
    "search[regex]": "false",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`FL511 ${url} returned HTTP ${res.status}`);
  }
  return (await res.json()) as DataTablesResponse<T>;
}

export async function fetchBrickellBridge(): Promise<FL511Bridge> {
  const observedAt = new Date().toISOString();
  const bridgeResp = await postDataTables<FL511BridgeRow>(BRIDGE_LIST_URL, "Brickell");

  const row = bridgeResp.data.find((b) => BRICKELL_MATCHER.test(b.name));
  if (!row) {
    throw new Error(
      `Brickell Avenue Bridge not found in FL511 response (got ${bridgeResp.data.length} matches)`,
    );
  }

  const alerts: FL511Alert[] = [];

  return {
    name: row.name,
    status: parseStatus(row.status),
    metadata: {
      roadway: row.roadway,
      location: row.location,
      direction: row.direction,
      county: row.county,
      waterway: "Miami River",
      lat: BRICKELL_LAT,
      lon: BRICKELL_LON,
    },
    alerts,
    raw: { bridge: row },
    observedAt,
  };
}
