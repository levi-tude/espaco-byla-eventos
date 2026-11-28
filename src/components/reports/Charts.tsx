import { formatMoney } from "@/lib/domain/service-fee";

export function StackedBar({
  segments,
}: {
  segments: { key: string; color: string; percent: number }[];
}) {
  return (
    <div className="flex h-3.5 overflow-hidden rounded-full bg-byla-border" role="img">
      {segments.map((segment) => (
        <div
          key={segment.key}
          style={{ width: `${Math.max(0, Math.min(segment.percent, 100))}%`, backgroundColor: segment.color }}
        />
      ))}
    </div>
  );
}

export function DonutChart({
  parts,
  center,
  caption,
}: {
  parts: { label: string; value: number; color: string }[];
  center: string;
  caption: string;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 42;
  const length = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg aria-hidden className="h-32 w-32 shrink-0" viewBox="0 0 120 120">
        <circle className="text-byla-border" cx="60" cy="60" fill="none" r={radius} stroke="currentColor" strokeWidth="14" />
        {total > 0
          ? parts.map((part) => {
              const slice = (part.value / total) * length;
              const circle = (
                <circle
                  cx="60"
                  cy="60"
                  fill="none"
                  key={part.label}
                  r={radius}
                  stroke={part.color}
                  strokeDasharray={`${slice} ${length - slice}`}
                  strokeDashoffset={-offset}
                  strokeWidth="14"
                  transform="rotate(-90 60 60)"
                />
              );
              offset += slice;
              return circle;
            })
          : null}
        <text fill="currentColor" fontSize="18" fontWeight="700" textAnchor="middle" x="60" y="58">
          {center}
        </text>
        <text className="fill-byla-muted" fontSize="9" textAnchor="middle" x="60" y="74">
          {caption}
        </text>
      </svg>
      <ul className="grid min-w-0 gap-1.5 text-sm">
        {parts.map((part) => (
          <li className="flex items-center justify-between gap-3" key={part.label}>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: part.color }} />
              <span className="truncate">{part.label}</span>
            </span>
            <span className="tabular-nums text-byla-muted">{part.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras do dia e, quando o valor é dinheiro, a linha do acumulado. */
export function DailyChart({
  rows,
  money,
}: {
  rows: { label: string; value: number }[];
  money: boolean;
}) {
  if (!rows.length) {
    return <p className="text-sm text-byla-muted">Ainda não há vendas pagas neste recorte.</p>;
  }
  const width = 640;
  const height = 180;
  const pad = 16;
  const max = Math.max(...rows.map((row) => row.value), 1);
  const slot = (width - pad * 2) / rows.length;
  const cumulative = rows.reduce<number[]>(
    (totals, row) => [...totals, (totals.at(-1) ?? 0) + row.value],
    [],
  );
  const peak = Math.max(...cumulative, 1);
  const points = cumulative
    .map((value, index) => {
      const x = pad + slot * index + slot / 2;
      const y = height - pad - (value / peak) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg aria-label="Vendas ao longo do tempo" className="h-auto w-full" role="img" viewBox={`0 0 ${width} ${height}`}>
      {rows.map((row, index) => {
        const barHeight = (row.value / max) * (height - pad * 2);
        const x = pad + slot * index + slot * 0.2;
        return (
          <g key={row.label}>
            <rect
              fill="#4080FC"
              height={barHeight}
              rx="3"
              width={Math.max(slot * 0.6, 2)}
              x={x}
              y={height - pad - barHeight}
            >
              <title>{`${row.label}: ${money ? formatMoney(row.value) : row.value}`}</title>
            </rect>
            <text fill="currentColor" fontSize="11" opacity="0.7" textAnchor="middle" x={pad + slot * index + slot / 2} y={height - 2}>
              {row.label}
            </text>
          </g>
        );
      })}
      {money ? <polyline fill="none" points={points} stroke="#FFBD38" strokeWidth="2.5" /> : null}
    </svg>
  );
}

export function ArrivalChart({ buckets }: { buckets: { label: string; count: number }[] }) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return (
    <div className="flex h-36 items-end gap-2">
      {buckets.map((bucket) => (
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1" key={bucket.label}>
          <span className="text-xs tabular-nums text-byla-muted">{bucket.count}</span>
          <div
            className="w-full rounded-t bg-byla-blue"
            style={{ height: `${Math.max(8, (bucket.count / max) * 96)}px` }}
          />
          <span className="text-[11px] text-byla-muted">{bucket.label}</span>
        </div>
      ))}
    </div>
  );
}
