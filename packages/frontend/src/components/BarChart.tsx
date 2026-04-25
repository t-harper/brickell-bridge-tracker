interface BarDatum {
  label: string;
  value: number;
  tooltip?: string;
}

interface Props {
  title: string;
  data: BarDatum[];
  height?: number;
  ariaLabel: string;
}

export function BarChart({ title, data, height = 120, ariaLabel }: Props) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 600;
  const padBottom = 22;
  const totalH = height + padBottom;
  const barW = W / data.length;

  return (
    <div className="card">
      <h2>{title}</h2>
      <svg
        viewBox={`0 0 ${W} ${totalH}`}
        className="bar-svg"
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((d, i) => {
          const h = (d.value / max) * height;
          return (
            <rect
              key={`b-${i}`}
              x={i * barW + barW * 0.1}
              y={height - h}
              width={barW * 0.8}
              height={h}
              fill="var(--accent)"
              opacity={d.value === 0 ? 0.2 : 0.85}
            >
              <title>{d.tooltip ?? `${d.label}: ${d.value}`}</title>
            </rect>
          );
        })}
        {data.map((d, i) => {
          const stride = data.length <= 14 ? 1 : data.length <= 24 ? 3 : 5;
          if (i % stride !== 0) return null;
          return (
            <text
              key={`l-${i}`}
              x={i * barW + barW / 2}
              y={height + 14}
              textAnchor="middle"
              className="bar-label"
            >
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
