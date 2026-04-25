import { fetchBrickellBridge } from "./fl511Client.js";
import { reconcile } from "./storage.js";
import { pushLiveActivityUpdates } from "./pushNotifier.js";
import { writePrecomputedAggregates } from "./precompute.js";

export interface PollerResult {
  status: string;
  statusChangedAt: string;
  eventWritten: boolean;
}

export async function runPoll(): Promise<PollerResult> {
  const bridge = await fetchBrickellBridge();
  const { state, eventWritten } = await reconcile(bridge);

  // Only push Live Activity updates on status changes to conserve APNs quota
  // (Apple throttles frequent Live Activity pushes). Skip on routine polls.
  if (eventWritten) {
    try {
      await pushLiveActivityUpdates(state, eventWritten);
    } catch (err) {
      console.error("Live Activity push error:", (err as Error).message);
    }
  }

  return {
    status: state.status,
    statusChangedAt: state.statusChangedAt,
    eventWritten: eventWritten !== null,
  };
}

// EventBridge's minimum schedule is 1 minute, so to get 2 polls/min we fire
// the Lambda every minute and do two runPoll() calls 30s apart inside a single
// invocation. Keeps the Lambda cheap (one cold start / one DynamoDB + S3
// client pool) but doubles FL511 freshness.
const POLLS_PER_INVOCATION = 2;
const POLL_SPACING_MS = 30_000;

export const handler = async (): Promise<PollerResult> => {
  let last: PollerResult | null = null;
  for (let i = 0; i < POLLS_PER_INVOCATION; i++) {
    const start = Date.now();
    try {
      last = await runPoll();
      console.log(JSON.stringify({ level: "info", msg: "poll complete", n: i + 1, ...last }));
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "poll failed", n: i + 1, err: (err as Error).message }));
    }
    if (i < POLLS_PER_INVOCATION - 1) {
      const remaining = POLL_SPACING_MS - (Date.now() - start);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    }
  }
  if (!last) throw new Error("all polls failed");

  // Refresh precomputed aggregates after the polls — best-effort. Failure
  // here must not fail the invocation; the API's live-fallback path covers
  // a stale or missing file.
  try {
    await writePrecomputedAggregates();
    console.log(JSON.stringify({ level: "info", msg: "precompute complete" }));
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "precompute failed", err: (err as Error).message }));
  }

  return last;
};
