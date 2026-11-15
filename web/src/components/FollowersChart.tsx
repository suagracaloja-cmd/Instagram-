import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { niceTicks, type Series } from '../lib/derive.ts';
import { fmtCompact, fmtDay, fmtGrowth, fmtInt, fmtPct, fmtSigned } from '../lib/format';
import type { Metric } from '../types';

interface Props {
  series: Series[];
  colors: Record<string, string>;
  metric: Metric;
}

const MAX_MARKED_POINTS = 14; // acima disso só o último ponto e o ponto ativo ganham marcador

export function FollowersChart({ series, colors, metric }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmtValue = (v: number) => (metric === 'followers' ? fmtInt(v) : metric === 'growth' ? fmtGrowth(v, 2) : fmtPct(v, 2));

  const allDates = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort(),
    [series],
  );
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  const ticks = useMemo(
    () => (values.length ? niceTicks(Math.min(...values), Math.max(...values), 4) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series],
  );

  const tickDigits = ticks.length > 1 && Math.abs(ticks[1] - ticks[0]) * 100 < 0.1 ? 2 : 1;
  const fmtTick = (v: number) =>
    metric === 'followers'
      ? Math.abs(v) >= 10000
        ? fmtCompact(v)
        : fmtInt(v)
      : metric === 'growth'
        ? fmtGrowth(v, tickDigits)
        : fmtPct(v, tickDigits);

  // Se o período muda e o ponto ativo some, limpa o tooltip.
  useEffect(() => {
    if (active && !allDates.includes(active)) setActive(null);
  }, [allDates, active]);

  if (allDates.length === 0) {
    return (
      <div className="chart-empty" role="status">
        <strong>Sem dados neste período.</strong>
        <span>
          {metric === 'engagement'
            ? 'O engajamento só aparece quando há posts com curtidas visíveis.'
            : 'O histórico começa na primeira coleta e ganha um ponto por dia.'}
        </span>
      </div>
    );
  }

  const height = width < 480 ? 230 : 290;
  const m = { top: 14, right: 16, bottom: 28, left: metric === 'followers' ? 46 : 58 };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const t0 = Date.parse(`${allDates[0]}T00:00:00Z`);
  const t1 = Date.parse(`${allDates[allDates.length - 1]}T00:00:00Z`);
  const xOf = (date: string) =>
    allDates.length === 1 ? m.left + plotW / 2 : m.left + ((Date.parse(`${date}T00:00:00Z`) - t0) / (t1 - t0)) * plotW;
  const yOf = (v: number) => m.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const maxXTicks = Math.max(2, Math.floor(plotW / 78));
  const xTickDates = allDates.length <= maxXTicks
    ? allDates
    : Array.from({ length: maxXTicks }, (_, i) => allDates[Math.round((i * (allDates.length - 1)) / (maxXTicks - 1))]);

  const nearestDate = (clientX: number, rect: DOMRect): string => {
    const x = clientX - rect.left;
    let best = allDates[0];
    let bestDist = Infinity;
    for (const d of allDates) {
      const dist = Math.abs(xOf(d) - x);
      if (dist < bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    return best;
  };

  const onPointer = (e: React.PointerEvent<SVGRectElement>) =>
    setActive(nearestDate(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()));

  const onKey = (e: React.KeyboardEvent) => {
    const i = active ? allDates.indexOf(active) : -1;
    if (e.key === 'ArrowRight') setActive(allDates[Math.min(allDates.length - 1, i + 1)]);
    else if (e.key === 'ArrowLeft') setActive(allDates[Math.max(0, i < 0 ? allDates.length - 1 : i - 1)]);
    else if (e.key === 'Home') setActive(allDates[0]);
    else if (e.key === 'End') setActive(allDates[allDates.length - 1]);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const single = series.filter((s) => s.points.length > 0).length === 1;
  const onlyOneDay = allDates.length === 1;
  const activeX = active ? xOf(active) : null;
  const activeRows = active
    ? series
        .map((s) => {
          const idx = s.points.findIndex((p) => p.date === active);
          if (idx < 0) return null;
          const prev = idx > 0 ? s.points[idx - 1] : null;
          return { handle: s.handle, value: s.points[idx].value, raw: s.points[idx].raw, prev };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    : [];
  const tipLeft = activeX == null ? 0 : Math.min(Math.max(activeX, 96), width - 96);

  return (
    <div className="chart">
      <div className="chart-plot" ref={wrapRef} role="group" aria-label="Gráfico de evolução. Use as setas para percorrer as datas." tabIndex={0} onKeyDown={onKey}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={m.left} x2={width - m.right} y1={yOf(t)} y2={yOf(t)} />
              <text className="axis-label" x={m.left - 8} y={yOf(t)} textAnchor="end" dominantBaseline="middle">
                {fmtTick(t)}
              </text>
            </g>
          ))}
          {xTickDates.map((d) => (
            <text key={d} className="axis-label" x={xOf(d)} y={height - 8} textAnchor={allDates.length === 1 ? 'middle' : d === allDates[0] ? 'start' : d === allDates[allDates.length - 1] ? 'end' : 'middle'}>
              {fmtDay(d)}
            </text>
          ))}

          {series.map((s) => {
            if (s.points.length === 0) return null;
            const color = colors[s.handle];
            const line = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
            const first = s.points[0];
            const last = s.points[s.points.length - 1];
            const marked = s.points.length <= MAX_MARKED_POINTS;
            return (
              <g key={s.handle} style={{ color }}>
                {single && s.points.length > 1 && (
                  <path
                    d={`${line} L${xOf(last.date).toFixed(1)},${(m.top + plotH).toFixed(1)} L${xOf(first.date).toFixed(1)},${(m.top + plotH).toFixed(1)} Z`}
                    fill="currentColor"
                    opacity="0.1"
                  />
                )}
                {s.points.length > 1 && <path className="line" d={line} stroke="currentColor" />}
                {s.points.map((p, i) =>
                  marked || i === s.points.length - 1 ? (
                    <circle key={p.date} className="dot" cx={xOf(p.date)} cy={yOf(p.value)} r={4} fill="currentColor" />
                  ) : null,
                )}
              </g>
            );
          })}

          {activeX != null && (
            <g pointerEvents="none">
              <line className="guide" x1={activeX} x2={activeX} y1={m.top} y2={m.top + plotH} />
              {activeRows.map((r) => (
                <circle key={r.handle} className="dot dot-active" cx={activeX} cy={yOf(r.value)} r={5} fill={colors[r.handle]} />
              ))}
            </g>
          )}

          {/* Área de toque maior que a marca: o ponteiro só precisa estar PERTO da data. */}
          <rect
            className="hit"
            x={m.left}
            y={m.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerDown={onPointer}
            onPointerMove={onPointer}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          />
        </svg>

        {active && activeX != null && (
          <div className="tooltip" role="status" style={{ left: tipLeft }}>
            <div className="tooltip-date">{fmtDay(active, true)}</div>
            {activeRows.map((r) => (
              <div className="tooltip-row" key={r.handle}>
                <span className="key" style={{ background: colors[r.handle] }} aria-hidden="true" />
                <strong>{fmtValue(r.value)}</strong>
                <span className="tooltip-name">@{r.handle}</span>
                {metric === 'followers' && r.prev && (
                  <span className="tooltip-delta">
                    {fmtSigned(r.value - r.prev.value)} vs {fmtDay(r.prev.date)}
                  </span>
                )}
                {metric === 'growth' && r.raw != null && <span className="tooltip-delta">{fmtInt(r.raw)} seguidores</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {onlyOneDay && (
        <p className="chart-note" role="status">
          Só existe 1 dia de coleta até agora. A linha aparece a partir da segunda coleta, e o gráfico ganha um ponto por dia.
        </p>
      )}

      {series.length >= 2 && (
        <ul className="legend" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.handle}>
              <span className="key" style={{ background: colors[s.handle] }} aria-hidden="true" />
              @{s.handle}
              {s.points.length === 0 && <span className="muted"> (sem dados)</span>}
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="link-btn" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Ocultar tabela' : 'Ver como tabela'}
      </button>
      {showTable && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Dia</th>
                {series.map((s) => (
                  <th scope="col" key={s.handle}>
                    @{s.handle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...allDates].reverse().map((d) => (
                <tr key={d}>
                  <th scope="row">{fmtDay(d, true)}</th>
                  {series.map((s) => {
                    const p = s.points.find((x) => x.date === d);
                    return <td key={s.handle}>{p ? fmtValue(p.value) : 'sem dados'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
