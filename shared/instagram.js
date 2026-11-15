// Utilitários compartilhados entre o coletor (Node) e o dashboard (navegador).
// ESM puro, sem dependências.

/** Primeiros segmentos de URL do Instagram que NÃO são perfis. */
const RESERVED_PATHS = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'story', 'explore', 'accounts', 'direct',
  'about', 'legal', 'developer', 'web', 'challenge', 'oauth', 'emails', 'session',
  'api', 'graphql', 'static', 'privacy', 'terms', 'directory', 'popular',
  'locations', 'tags', 'ar', 'share', 's',
]);

const HOSTS = new Set(['instagram.com', 'instagr.am']);
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

/** Máximo de concorrentes monitorados ao mesmo tempo. */
export const MAX_PROFILES = 5;

/**
 * Extrai o @ de um link de perfil do Instagram (ou de um "@usuario"/"usuario" solto).
 * Nunca adivinha: se o texto não for claramente um perfil, devolve erro em português.
 *
 * @param {unknown} input
 * @returns {{ok: true, handle: string, url: string} | {ok: false, error: string}}
 */
export function parseInstagramHandle(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'Cole o link do perfil do Instagram (ex.: https://www.instagram.com/salute.ia).' };
  }
  const raw = input.trim();
  let candidate;

  const looksLikeBareName = /^@?[A-Za-z0-9._]+$/.test(raw);
  const bareLower = raw.replace(/^@/, '').toLowerCase();
  const isBareHost = HOSTS.has(bareLower) || HOSTS.has(bareLower.replace(/^www\./, ''));

  if (looksLikeBareName && !isBareHost) {
    candidate = raw.replace(/^@/, '');
  } else {
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return { ok: false, error: 'Não consegui entender esse link. Cole o endereço completo do perfil, como https://www.instagram.com/salute.ia.' };
    }
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
    if (!HOSTS.has(host)) {
      return { ok: false, error: 'O link precisa ser de instagram.com.' };
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) {
      return { ok: false, error: 'Esse link não aponta para um perfil. Abra o perfil no Instagram e copie o link dele.' };
    }
    if (RESERVED_PATHS.has(parts[0].toLowerCase())) {
      return { ok: false, error: 'Esse link é de um post, reel ou página do Instagram. Cole o link do perfil (instagram.com/usuario).' };
    }
    candidate = parts[0];
  }

  const handle = candidate.toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'Nome de usuário inválido. O Instagram só aceita letras, números, ponto e sublinhado (até 30 caracteres).' };
  }
  return { ok: true, handle, url: `https://www.instagram.com/${handle}/` };
}

/** Data (YYYY-MM-DD) no fuso de São Paulo — o "dia" das coletas e do histórico. */
export function dateInSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
