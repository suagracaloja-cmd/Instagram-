import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PROFILES, parseInstagramHandle } from '../../../shared/instagram.js';
import {
  addProfile,
  clearToken,
  detectRepo,
  dispatchCollect,
  getToken,
  GithubError,
  removeProfile,
  saveToken,
} from '../lib/github';
import type { Account, MonitoredProfile } from '../types';

interface Props {
  profiles: MonitoredProfile[];
  accounts: Record<string, Account>;
  onClose: () => void;
  /** Chamado depois de salvar no GitHub; `collecting` indica que a coleta foi disparada. */
  onChanged: (profiles: MonitoredProfile[], collecting: boolean, message: string) => void;
  onTokenChange: (connected: boolean) => void;
}

type Status = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export function ManageSheet({ profiles, accounts, onClose, onChanged, onTokenChange }: Props) {
  const repo = detectRepo();
  const [token, setToken] = useState<string | null>(getToken());
  const [tokenInput, setTokenInput] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const parsed = useMemo(() => (link.trim() ? parseInstagramHandle(link) : null), [link]);
  const duplicate = parsed?.ok && profiles.some((p) => p.handle === parsed.handle);
  const full = profiles.length >= MAX_PROFILES;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  const connect = () => {
    const value = tokenInput.trim();
    if (value.length < 20) {
      setStatus({ kind: 'error', text: 'Esse token parece curto demais. Copie o token inteiro que o GitHub mostrou.' });
      return;
    }
    saveToken(value);
    setToken(value);
    setTokenInput('');
    setStatus({ kind: 'ok', text: 'Conectado. Agora você já pode adicionar e remover perfis.' });
    onTokenChange(true);
  };

  const disconnect = () => {
    clearToken();
    setToken(null);
    setStatus({ kind: 'info', text: 'Desconectado. O token foi apagado deste aparelho.' });
    onTokenChange(false);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await work();
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Algo deu errado.' });
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      if (!token || !repo || !parsed?.ok) return;
      const next = await addProfile(token, repo, parsed.handle, MAX_PROFILES);
      let collecting = true;
      let message = `@${parsed.handle} adicionado. A primeira coleta foi disparada e os dados aparecem aqui em poucos minutos.`;
      try {
        await dispatchCollect(token, repo);
      } catch (error) {
        collecting = false;
        message = `@${parsed.handle} foi adicionado, mas não consegui iniciar a coleta agora (${error instanceof GithubError ? error.message : 'erro desconhecido'}). Ela roda sozinha na próxima coleta diária.`;
      }
      setLink('');
      setStatus({ kind: collecting ? 'ok' : 'info', text: message });
      onChanged(next, collecting, message);
    });

  const remove = (handle: string) =>
    run(async () => {
      if (!token || !repo) return;
      const next = await removeProfile(token, repo, handle);
      setConfirmRemove(null);
      let collecting = true;
      try {
        await dispatchCollect(token, repo);
      } catch {
        collecting = false;
      }
      const message = `@${handle} não é mais monitorado. O histórico já coletado continua guardado.`;
      setStatus({ kind: 'ok', text: message });
      onChanged(next, collecting, message);
    });

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="sheet-title">Gerenciar concorrentes</h2>
          <button type="button" className="icon-btn" onClick={onClose} ref={closeRef} aria-label="Fechar">
            ✕
          </button>
        </div>

        {!repo && (
          <p className="notice warn" role="note">
            Não consegui descobrir o repositório do GitHub a partir do endereço desta página. Abra o site pelo link do GitHub Pages.
          </p>
        )}

        {!token ? (
          <section className="sheet-section">
            <h3>1. Conecte ao GitHub (só uma vez)</h3>
            <p className="muted">
              Para adicionar ou remover perfis, o site grava no seu repositório. Crie um token que só enxerga este repositório:
            </p>
            <ol className="steps">
              <li>
                Abra{' '}
                <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                  github.com/settings/personal-access-tokens/new
                </a>
                .
              </li>
              <li>
                Em <em>Repository access</em>, escolha <em>Only select repositories</em> e marque{' '}
                <strong>{repo ? `${repo.owner}/${repo.repo}` : 'este repositório'}</strong>.
              </li>
              <li>
                Em <em>Permissions → Repository permissions</em>, deixe <strong>Contents</strong> e <strong>Actions</strong> como{' '}
                <em>Read and write</em>.
              </li>
              <li>Gere o token e cole abaixo. Ele fica salvo só neste aparelho.</li>
            </ol>
            <label className="field">
              <span>Token do GitHub</span>
              <input
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="github_pat_…"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
            </label>
            <button type="button" className="btn" onClick={connect} disabled={!tokenInput.trim()}>
              Conectar
            </button>
          </section>
        ) : (
          <>
            <section className="sheet-section">
              <h3>Adicionar concorrente</h3>
              <label className="field">
                <span>Cole o link do perfil do Instagram</span>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="https://www.instagram.com/salute.ia"
                  value={link}
                  disabled={busy || full}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && parsed?.ok && !duplicate && !full && !busy && add()}
                />
              </label>
              {parsed?.ok && !duplicate && (
                <p className="hint ok" role="status">
                  Perfil detectado: <strong>@{parsed.handle}</strong>
                </p>
              )}
              {parsed?.ok && duplicate && <p className="hint err">@{parsed.handle} já está na lista.</p>}
              {parsed && !parsed.ok && <p className="hint err">{parsed.error}</p>}
              {full && <p className="hint err">Você já monitora {MAX_PROFILES} perfis (o máximo). Remova um para adicionar outro.</p>}
              <button
                type="button"
                className="btn"
                onClick={add}
                disabled={busy || !parsed?.ok || Boolean(duplicate) || full}
              >
                {busy ? 'Salvando…' : parsed?.ok ? `Adicionar @${parsed.handle}` : 'Adicionar'}
              </button>
            </section>

            <section className="sheet-section">
              <h3>
                Monitorados ({profiles.length} de {MAX_PROFILES})
              </h3>
              {profiles.length === 0 && <p className="muted">Nenhum perfil ainda.</p>}
              <ul className="manage-list">
                {profiles.map((p) => (
                  <li key={p.handle}>
                    <span className="manage-name">
                      <strong>@{p.handle}</strong>
                      <span className="muted ellipsis">{accounts[p.handle]?.fullName ?? ''}</span>
                    </span>
                    {confirmRemove === p.handle ? (
                      <span className="confirm">
                        <button type="button" className="btn danger" disabled={busy} onClick={() => remove(p.handle)}>
                          {busy ? 'Removendo…' : 'Confirmar'}
                        </button>
                        <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirmRemove(null)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirmRemove(p.handle)}>
                        Remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="sheet-section">
              <h3>Conexão com o GitHub</h3>
              <p className="muted">Conectado neste aparelho{repo ? ` ao repositório ${repo.owner}/${repo.repo}` : ''}.</p>
              <button type="button" className="btn secondary" onClick={disconnect}>
                Desconectar e apagar o token
              </button>
            </section>
          </>
        )}

        {status && (
          <p className={`notice ${status.kind === 'error' ? 'warn' : ''}`} role={status.kind === 'error' ? 'alert' : 'status'}>
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}
