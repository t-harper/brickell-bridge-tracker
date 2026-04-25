import type { BridgeStatsBreakdown } from "@bridge-tracker/shared";

function fmtHour(h: number): string {
  const ampm = h < 12 ? "a" : "p";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ampm}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

export function Heatmap({ breakdown }: { breakdown: BridgeStatsBreakdown }) {
  const { heatmap, opensByDay } = breakdown;
  if (heatmap.length === 0) return null;
  const max = Math.max(1, ...heatmap.flat());

  const cellW = 22;
  const cellH = 18;
  const labelW = 52;
  const labelH = 14;
  const width = labelW + 24 * cellW + 4;
  const height = labelH + heatmap.length * cellH;

  // newest at top: reverse the row order
  const rows = [...opensByDay].reverse();
  const matrix = [...heatmap].reverse();

  return (
    <div className="card">
      <h2>Openings heatmap (7 days × 24 hours, local)</h2>
      <div className="heatmap-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          className="heatmap-svg"
          role="img"
          aria-label="Heatmap of bridge openings by day and hour"
        >
          {Array.from({ length: 24 }).map((_, h) => (
            <text
              key={`h-${h}`}
              x={labelW + h * cellW + cellW / 2}
              y={labelH - 3}
              textAnchor="middle"
              className="heatmap-label"
            >
              {h % 3 === 0 ? fmtHour(h) : ""}
            </text>
          ))}
          {matrix.map((row, r) => (
            <g key={`r-${r}`}>
              <text
                x={labelW - 6}
                y={labelH + r * cellH + cellH / 2 + 4}
                textAnchor="end"
                className="heatmap-label"
              >
                {shortDate(rows[r].date)}
              </text>
              {row.map((count, h) => {
                const intensity = count === 0 ? 0 : 0.15 + 0.85 * (count / max);
                const fill =
                  count === 0
                    ? "var(--cell-empty)"
                    : `hsl(210, 80%, ${20 + 35 * intensity}%)`;
                return (
                  <rect
                    key={`c-${r}-${h}`}
                    x={labelW + h * cellW + 1}
                    y={labelH + r * cellH + 1}
                    width={cellW - 2}
                    height={cellH - 2}
                    fill={fill}
                    rx={2}
                  >
                    <title>
                      {rows[r].date} · {fmtHour(h)}: {count} open{count === 1 ? "" : "s"}
                    </title>
                  </rect>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
