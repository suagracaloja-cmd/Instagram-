// Cálculos de exibição (sem React): período, séries do gráfico, variação, contagens.
import type { FlaggedPost, Metric, Period, Snapshot } from '../types.ts';

const DAY = 86_400_000;

const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date: string, days: number): string =>
  new Date(toMs(date) + days * DAY).toISOString().slice(0, 10);

/** Primeiro dia (inclusive) da janela, ou null para "tudo". */
export function periodStart(period: Period, today: string): string | null {
  return period === 'all' ? null : addDays(today, -period);
}

export interface Point {
  date: string;
  value: number;
  /** Seguidores absolutos (usado no tooltip da visão de crescimento). */
  raw?: number;
}
export interface Series {
  handle: string;
  points: Point[];
}

export function buildSeries(
  snapshots: Snapshot[],
  handles: string[],
  metric: Metric,
  period: Period,
  today: string,
): Series[] {
  const start = periodStart(period, today);
  return handles.map((handle) => {
    let points: Point[] = [];
    for (const s of snapshots) {
      if (s.handle !== handle) continue;
      if (start && s.date < start) continue;
      const value = metric === 'engagement' ? s.avgEngagement : s.followers;
      if (value == null || !Number.isFinite(value)) continue; // sem dado => sem ponto (nunca zero)
      points.push({ date: s.date, value, raw: s.followers });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    if (metric === 'growth') {
      // Índice comum: variação % desde o primeiro ponto da janela, para comparar perfis de tamanhos diferentes.
      const base = points[0]?.value;
      points = base && base > 0 ? points.map((p) => ({ ...p, value: p.value / base - 1 })) : [];
    }
    return { handle, points };
  });
}

/** Variação de seguidores dentro da janela. Null se houver menos de 2 coletas na janela. */
export function followersDelta(
  snapshots: Snapshot[],
  handle: string,
  period: Period,
  today: string,
): { delta: number; from: string; to: string } | null {
  const [series] = buildSeries(snapshots, [handle], 'followers', period, today);
  if (series.points.length < 2) return null;
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  return { delta: last.value - first.value, from: first.date, to: last.date };
}

/** Posts sinalizados cuja publicação foi nos últimos `days` dias. */
export function flaggedWithin(flagged: FlaggedPost[], handles: string[], days: number, now: Date): FlaggedPost[] {
  const limit = now.getTime() - days * DAY;
  const set = new Set(handles);
  return flagged.filter((f) => set.has(f.handle) && f.timestamp != null && Date.parse(f.timestamp) >= limit);
}

/** Ticks "redondos" para o eixo Y. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.02 || 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= last + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** Cor (slot categórico 1..5) segue a posição do perfil na lista, nunca o ranking. */
export const colorVar = (index: number): string => `var(--series-${(index % 5) + 1})`;
