import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateInSaoPaulo } from '../../shared/instagram.js';
import { FlaggedList } from './components/FlaggedList';
import { FollowersChart } from './components/FollowersChart';
import { ManageSheet } from './components/ManageSheet';
import { ProfilesList } from './components/ProfilesList';
import { loadAll, loadMeta } from './lib/data';
import { buildSeries, colorVar, flaggedWithin } from './lib/derive.ts';
import { fmtDateTime, fmtInt, fmtPct, timeAgo } from './lib/format';
import { detectRepo, dispatchCollect, getToken, GithubError } from './lib/github';
import type { AppData, Metric, MonitoredProfile, Period } from './types';

const PERIODS: { value: Period; label: string }[] = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 'all', label: 'Tudo' },
];
const POLL_MS = 15_000;
const POLL_MAX_MS = 10 * 60_000;

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(30);
  const [metric, setMetric] = useState<Metric>('followers');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [connected, setConnected] = useState(Boolean(getToken()));
  const [toast, setToast] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const pollRef = useRef<number | null>(null);
  const toastRef = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastRef.current) window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(null), 7000);
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await loadAll());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não consegui carregar os dados.');
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (toastRef.current) window.clearTimeout(toastRef.current);
    };
  }, [reload]);

  /** Depois de disparar uma coleta, espera o meta.json mudar (o site é republicado) e recarrega. */
  const watchForNewRun = useCallback(
    (previousFinishedAt: string | null) => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      setCollecting(true);
      const startedAt = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const meta = await loadMeta();
          if (meta.lastRun && meta.lastRun.finishedAt !== previousFinishedAt) {
            window.clearInterval(pollRef.current!);
            setCollecting(false);
            await reload();
            showToast('Dados atualizados com a nova coleta.');
            return;
          }
        } catch {
          /* tenta de novo no próximo ciclo */
        }
        if (Date.now() - startedAt > POLL_MAX_MS) {
          window.clearInterval(pollRef.current!);
          setCollecting(false);
          showToast('A coleta está demorando. Recarregue a página em alguns minutos.');
        }
      }, POLL_MS);
    },
    [reload, showToast],
  );

  const today = dateInSaoPaulo();
  const handles = useMemo(() => data?.profiles.map((p) => p.handle) ?? [], [data]);
  const colors = useMemo(() => Object.fromEntries(handles.map((h, i) => [h, colorVar(i)])), [handles]);

  const view = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const chartHandles = selected && handles.includes(selected) ? [selected] : handles;
    const flaggedAll = data.flagged.filter((f) => handles.includes(f.handle));
    const flaggedShown = flaggedAll.filter((f) => !selected || f.handle === selected);
    const flagged30 = flaggedWithin(data.flagged, handles, 30, now);
    const counts: Record<string, number> = {};
    for (const f of flagged30) counts[f.handle] = (counts[f.handle] ?? 0) + 1;
    const avgs = handles
      .map((h) => data.accounts[h]?.baseline?.average)
      .filter((v): v is number => typeof v === 'number');
    const avg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
    return {
      series: buildSeries(data.snapshots, chartHandles, metric, period, today),
      flaggedShown,
      flagged30Count: flagged30.length,
      counts,
      avg,
      avgProfiles: avgs.length,
      anyBaseline: handles.some((h) => (data.accounts[h]?.baseline?.posts ?? 0) >= 5),
    };
  }, [data, handles, selected, metric, period, today]);

  const collectNow = async () => {
    const token = getToken();
    const repo = detectRepo();
    if (!token || !repo) {
      setSheetOpen(true);
      return;
    }
    try {
      await dispatchCollect(token, repo);
      showToast('Coleta iniciada. Leva alguns minutos; atualizo sozinho quando terminar.');
      watchForNewRun(data?.meta.lastRun?.finishedAt ?? null);
    } catch (e) {
      showToast(e instanceof GithubError ? e.message : 'Não consegui iniciar a coleta.');
    }
  };

  const onChanged = (profiles: MonitoredProfile[], didCollect: boolean, message: string) => {
    setData((d) => (d ? { ...d, profiles } : d));
    if (selected && !profiles.some((p) => p.handle === selected)) setSelected(null);
    showToast(message);
    if (didCollect) watchForNewRun(data?.meta.lastRun?.finishedAt ?? null);
  };

  if (error && !data) {
    return (
      <main className="page">
        <div className="empty" role="alert">
          <strong>Não consegui carregar os dados.</strong>
          <span>{error}</span>
          <button type="button" className="btn" onClick={reload}>
            Tentar de novo
          </button>
        </div>
      </main>
    );
  }
  if (!data || !view) {
    return (
      <main className="page" aria-busy="true">
        <p className="muted" role="status">
          Carregando…
        </p>
      </main>
    );
  }

  const lastRun = data.meta.lastRun;
  const hasAnyData = handles.some((h) => data.accounts[h]?.followers != null);
  const selectedName = selected ? `@${selected}` : null;

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>Radar de concorrentes</h1>
          <p className="muted">
            {lastRun ? (
              <>
                Última coleta: {fmtDateTime(lastRun.finishedAt)} ({timeAgo(lastRun.finishedAt)})
                {lastRun.status !== 'ok' && (
                  <span className={`chip ${lastRun.status === 'failed' ? 'bad' : 'warn'}`}>
                    {lastRun.status === 'failed' ? 'falhou' : 'parcial'}
                  </span>
                )}
              </>
            ) : (
              'Nenhuma coleta feita ainda.'
            )}
          </p>
        </div>
        <div className="top-actions">
          <button type="button" className="btn secondary" onClick={collectNow} disabled={collecting}>
            {collecting ? 'Coletando…' : 'Coletar agora'}
          </button>
          <button type="button" className="btn" onClick={() => setSheetOpen(true)}>
            Gerenciar perfis
          </button>
        </div>
      </header>

      {lastRun && lastRun.status !== 'ok' && (
        <p className="notice warn" role="alert">
          <strong>{lastRun.status === 'failed' ? 'A última coleta falhou.' : 'A última coleta foi parcial.'}</strong>{' '}
          {lastRun.profiles
            .filter((p) => p.status === 'error')
            .map((p) => `@${p.handle}: ${p.error}`)
            .join(' · ')}
        </p>
      )}

      <section className="cards" aria-label="Resumo">
        <div className="card">
          <span className="card-label">Perfis monitorados</span>
          <strong className="card-value">{handles.length}</strong>
          <span className="muted small">de 5 possíveis</span>
        </div>
        <div className="card">
          <span className="card-label">Posts que bombaram</span>
          <strong className="card-value">{view.flagged30Count}</strong>
          <span className="muted small">publicados nos últimos 30 dias</span>
        </div>
        <div className="card">
          <span className="card-label">Engajamento médio</span>
          <strong className="card-value">{fmtPct(view.avg)}</strong>
          <span className="muted small">
            {view.avg == null ? 'sem curtidas visíveis ainda' : `média de ${fmtInt(view.avgProfiles)} ${view.avgProfiles === 1 ? 'perfil' : 'perfis'}`}
          </span>
        </div>
      </section>

      <section aria-labelledby="h-profiles">
        <div className="section-head">
          <h2 id="h-profiles">Perfis</h2>
          <span className="muted small">Toque em um perfil para filtrar o gráfico e os posts</span>
        </div>
        {handles.length === 0 ? (
          <div className="empty" role="status">
            <strong>Nenhum concorrente monitorado.</strong>
            <span>Toque em “Gerenciar perfis” e cole o link do perfil do Instagram.</span>
          </div>
        ) : (
          <ProfilesList
            handles={handles}
            accounts={data.accounts}
            snapshots={data.snapshots}
            flaggedCounts={view.counts}
            colors={colors}
            selected={selected}
            period={period}
            today={today}
            onSelect={setSelected}
          />
        )}
        {!hasAnyData && handles.length > 0 && (
          <p className="notice" role="status">
            Ainda não há dados coletados. A coleta roda sozinha todo dia de manhã, ou toque em “Coletar agora”.
          </p>
        )}
      </section>

      <section aria-labelledby="h-chart">
        <div className="section-head">
          <h2 id="h-chart">
            {metric === 'followers' ? 'Seguidores' : metric === 'growth' ? 'Crescimento de seguidores' : 'Engajamento médio'} ao longo do tempo
            {selectedName && <span className="filter-pill">{selectedName}</span>}
          </h2>
        </div>
        <div className="controls">
          <div className="segmented" role="group" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                type="button"
                key={String(p.value)}
                className={period === p.value ? 'on' : ''}
                aria-pressed={period === p.value}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Métrica">
            <button type="button" className={metric === 'followers' ? 'on' : ''} aria-pressed={metric === 'followers'} onClick={() => setMetric('followers')}>
              Seguidores
            </button>
            <button type="button" className={metric === 'growth' ? 'on' : ''} aria-pressed={metric === 'growth'} onClick={() => setMetric('growth')}>
              Crescimento
            </button>
            <button type="button" className={metric === 'engagement' ? 'on' : ''} aria-pressed={metric === 'engagement'} onClick={() => setMetric('engagement')}>
              Engajamento
            </button>
          </div>
        </div>
        <div className="panel">
          <FollowersChart series={view.series} colors={colors} metric={metric} />
        </div>
      </section>

      <section aria-labelledby="h-posts">
        <div className="section-head">
          <h2 id="h-posts">
            Posts que bombaram
            {selectedName && <span className="filter-pill">{selectedName}</span>}
          </h2>
          <span className="muted small">engajamento acima de 2× a média do perfil · mais recentes primeiro</span>
        </div>
        {selected && (
          <button type="button" className="link-btn" onClick={() => setSelected(null)}>
            Mostrar todos os perfis
          </button>
        )}
        <FlaggedList key={selected ?? 'all'} posts={view.flaggedShown} colors={colors} hasBaseline={view.anyBaseline} />
      </section>

      <footer className="foot muted small">
        Dados reais da Apify (apify/instagram-profile-scraper). Curtidas ocultas não entram na média. Onde não há dado, o painel mostra “sem dados” em vez de estimar.
      </footer>

      {sheetOpen && (
        <ManageSheet
          profiles={data.profiles}
          accounts={data.accounts}
          onClose={() => setSheetOpen(false)}
          onChanged={onChanged}
          onTokenChange={setConnected}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <span hidden data-connected={connected} />
    </main>
  );
}
