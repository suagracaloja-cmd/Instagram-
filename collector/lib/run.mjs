// Orquestra uma coleta completa: lê data/, busca na Apify, atualiza histórico,
// sinaliza posts que bombaram, enriquece (transcrição + análise) e grava tudo de volta.
import { dateInSaoPaulo } from '../../shared/instagram.js';
import { enrichEntry } from './enrich.mjs';
import { averageEngagement, detectFlags, engagementOf, baselineExcluding } from './metrics.mjs';

const MAX_RUN_HISTORY = 30;

const byTimestampDesc = (a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? ''));

function newFlagEntry(flag, followers, nowIso) {
  const { post } = flag;
  return {
    shortCode: post.shortCode,
    handle: post.handle,
    url: post.url,
    type: post.type,
    caption: post.caption,
    timestamp: post.timestamp,
    likes: post.likes,
    comments: post.comments,
    followersAtFlag: followers,
    engagement: flag.engagement,
    baseline: flag.baseline,
    baselinePosts: flag.baselinePosts,
    multiple: flag.multiple,
    multipleNow: flag.multiple,
    flaggedAt: nowIso,
    transcript: null,
    transcriptStatus: post.type === 'video' ? 'pending' : 'not_applicable',
    transcriptNote: null,
    transcriptAttempts: 0,
    analysis: null,
    analysisStatus: 'pending',
    analysisNote: null,
    analysisBasis: null,
  };
}

/**
 * @param {object} deps
 * @param {{read: Function, write: Function}} deps.store
 * @param {(handles: string[]) => Promise<{profiles: Map, errors: Map}>} deps.scrape
 * @param {Function} deps.transcribe
 * @param {Function} deps.analyze
 */
export async function runCollection({ store, scrape, transcribe, analyze, now = new Date(), log = console.log }) {
  const startedAt = now.toISOString();
  const date = dateInSaoPaulo(now);

  const { profiles: monitored = [] } = await store.read('profiles.json', { profiles: [] });
  const handles = monitored.map((p) => p.handle);
  if (handles.length === 0) {
    log('Nenhum perfil em data/profiles.json — nada a coletar.');
    return { exitCode: 0, status: 'idle', results: [] };
  }

  const accounts = await store.read('accounts.json', {});
  const postsStore = await store.read('posts.json', {});
  let snapshots = await store.read('snapshots.json', []);
  const flagged = await store.read('flagged.json', []);
  const meta = await store.read('meta.json', { lastRun: null, runs: [] });

  let scraped;
  try {
    scraped = await scrape(handles);
  } catch (error) {
    const reason = error?.message ?? String(error);
    scraped = { profiles: new Map(), errors: new Map(handles.map((h) => [h, reason])) };
  }

  const results = [];
  const currentPostsByCode = new Map();

  for (const handle of handles) {
    const profile = scraped.profiles.get(handle);
    if (!profile) {
      const error = scraped.errors.get(handle) ?? 'Sem dados.';
      accounts[handle] = { ...(accounts[handle] ?? { handle }), handle, status: 'error', error, lastAttemptAt: startedAt };
      results.push({ handle, status: 'error', error, posts: 0, newFlags: 0 });
      log(`@${handle}: ERRO — ${error}`);
      continue;
    }

    // Posts: mescla com o que já conhecemos (nunca apaga histórico).
    for (const post of profile.posts) {
      currentPostsByCode.set(post.shortCode, post);
      const { videoUrl: _transient, ...stored } = post;
      const previous = postsStore[post.shortCode];
      postsStore[post.shortCode] = {
        ...stored,
        firstSeenAt: previous?.firstSeenAt ?? startedAt,
        lastSeenAt: startedAt,
      };
    }
    const knownPosts = Object.values(postsStore).filter((p) => p.handle === handle);

    // Histórico diário (um registro por perfil por dia; reexecução no mesmo dia substitui).
    const today = averageEngagement(profile.posts, profile.followers);
    snapshots = snapshots.filter((s) => !(s.date === date && s.handle === handle));
    snapshots.push({
      date,
      handle,
      followers: profile.followers,
      following: profile.following,
      postsCount: profile.postsCount,
      avgEngagement: today.average,
      postsConsidered: today.count,
      collectedAt: startedAt,
    });

    // Sinalização de "bombou" (nunca duplica: shortCode já sinalizado é ignorado).
    const alreadyFlagged = new Set(flagged.map((f) => f.shortCode));
    const flags = detectFlags({ candidates: profile.posts, knownPosts, followers: profile.followers, alreadyFlagged });
    for (const flag of flags) flagged.push(newFlagEntry(flag, profile.followers, startedAt));

    const overall = averageEngagement(knownPosts, profile.followers);
    accounts[handle] = {
      handle,
      fullName: profile.fullName,
      biography: profile.biography,
      followers: profile.followers,
      following: profile.following,
      postsCount: profile.postsCount,
      verified: profile.verified,
      isPrivate: profile.isPrivate,
      isBusiness: profile.isBusiness,
      status: profile.isPrivate ? 'private' : 'ok',
      error: profile.isPrivate ? 'Perfil privado: a Apify não consegue ler os posts.' : null,
      lastCollectedAt: startedAt,
      lastAttemptAt: startedAt,
      baseline: { average: overall.average, posts: overall.count },
    };
    results.push({ handle, status: accounts[handle].status, error: accounts[handle].error, posts: profile.posts.length, newFlags: flags.length });
    log(`@${handle}: ${profile.followers} seguidores, ${profile.posts.length} posts lidos, ${flags.length} novo(s) sinalizado(s).`);
  }

  // Atualiza métricas dos sinalizados e enriquece (transcrição + análise) o que ainda falta.
  for (const entry of flagged) {
    const post = postsStore[entry.shortCode];
    const account = accounts[entry.handle];
    if (post) {
      entry.likes = post.likes;
      entry.comments = post.comments;
      entry.caption = post.caption;
      const now = engagementOf(post, account?.followers);
      const base = baselineExcluding(entry.shortCode, Object.values(postsStore).filter((p) => p.handle === entry.handle), account?.followers);
      if (now !== null && base.average > 0 && base.count >= 1) entry.multipleNow = now / base.average;
    }
    await enrichEntry(entry, currentPostsByCode.get(entry.shortCode) ?? null, { transcribe, analyze, log });
  }

  // Grava tudo (posts ordenados do mais novo para o mais antigo para diffs estáveis).
  const orderedPosts = Object.fromEntries(Object.values(postsStore).sort(byTimestampDesc).map((p) => [p.shortCode, p]));
  snapshots.sort((a, b) => a.date.localeCompare(b.date) || a.handle.localeCompare(b.handle));
  flagged.sort(byTimestampDesc);

  const okCount = results.filter((r) => r.status === 'ok' || r.status === 'private').length;
  const status = okCount === results.length ? 'ok' : okCount === 0 ? 'failed' : 'partial';
  const run = { startedAt, finishedAt: new Date().toISOString(), date, status, profiles: results };
  meta.lastRun = run;
  meta.runs = [run, ...(meta.runs ?? [])].slice(0, MAX_RUN_HISTORY);

  await store.write('accounts.json', accounts);
  await store.write('posts.json', orderedPosts);
  await store.write('snapshots.json', snapshots);
  await store.write('flagged.json', flagged);
  await store.write('meta.json', meta);

  log(`Coleta ${status}: ${okCount}/${results.length} perfis ok.`);
  return { exitCode: status === 'failed' ? 1 : 0, status, results };
}
