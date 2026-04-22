import { fetchBrickellBridge } from "./fl511Client.js";
import { reconcile } from "./storage.js";
import { pushLiveActivityUpdates } from "./pushNotifier.js";

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

export const handler = async (): Promise<PollerResult> => {
  const result = await runPoll();
  console.log(JSON.stringify({ level: "info", msg: "poll complete", ...result }));
  return result;
};
