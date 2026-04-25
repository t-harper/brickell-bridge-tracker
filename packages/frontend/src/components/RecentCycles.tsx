import { useEffect, useState } from "react";
import type { BridgeCycle } from "@bridge-tracker/shared";

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ElapsedSince({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  return <>{fmtDuration(sec)}</>;
}

export function RecentCycles({ cycles }: { cycles: BridgeCycle[] }) {
  if (cycles.length === 0) {
    return <div className="card">No openings recorded in this window.</div>;
  }
  return (
    <div className="card">
      <h2>Recent openings</h2>
      <ul className="cycles">
        {cycles.map((c, i) => (
          <li key={`${c.openedAt}-${i}`}>
            <span className="cycles-when">{fmtTime(c.openedAt)}</span>
            <span className={`pill ${c.isOpen ? "up" : "down"}`}>
              {c.isOpen ? "OPEN NOW" : "open"}
            </span>
            <span className="cycles-dur">
              {c.isOpen ? (
                <>
                  for <ElapsedSince iso={c.openedAt} />
                </>
              ) : (
                <>for {fmtDuration(c.durationSec)}</>
              )}
            </span>
            {c.gapBeforeSec != null && (
              <span className="cycles-gap">
                · {fmtDuration(c.gapBeforeSec)} since prev
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
