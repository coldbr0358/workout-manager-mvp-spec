'use client';

interface TrendChartProps {
  values: Array<number | null>;
  labels?: string[];
  color?: 'coral' | 'lime';
  ariaLabel: string;
}

export function TrendChart({ values, labels, color = 'coral', ariaLabel }: TrendChartProps) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length < 2) return <div className="chart-empty">비교할 측정이 아직 부족해요.</div>;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const spread = max - min || 1;
  const points = values.map((value, index) => value === null ? null : ({
    x: values.length === 1 ? 50 : 7 + (index * 86) / (values.length - 1),
    y: 80 - ((value - min) / spread) * 62,
  }));

  return (
    <div className={`trend-chart ${color}`} role="img" aria-label={ariaLabel}>
      <div className="chart-grid" />
      {points.map((point, index) => {
        if (!point) return null;
        const next = points[index + 1];
        const width = next ? Math.hypot(next.x - point.x, next.y - point.y) : 0;
        const angle = next ? Math.atan2(next.y - point.y, next.x - point.x) * (180 / Math.PI) : 0;
        return (
          <div key={`${point.x}-${point.y}`}>
            {next && <span className="chart-segment" style={{ left: `${point.x}%`, top: `${point.y}%`, width: `${width}%`, transform: `rotate(${angle}deg)` }} />}
            <span className="chart-dot" style={{ left: `${point.x}%`, top: `${point.y}%` }} />
          </div>
        );
      })}
      {labels && <div className="chart-axis"><span>{labels[0]}</span><span>{labels.at(-1)}</span></div>}
    </div>
  );
}
