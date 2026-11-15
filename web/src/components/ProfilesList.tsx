import { followersDelta } from '../lib/derive.ts';
import { fmtInt, fmtPct, fmtSigned, timeAgo } from '../lib/format';
import type { Account, Period, Snapshot } from '../types';

interface Props {
  handles: string[];
  accounts: Record<string, Account>;
  snapshots: Snapshot[];
  flaggedCounts: Record<string, number>;
  colors: Record<string, string>;
  selected: string | null;
  period: Period;
  today: string;
  onSelect: (handle: string | null) => void;
}

export function ProfilesList({ handles, accounts, snapshots, flaggedCounts, colors, selected, period, today, onSelect }: Props) {
  return (
    <div className="profiles" role="list" aria-label="Perfis monitorados">
      <div className="profiles-head" aria-hidden="true">
        <span>Perfil</span>
        <span>Seguidores</span>
        <span>Posts</span>
        <span>Engaj. médio</span>
        <span>Bombaram (30d)</span>
      </div>
      {handles.map((handle) => {
        const account = accounts[handle];
        const isSelected = selected === handle;
        const delta = account?.followers != null ? followersDelta(snapshots, handle, period, today) : null;
        const hasData = account?.followers != null;
        return (
          <div role="listitem" key={handle}>
            <button
              type="button"
              className={`profile-row${isSelected ? ' is-selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : handle)}
              style={{ ['--row-color' as string]: colors[handle] }}
            >
              <span className="profile-id">
                <span className="avatar" aria-hidden="true">
                  {handle[0].toUpperCase()}
                </span>
                <span className="profile-name">
                  <strong>@{handle}</strong>
                  <span className="muted ellipsis">{account?.fullName || 'Sem nome retornado'}</span>
                </span>
              </span>

              {hasData ? (
                <>
                  <span className="metric" data-label="Seguidores">
                    <strong>{fmtInt(account.followers)}</strong>
                    {delta ? (
                      <span className={`delta ${delta.delta > 0 ? 'up' : delta.delta < 0 ? 'down' : ''}`}>
                        {fmtSigned(delta.delta)} no período
                      </span>
                    ) : (
                      <span className="delta muted">sem variação ainda</span>
                    )}
                  </span>
                  <span className="metric" data-label="Posts">
                    <strong>{fmtInt(account.postsCount)}</strong>
                  </span>
                  <span className="metric" data-label="Engaj. médio">
                    <strong>{fmtPct(account.baseline?.average)}</strong>
                    {account.baseline?.average == null && <span className="delta muted">sem curtidas visíveis</span>}
                  </span>
                  <span className="metric" data-label="Bombaram (30d)">
                    <strong>{fmtInt(flaggedCounts[handle] ?? 0)}</strong>
                  </span>
                </>
              ) : (
                <span className="row-empty muted">
                  {account?.status === 'error' ? 'Sem dados: a última coleta falhou.' : 'Aguardando a primeira coleta.'}
                </span>
              )}

              {account?.status === 'error' && (
                <span className="row-alert" role="note">
                  Erro na última coleta{account.lastCollectedAt ? ` (dados de ${timeAgo(account.lastCollectedAt)})` : ''}: {account.error}
                </span>
              )}
              {account?.status === 'private' && (
                <span className="row-alert" role="note">
                  {account.error}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
