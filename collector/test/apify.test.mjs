import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ApifyError, normalizeItems, normalizePost, scrapeProfiles } from '../lib/apify.mjs';
import { startMockApify } from './mock-apify.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/apify-salute-ia.json', import.meta.url), 'utf8'));
const noSleep = async () => {};

test('cliente HTTP: inicia execução, faz polling e baixa os itens (dados reais, servidor-mock)', async () => {
  const mock = await startMockApify(fixture, { token: 'segredo-123', runsBeforeDone: 2 });
  try {
    const items = await scrapeProfiles(['salute.ia'], { token: 'segredo-123', baseUrl: mock.baseUrl, sleep: noSleep });
    assert.equal(items.length, 1);
    assert.equal(items[0].username, 'salute.ia');

    const post = mock.requests.find((r) => r.method === 'POST');
    assert.match(post.url, /\/v2\/acts\/apify~instagram-profile-scraper\/runs$/);
    assert.deepEqual(mock.runs.get('run1').input, { usernames: ['salute.ia'] });
    // Token só no cabeçalho Authorization, nunca na URL
    assert.ok(mock.requests.every((r) => r.auth === 'Bearer segredo-123'));
    assert.ok(mock.requests.every((r) => !r.url.includes('segredo-123')));
    assert.ok(mock.runs.get('run1').polls >= 3, 'deveria ter feito polling até SUCCEEDED');
  } finally {
    await mock.close();
  }
});

test('token inválido vira erro claro (sem vazar o token)', async () => {
  const mock = await startMockApify(fixture, { token: 'certo' });
  try {
    await assert.rejects(
      scrapeProfiles(['salute.ia'], { token: 'errado-xyz', baseUrl: mock.baseUrl, sleep: noSleep }),
      (error) => error instanceof ApifyError && /401/.test(error.message) && !error.message.includes('errado-xyz'),
    );
  } finally {
    await mock.close();
  }
});

test('sem token: recusa antes de qualquer chamada', async () => {
  await assert.rejects(scrapeProfiles(['salute.ia'], { token: '' }), /APIFY_TOKEN/);
});

test('normaliza o perfil real: seguidores, posts, tipos e curtidas ocultas', () => {
  const { profiles, errors } = normalizeItems(fixture, ['salute.ia']);
  assert.equal(errors.size, 0);
  const p = profiles.get('salute.ia');
  assert.equal(p.followers, 1148);
  assert.equal(p.postsCount, 24);
  assert.equal(p.posts.length, 12);
  assert.deepEqual(
    [...new Set(p.posts.map((x) => x.type))].sort(),
    ['carousel', 'image', 'video'],
  );
  // Caso real: Dez3gYXljqK tem curtidas ocultas (Apify devolveu -1)
  const hidden = p.posts.find((x) => x.shortCode === 'Dez3gYXljqK');
  assert.equal(hidden.likesHidden, true);
  assert.equal(hidden.likes, null);
  assert.equal(hidden.comments, 4);
  const video = p.posts.find((x) => x.shortCode === 'DfU58YvRiKL');
  assert.equal(video.type, 'video');
  assert.equal(video.likes, 24);
  assert.equal(video.comments, 8);
  assert.ok(video.videoUrl);
});

test('@ pedido sem dado utilizável vira erro com motivo, nunca dado inventado', () => {
  const { profiles, errors } = normalizeItems(
    [{ inputUrl: 'https://www.instagram.com/nao.existe', error: 'no_items', errorDescription: 'Empty or private data' }],
    ['nao.existe', 'outro.perfil'],
  );
  assert.equal(profiles.size, 0);
  assert.match(errors.get('nao.existe'), /no_items/);
  assert.match(errors.get('outro.perfil'), /não retornou dados/);
});

test('perfil sem followersCount não vira snapshot', () => {
  const { profiles, errors } = normalizeItems([{ username: 'x.y', latestPosts: [] }], ['x.y']);
  assert.equal(profiles.size, 0);
  assert.match(errors.get('x.y'), /seguidores/);
});

test('contagens ausentes viram null (nunca zero) e tipo desconhecido é "unknown"', () => {
  const post = normalizePost({ shortCode: 'abc', type: 'Reel?' }, 'x.y');
  assert.equal(post.likes, null);
  assert.equal(post.likesHidden, true);
  assert.equal(post.comments, null);
  assert.equal(post.type, 'unknown');
  assert.equal(post.timestamp, null);
  assert.equal(normalizePost({ type: 'Image' }, 'x.y'), null);
});
