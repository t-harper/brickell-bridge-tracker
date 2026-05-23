import type {
  BridgeCycle,
  BridgeEvent,
  BridgeState,
  BridgeStats,
  BridgeStatsBreakdown,
  RushHourCompliance,
} from "./index.js";
import { eventsToCycles } from "./analytics.js";

// 33 CFR 117.261(t): Brickell Avenue Bridge need not open Mon-Fri during
// these windows (federal holidays excepted; we don't model holidays since
// our default 7-day window only spans 5 weekdays at most).
const RUSH_WINDOWS_LOCAL: ReadonlyArray<{ startH: number; startM: number; endH: number; endM: number }> = [
  { startH: 7, startM: 35, endH: 8, endM: 59 },
  { startH: 16, startM: 35, endH: 17, endM: 59 },
];

function dayOfWeekIdx(dateStr: string, tz: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(anchor);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// Convert "this local date at HH:MM in tz" to absolute UTC ms. Handles DST
// since the offset is computed for the specific calendar date.
export function localTimeToUtcMs(dateStr: string, hour: number, minute: number, tz: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const naiveUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(naiveUtcMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const asLocalUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = asLocalUtcMs - naiveUtcMs;
  return naiveUtcMs - offset;
}

function computeRushHourCompliance(
  cycles: BridgeCycle[],
  dates: string[],
  tz: string,
  windowStartMs: number,
  windowEndMs: number,
): RushHourCompliance | null {
  const completeWindows: { startMs: number; endMs: number }[] = [];
  for (const dateStr of dates) {
    const dow = dayOfWeekIdx(dateStr, tz);
    if (dow < 1 || dow > 5) continue; // skip weekends
    for (const w of RUSH_WINDOWS_LOCAL) {
      const startMs = localTimeToUtcMs(dateStr, w.startH, w.startM, tz);
      const endMs = localTimeToUtcMs(dateStr, w.endH, w.endM, tz);
      if (startMs >= windowStartMs && endMs <= windowEndMs) {
        completeWindows.push({ startMs, endMs });
      }
    }
  }
  if (completeWindows.length === 0) return null;

  let compliantWindows = 0;
  let nonCompliantOpens = 0;
  for (const w of completeWindows) {
    let opensIn = 0;
    for (const c of cycles) {
      const t = new Date(c.openedAt).getTime();
      if (t >= w.startMs && t <= w.endMs) opensIn++;
    }
    nonCompliantOpens += opensIn;
    if (opensIn === 0) compliantWindows++;
  }
  return {
    compliantWindows,
    totalRushWindows: completeWindows.length,
    pct: compliantWindows / completeWindows.length,
    nonCompliantOpens,
  };
}

export interface PrecomputedAggregates {
  generatedAt: string;
  windowDays: number;
  minDurationSec: number;
  opens: number;
  avgOpenDurationSec: number | null;
  longestOpenDurationSec: number | null;
  breakdown: BridgeStatsBreakdown;
  cycles: BridgeCycle[];
}

interface LocalParts {
  dateStr: string;
  hour: number;
}

function localParts(iso: string, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    hour: parseInt(get("hour"), 10) || 0,
  };
}

function localDateStr(d: Date, tz: string): string {
  return localParts(d.toISOString(), tz).dateStr;
}

function windowDates(now: Date, windowDays: number, tz: string): string[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  let t = now.getTime();
  const stop = t - (windowDays + 2) * 24 * 3600 * 1000;
  while (dates.length < windowDays && t > stop) {
    const ds = localDateStr(new Date(t), tz);
    if (!seen.has(ds)) {
      seen.add(ds);
      dates.unshift(ds);
    }
    t -= 3600 * 1000;
  }
  return dates;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function buildBreakdown(
  cycles: BridgeCycle[],
  windowDays: number,
  tz: string,
  now: Date,
): BridgeStatsBreakdown {
  const dates = windowDates(now, windowDays, tz);
  const dateToIdx = new Map<string, number>();
  dates.forEach((d, i) => dateToIdx.set(d, i));

  const heatmap: number[][] = dates.map(() => new Array<number>(24).fill(0));
  for (const c of cycles) {
    const { dateStr, hour } = localParts(c.openedAt, tz);
    const row = dateToIdx.get(dateStr);
    if (row !== undefined) heatmap[row][hour]++;
  }

  const opensByHourLocal = new Array<number>(24).fill(0);
  for (let h = 0; h < 24; h++) {
    for (let r = 0; r < heatmap.length; r++) {
      opensByHourLocal[h] += heatmap[r][h];
    }
  }
  const opensByDay = dates.map((date, i) => ({
    date,
    opens: heatmap[i].reduce((s, n) => s + n, 0),
  }));

  const totalOpens = opensByHourLocal.reduce((s, n) => s + n, 0);
  let busiestHourLocal: number | null = null;
  let quietestHourLocal: number | null = null;
  if (totalOpens > 0) {
    let busy = -1;
    let quiet = Number.POSITIVE_INFINITY;
    for (let h = 0; h < 24; h++) {
      if (opensByHourLocal[h] > busy) {
        busy = opensByHourLocal[h];
        busiestHourLocal = h;
      }
      if (opensByHourLocal[h] < quiet) {
        quiet = opensByHourLocal[h];
        quietestHourLocal = h;
      }
    }
  }

  const todayStr = localDateStr(now, tz);
  const opensToday = opensByDay.find((d) => d.date === todayStr)?.opens ?? 0;

  const gaps = cycles
    .map((c) => c.gapBeforeSec)
    .filter((g): g is number => g != null);
  const avgGap = gaps.length
    ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    : null;
  const longestGap = gaps.length ? Math.max(...gaps) : null;
  const medianGap = median(gaps);

  const windowSec = windowDays * 86400;
  const windowStartMs = now.getTime() - windowSec * 1000;
  const upDurationSec = cycles.reduce((sum, c) => {
    const openedMs = Math.max(
      new Date(c.openedAt).getTime(),
      windowStartMs,
    );
    const closedMs = c.isOpen
      ? now.getTime()
      : c.closedAt != null
        ? new Date(c.closedAt).getTime()
        : openedMs;
    return sum + Math.max(0, Math.round((closedMs - openedMs) / 1000));
  }, 0);
  const pctTimeUp = Math.min(1, Math.max(0, upDurationSec / windowSec));

  const rushHourCompliance = computeRushHourCompliance(
    cycles,
    dates,
    tz,
    windowStartMs,
    now.getTime(),
  );

  return {
    avgGapBetweenOpensSec: avgGap,
    medianGapBetweenOpensSec: medianGap,
    longestGapBetweenOpensSec: longestGap,
    pctTimeUp,
    opensToday,
    busiestHourLocal,
    quietestHourLocal,
    opensByHourLocal,
    opensByDay,
    heatmap,
    rushHourCompliance,
  };
}

function liveStateFields(
  current: BridgeState | null,
  medianGapSec: number | null,
  avgOpenDurationSec: number | null,
  now: Date,
): {
  currentStatus: BridgeStats["currentStatus"];
  currentStatusSinceSec: number;
  isOpen: boolean;
  currentOpenDurationSec: number | null;
  predictedNextOpenAt: string | null;
  predictedNextCloseAt: string | null;
} {
  const isOpen = current?.status === "UP";
  const currentStatusSinceSec = current
    ? Math.max(
        0,
        Math.round(
          (now.getTime() - new Date(current.statusChangedAt).getTime()) / 1000,
        ),
      )
    : 0;
  const currentOpenDurationSec = isOpen ? currentStatusSinceSec : null;

  let predictedNextOpenAt: string | null = null;
  if (!isOpen && medianGapSec != null && current?.statusChangedAt) {
    const lastClosedMs = new Date(current.statusChangedAt).getTime();
    predictedNextOpenAt = new Date(
      lastClosedMs + medianGapSec * 1000,
    ).toISOString();
  }

  let predictedNextCloseAt: string | null = null;
  if (isOpen && avgOpenDurationSec != null && current?.statusChangedAt) {
    const openedMs = new Date(current.statusChangedAt).getTime();
    predictedNextCloseAt = new Date(
      openedMs + avgOpenDurationSec * 1000,
    ).toISOString();
  }
  return {
    currentStatus: current?.status ?? "UNKNOWN",
    currentStatusSinceSec,
    isOpen,
    currentOpenDurationSec,
    predictedNextOpenAt,
    predictedNextCloseAt,
  };
}

interface BuildStatsArgs {
  current: BridgeState | null;
  events: BridgeEvent[];
  windowDays: number;
  minDurationSec: number;
  tz: string;
  now: Date;
}

export function buildStats(args: BuildStatsArgs): BridgeStats {
  const { current, events, windowDays, minDurationSec, tz, now } = args;
  const cycles = eventsToCycles(events, current);
  const closedDurations = cycles
    .filter((c) => !c.isOpen && c.durationSec != null)
    .map((c) => c.durationSec as number);
  const opens = cycles.length;
  const avgOpenDurationSec = closedDurations.length
    ? Math.round(
        closedDurations.reduce((a, b) => a + b, 0) / closedDurations.length,
      )
    : null;
  const longestOpenDurationSec = closedDurations.length
    ? Math.max(...closedDurations)
    : null;

  const breakdown = buildBreakdown(cycles, windowDays, tz, now);
  const live = liveStateFields(
    current,
    breakdown.medianGapBetweenOpensSec,
    avgOpenDurationSec,
    now,
  );

  return {
    windowDays,
    opens,
    avgOpenDurationSec,
    longestOpenDurationSec,
    ...live,
    tz,
    minDurationSec,
    breakdown,
  };
}

interface BuildPrecomputedArgs {
  events: BridgeEvent[];
  current: BridgeState | null;
  windowDays: number;
  minDurationSec: number;
  tz: string;
  now: Date;
}

export function buildPrecomputedAggregates(
  args: BuildPrecomputedArgs,
): PrecomputedAggregates {
  const { events, current, windowDays, minDurationSec, tz, now } = args;
  const cyclesAsc = eventsToCycles(events, current);
  const closedDurations = cyclesAsc
    .filter((c) => !c.isOpen && c.durationSec != null)
    .map((c) => c.durationSec as number);
  const breakdown = buildBreakdown(cyclesAsc, windowDays, tz, now);
  return {
    generatedAt: now.toISOString(),
    windowDays,
    minDurationSec,
    opens: cyclesAsc.length,
    avgOpenDurationSec: closedDurations.length
      ? Math.round(
          closedDurations.reduce((a, b) => a + b, 0) / closedDurations.length,
        )
      : null,
    longestOpenDurationSec: closedDurations.length
      ? Math.max(...closedDurations)
      : null,
    breakdown,
    cycles: cyclesAsc.slice().reverse(),
  };
}

export function statsFromPrecomputed(args: {
  pre: PrecomputedAggregates;
  current: BridgeState | null;
  tz: string;
  now: Date;
}): BridgeStats {
  const { pre, current, tz, now } = args;
  const live = liveStateFields(
    current,
    pre.breakdown.medianGapBetweenOpensSec,
    pre.avgOpenDurationSec,
    now,
  );
  return {
    windowDays: pre.windowDays,
    opens: pre.opens,
    avgOpenDurationSec: pre.avgOpenDurationSec,
    longestOpenDurationSec: pre.longestOpenDurationSec,
    ...live,
    tz,
    minDurationSec: pre.minDurationSec,
    breakdown: pre.breakdown,
  };
}
