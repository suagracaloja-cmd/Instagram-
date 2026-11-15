import type { Account, AppData, FlaggedPost, Meta, MonitoredProfile, Snapshot } from '../types';

async function getJson<T>(name: string, fallback: T): Promise<T> {
  const res = await fetch(`./data/${name}?t=${Date.now()}`, { cache: 'no-store' });
  // No servidor de desenvolvimento, arquivo inexistente devolve index.html (200); trate como ausente.
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  if (res.status === 404 || (res.ok && !isJson)) return fallback;
  if (!res.ok) throw new Error(`Não consegui carregar ${name} (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

export async function loadAll(): Promise<AppData> {
  const [profiles, accounts, snapshots, flagged, meta] = await Promise.all([
    getJson<{ profiles: MonitoredProfile[] }>('profiles.json', { profiles: [] }),
    getJson<Record<string, Account>>('accounts.json', {}),
    getJson<Snapshot[]>('snapshots.json', []),
    getJson<FlaggedPost[]>('flagged.json', []),
    getJson<Meta>('meta.json', { lastRun: null, runs: [] }),
  ]);
  return { profiles: profiles.profiles ?? [], accounts, snapshots, flagged, meta };
}

export async function loadMeta(): Promise<Meta> {
  return getJson<Meta>('meta.json', { lastRun: null, runs: [] });
}
