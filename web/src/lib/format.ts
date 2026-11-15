const nf = new Intl.NumberFormat('pt-BR');
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const TZ = 'America/Sao_Paulo';

export const fmtInt = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '—' : nf.format(n));
export const fmtCompact = (n: number): string => compact.format(n);

export const fmtPct = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

/** Variação percentual com sinal: 0,021 -> "+2,1%". */
export const fmtGrowth = (v: number, digits = 1): string => {
  const abs = Math.abs(v) * 100;
  const text = abs.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const rounded = Number(abs.toFixed(digits));
  return `${rounded === 0 ? '' : v > 0 ? '+' : '−'}${text}%`;
};

export const fmtMultiple = (v: number): string =>
  `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;

export const fmtSigned = (n: number): string => (n > 0 ? `+${nf.format(n)}` : n < 0 ? `−${nf.format(Math.abs(n))}` : '0');

/** 'YYYY-MM-DD' -> "14 nov" (sem deslocamento de fuso). */
export function fmtDay(date: string, withYear = false): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).replace('.', '');
}

/** ISO completo -> "4 nov 2026" no fuso de São Paulo. */
export function fmtPostDate(iso: string | null): string {
  if (!iso) return 'data desconhecida';
  return new Date(iso)
    .toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
    .replace(/\./g, '');
}

export function fmtDateTime(iso: string): string {
  return new Date(iso)
    .toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ })
    .replace(/\./g, '');
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export const TYPE_LABEL: Record<string, string> = {
  video: 'Vídeo',
  image: 'Imagem',
  carousel: 'Carrossel',
  unknown: 'Post',
};
