import type { BridgeEvent, BridgeState, BridgeStatus } from "./index.js";

export interface BridgeCycle {
  openedAt: string;
  closedAt: string | null;
  durationSec: number | null;
  gapBeforeSec: number | null;
  isOpen: boolean;
}

export interface Segment {
  start: string;
  end: string;
  status: BridgeStatus;
  durationSec: number;
}

function sortAsc(events: BridgeEvent[]): BridgeEvent[] {
  return [...events].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );
}

export function denoiseEvents(
  events: BridgeEvent[],
  minDurationSec: number,
): BridgeEvent[] {
  if (minDurationSec <= 0 || events.length < 3) return sortAsc(events);
  let arr = sortAsc(events);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < arr.length - 1; i++) {
      const cur = arr[i];
      const prev = arr[i - 1];
      const next = arr[i + 1];
      const dur = cur.durationOfPrevStateSec;
      if (
        dur != null &&
        dur < minDurationSec &&
        prev.from === next.from
      ) {
        const prevDur = prev.durationOfPrevStateSec;
        const nextDur = next.durationOfPrevStateSec;
        const merged: BridgeEvent =
          prevDur != null && nextDur != null
            ? { ...next, durationOfPrevStateSec: prevDur + dur + nextDur }
            : { ...next, durationOfPrevStateSec: null };
        arr = [...arr.slice(0, i - 1), merged, ...arr.slice(i + 2)];
        changed = true;
        break;
      }
    }
  }
  return arr;
}

export function eventsToSegments(events: BridgeEvent[]): Segment[] {
  const sorted = sortAsc(events);
  if (sorted.length === 0) return [];
  const segments: Segment[] = [];
  const e0 = sorted[0];
  const dur0 = e0.durationOfPrevStateSec ?? 0;
  const start0 = new Date(new Date(e0.ts).getTime() - dur0 * 1000).toISOString();
  segments.push({
    start: start0,
    end: e0.ts,
    status: e0.from,
    durationSec: dur0,
  });
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const dur =
      next.durationOfPrevStateSec ??
      Math.max(
        0,
        Math.round(
          (new Date(next.ts).getTime() - new Date(cur.ts).getTime()) / 1000,
        ),
      );
    segments.push({
      start: cur.ts,
      end: next.ts,
      status: cur.to,
      durationSec: dur,
    });
  }
  return segments;
}

export function eventsToCycles(
  events: BridgeEvent[],
  current: BridgeState | null,
): BridgeCycle[] {
  const sorted = sortAsc(events);
  const cycles: BridgeCycle[] = [];
  let openedAt: string | null = null;
  let prevClosedAt: string | null = null;
  for (const ev of sorted) {
    if (ev.from === "DOWN" && ev.to === "UP") {
      openedAt = ev.ts;
    } else if (ev.from === "UP" && ev.to === "DOWN" && openedAt != null) {
      cycles.push({
        openedAt,
        closedAt: ev.ts,
        durationSec: ev.durationOfPrevStateSec,
        gapBeforeSec:
          prevClosedAt != null
            ? Math.max(
                0,
                Math.round(
                  (new Date(openedAt).getTime() -
                    new Date(prevClosedAt).getTime()) /
                    1000,
                ),
              )
            : null,
        isOpen: false,
      });
      prevClosedAt = ev.ts;
      openedAt = null;
    }
  }
  if (current?.status === "UP" && openedAt != null) {
    cycles.push({
      openedAt,
      closedAt: null,
      durationSec: null,
      gapBeforeSec:
        prevClosedAt != null
          ? Math.max(
              0,
              Math.round(
                (new Date(openedAt).getTime() -
                  new Date(prevClosedAt).getTime()) /
                  1000,
              ),
            )
          : null,
      isOpen: true,
    });
  }
  return cycles;
}
