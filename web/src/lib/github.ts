// Escrita via API do GitHub (direto do navegador): adicionar/remover perfil e disparar a coleta.
// O token fica só neste aparelho (localStorage) e nunca vai para o código nem para o repositório.
import type { MonitoredProfile } from '../types';

const TOKEN_KEY = 'igmon.githubToken';
const BRANCH = (import.meta.env.VITE_GH_BRANCH as string | undefined) || 'main';
const WORKFLOW = 'collect.yml';
const PROFILES_PATH = 'data/profiles.json';

export interface Repo {
  owner: string;
  repo: string;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    /* navegação privada: o token vale só até fechar a aba */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** owner/repo vem do build (VITE_GITHUB_REPO) ou, em produção, da URL do GitHub Pages. */
export function detectRepo(): Repo | null {
  const fromEnv = (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.split('/');
  if (fromEnv && fromEnv.length === 2 && fromEnv[0] && fromEnv[1]) return { owner: fromEnv[0], repo: fromEnv[1] };
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

export class GithubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function gh(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new GithubError('Sem conexão com o GitHub. Verifique a internet e tente de novo.', 0);
  }
  if (res.ok) return res;
  const messages: Record<number, string> = {
    401: 'Token do GitHub inválido ou expirado. Gere outro e cole de novo.',
    403: 'O token não tem permissão. Ele precisa de Contents e Actions com acesso de escrita neste repositório.',
    404: 'Repositório ou arquivo não encontrado, ou o token não enxerga este repositório.',
    409: 'O arquivo mudou enquanto eu salvava. Tente de novo.',
    422: 'O GitHub recusou a alteração. Tente de novo.',
  };
  throw new GithubError(messages[res.status] ?? `O GitHub respondeu HTTP ${res.status}.`, res.status);
}

const decode = (b64: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const encode = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

async function readProfiles(token: string, r: Repo): Promise<{ profiles: MonitoredProfile[]; sha: string }> {
  const res = await gh(`/repos/${r.owner}/${r.repo}/contents/${PROFILES_PATH}?ref=${BRANCH}`, token);
  const file = (await res.json()) as { content: string; sha: string };
  const parsed = JSON.parse(decode(file.content)) as { profiles?: MonitoredProfile[] };
  return { profiles: parsed.profiles ?? [], sha: file.sha };
}

async function writeProfiles(
  token: string,
  r: Repo,
  profiles: MonitoredProfile[],
  sha: string,
  message: string,
): Promise<void> {
  await gh(`/repos/${r.owner}/${r.repo}/contents/${PROFILES_PATH}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      branch: BRANCH,
      sha,
      content: encode(`${JSON.stringify({ profiles }, null, 2)}\n`),
    }),
  });
}

/** Lê-modifica-grava com 1 nova tentativa se o arquivo mudou no meio (conflito de sha). */
async function mutateProfiles(
  token: string,
  r: Repo,
  change: (current: MonitoredProfile[]) => { next: MonitoredProfile[]; message: string },
): Promise<MonitoredProfile[]> {
  for (let attempt = 0; ; attempt += 1) {
    const { profiles, sha } = await readProfiles(token, r);
    const { next, message } = change(profiles);
    try {
      await writeProfiles(token, r, next, sha, message);
      return next;
    } catch (error) {
      if (error instanceof GithubError && error.status === 409 && attempt === 0) continue;
      throw error;
    }
  }
}

export const addProfile = (token: string, r: Repo, handle: string, max: number) =>
  mutateProfiles(token, r, (current) => {
    if (current.some((p) => p.handle === handle)) throw new GithubError(`@${handle} já está sendo monitorado.`, 0);
    if (current.length >= max) throw new GithubError(`Você já monitora ${max} perfis (o máximo). Remova um antes de adicionar outro.`, 0);
    const added = { handle, url: `https://www.instagram.com/${handle}/`, addedAt: new Date().toISOString().slice(0, 10) };
    return { next: [...current, added], message: `feat: monitorar @${handle}` };
  });

export const removeProfile = (token: string, r: Repo, handle: string) =>
  mutateProfiles(token, r, (current) => ({
    next: current.filter((p) => p.handle !== handle),
    message: `chore: parar de monitorar @${handle}`,
  }));

export async function dispatchCollect(token: string, r: Repo): Promise<void> {
  await gh(`/repos/${r.owner}/${r.repo}/actions/workflows/${WORKFLOW}/dispatches`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: BRANCH }),
  });
}
