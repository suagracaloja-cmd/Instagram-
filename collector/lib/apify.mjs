// Cliente da Apify (ator apify/instagram-profile-scraper) + normalização da resposta.

export class ApifyError extends Error {}

const DEFAULT_ACTOR = 'apify~instagram-profile-scraper';
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apifyFetch(url, init, { fetchImpl, sleep, retries = 3 }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchImpl(url, init);
      if (res.status === 429 || res.status >= 500) {
        lastError = new ApifyError(`A Apify respondeu HTTP ${res.status}.`);
      } else {
        return res;
      }
    } catch (error) {
      lastError = new ApifyError(`Falha de rede ao falar com a Apify: ${error.message}`);
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

/** Tolera o que costuma vir junto ao colar o token: espaços, quebra de linha, aspas, "Bearer ". */
export function cleanToken(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

async function readJson(res, what) {
  if (res.status === 401 || res.status === 403) {
    throw new ApifyError(
      `A Apify recusou o token (HTTP ${res.status}): o valor salvo em APIFY_TOKEN não é um token válido. ` +
        'Copie de novo o "Personal API token" em console.apify.com/settings/integrations (sem aspas nem espaços) ' +
        'e atualize o secret APIFY_TOKEN no GitHub.',
    );
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new ApifyError(`${what}: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
  }
  return res.json();
}

/**
 * Roda o ator para uma lista de @s e devolve os itens brutos do dataset.
 * O token vai só no cabeçalho Authorization (nunca em URL, nunca em log).
 */
export async function scrapeProfiles(handles, options = {}) {
  const {
    token: rawToken,
    baseUrl = process.env.APIFY_BASE_URL || 'https://api.apify.com',
    actor = process.env.APIFY_ACTOR || DEFAULT_ACTOR,
    fetchImpl = fetch,
    sleep = defaultSleep,
    timeoutMs = 10 * 60 * 1000,
    log = () => {},
  } = options;
  const token = cleanToken(rawToken);
  if (!token) throw new ApifyError('APIFY_TOKEN não está configurado.');

  const deps = { fetchImpl, sleep };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const startRes = await apifyFetch(
    `${baseUrl}/v2/acts/${actor}/runs`,
    { method: 'POST', headers, body: JSON.stringify({ usernames: handles }) },
    deps,
  );
  const started = (await readJson(startRes, 'Não consegui iniciar o ator na Apify')).data;
  log(`Apify: execução ${started.id} iniciada para ${handles.length} perfil(is).`);

  const deadline = Date.now() + timeoutMs;
  let run = started;
  while (!TERMINAL.has(run.status)) {
    if (Date.now() > deadline) throw new ApifyError('A Apify demorou mais de 10 minutos; abortei a espera.');
    const res = await apifyFetch(
      `${baseUrl}/v2/actor-runs/${run.id}?waitForFinish=30`,
      { headers: { Authorization: headers.Authorization } },
      deps,
    );
    run = (await readJson(res, 'Não consegui consultar a execução na Apify')).data;
  }
  if (run.status !== 'SUCCEEDED') {
    throw new ApifyError(`A execução na Apify terminou com status ${run.status}.`);
  }

  const itemsRes = await apifyFetch(
    `${baseUrl}/v2/datasets/${run.defaultDatasetId}/items?format=json&clean=0`,
    { headers: { Authorization: headers.Authorization } },
    deps,
  );
  const items = await readJson(itemsRes, 'Não consegui baixar o resultado da Apify');
  if (!Array.isArray(items)) throw new ApifyError('Resposta inesperada da Apify (não é uma lista).');
  log(`Apify: ${items.length} item(ns) recebido(s).`);
  return items;
}

const TYPE_MAP = { Video: 'video', Image: 'image', Sidecar: 'carousel' };

function toIso(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Post cru da Apify -> formato interno. Contagens ausentes viram null, nunca zero. */
export function normalizePost(raw, handle) {
  if (!raw || typeof raw.shortCode !== 'string' || !raw.shortCode) return null;
  const likesRaw = Number.isFinite(raw.likesCount) ? raw.likesCount : null;
  const likesHidden = likesRaw === null || likesRaw < 0; // Apify devolve -1 quando o autor oculta curtidas
  return {
    shortCode: raw.shortCode,
    handle,
    url: typeof raw.url === 'string' && raw.url ? raw.url : `https://www.instagram.com/p/${raw.shortCode}/`,
    type: TYPE_MAP[raw.type] ?? 'unknown',
    caption: typeof raw.caption === 'string' ? raw.caption : '',
    likes: likesHidden ? null : likesRaw,
    likesHidden,
    comments: Number.isFinite(raw.commentsCount) && raw.commentsCount >= 0 ? raw.commentsCount : null,
    timestamp: toIso(raw.timestamp),
    isPinned: raw.isPinned === true,
    videoDuration: Number.isFinite(raw.videoDuration) ? raw.videoDuration : null,
    // Link do CDN: expira, então só vive durante a coleta (não é gravado em data/).
    videoUrl: typeof raw.videoUrl === 'string' && raw.videoUrl ? raw.videoUrl : null,
  };
}

/**
 * Itens do dataset -> { profiles, errors } indexados pelo @ pedido.
 * Qualquer @ pedido sem dado utilizável entra em `errors` com o motivo real.
 */
export function normalizeItems(items, requestedHandles) {
  const profiles = new Map();
  const errors = new Map();
  const wanted = new Set(requestedHandles);

  for (const item of items) {
    const handle = typeof item?.username === 'string' ? item.username.toLowerCase() : null;
    if (!handle || !wanted.has(handle)) {
      const hint = String(item?.inputUrl ?? '').match(/instagram\.com\/([^/?#]+)/i)?.[1]?.toLowerCase();
      if (hint && wanted.has(hint) && item?.error) {
        errors.set(hint, `${item.error}${item.errorDescription ? `: ${item.errorDescription}` : ''}`);
      }
      continue;
    }
    if (!Number.isFinite(item.followersCount)) {
      errors.set(handle, 'A Apify não devolveu o número de seguidores deste perfil.');
      continue;
    }
    const posts = (Array.isArray(item.latestPosts) ? item.latestPosts : [])
      .map((p) => normalizePost(p, handle))
      .filter(Boolean);
    profiles.set(handle, {
      handle,
      fullName: typeof item.fullName === 'string' ? item.fullName : '',
      biography: typeof item.biography === 'string' ? item.biography : '',
      followers: item.followersCount,
      following: Number.isFinite(item.followsCount) ? item.followsCount : null,
      postsCount: Number.isFinite(item.postsCount) ? item.postsCount : null,
      verified: item.verified === true,
      isPrivate: item.private === true,
      isBusiness: item.isBusinessAccount === true,
      posts,
    });
  }

  for (const handle of requestedHandles) {
    if (!profiles.has(handle) && !errors.has(handle)) {
      errors.set(handle, 'A Apify não retornou dados para este perfil (inexistente, privado ou bloqueado).');
    }
  }
  return { profiles, errors };
}
