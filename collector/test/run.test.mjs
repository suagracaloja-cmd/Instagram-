import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeHook } from '../lib/analyze.mjs';
import { normalizeItems } from '../lib/apify.mjs';
import { runCollection } from '../lib/run.mjs';
import { createStore } from '../lib/store.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/apify-salute-ia.json', import.meta.url), 'utf8'));
const quiet = () => {};
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `esperado ${b}, veio ${a}`);

async function setup(handles = ['salute.ia']) {
  const dir = await mkdtemp(path.join(tmpdir(), 'igmon-test-'));
  await writeFile(
    path.join(dir, 'profiles.json'),
    JSON.stringify({ profiles: handles.map((handle) => ({ handle, addedAt: '2026-11-14' })) }),
  );
  return { dir, store: createStore(dir), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function deps(overrides = {}) {
  const calls = { transcribe: [], analyze: [] };
  return {
    calls,
    deps: {
      log: quiet,
      scrape: async (handles) => normalizeItems(fixture, handles),
      transcribe: async (url) => {
        calls.transcribe.push(url);
        return { status: 'unavailable', note: 'Não foi possível baixar o vídeo: o CDN do Instagram recusou o download do vídeo (HTTP 403).' };
      },
      analyze: async (entry, transcript) => {
        calls.analyze.push({ shortCode: entry.shortCode, transcript });
        return { status: 'ok', basis: transcript ? 'transcript+caption' : 'caption', text: 'Análise de teste.', model: 'modelo-teste' };
      },
      ...overrides,
    },
  };
}

test('1ª coleta com dados reais: seguidores, snapshot, média sem curtidas ocultas e UM post sinalizado', async () => {
  const { store, cleanup } = await setup();
  try {
    const { deps: d } = deps();
    const result = await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...d });
    assert.equal(result.exitCode, 0);
    assert.equal(result.status, 'ok');

    const accounts = await store.read('accounts.json');
    assert.equal(accounts['salute.ia'].followers, 1148);
    assert.equal(accounts['salute.ia'].status, 'ok');

    const snaps = await store.read('snapshots.json');
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].date, '2026-11-14');
    assert.equal(snaps[0].followers, 1148);
    assert.equal(snaps[0].postsConsidered, 11); // 12 posts - 1 com curtidas ocultas
    near(snaps[0].avgEngagement, 100 / 11 / 1148); // soma de (curtidas+comentários) dos 11 = 100

    const posts = await store.read('posts.json');
    assert.equal(Object.keys(posts).length, 12);
    assert.equal(posts.Dez3gYXljqK.likesHidden, true);
    assert.ok(!('videoUrl' in posts.DfU58YvRiKL), 'o link do CDN expira: não pode ser gravado');

    const flagged = await store.read('flagged.json');
    assert.deepEqual(flagged.map((f) => f.shortCode), ['DfU58YvRiKL']);
    const f = flagged[0];
    assert.equal(f.type, 'video');
    near(f.multiple, 32 / 6.8); // 32 interações vs média 6,8 dos outros 10 posts
    near(f.baseline, 6.8 / 1148);
    assert.equal(f.baselinePosts, 10);
    // Vídeo sem transcrição: motivo real registrado, análise só com a legenda
    assert.equal(f.transcriptStatus, 'unavailable');
    assert.equal(f.transcript, null);
    assert.match(f.transcriptNote, /Não foi possível/);
    assert.equal(f.analysisBasis, 'caption');
    assert.equal(f.analysisStatus, 'ok');
  } finally {
    await cleanup();
  }
});

test('o post DfqWLXxxbNV (16 vs 16,8 = 1,9x) NÃO é sinalizado: regra é > 2x', async () => {
  const { store, cleanup } = await setup();
  try {
    await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...deps().deps });
    const flagged = await store.read('flagged.json');
    assert.ok(!flagged.some((f) => f.shortCode === 'DfqWLXxxbNV'));
  } finally {
    await cleanup();
  }
});

test('rodar de novo no mesmo dia não duplica snapshot nem sinalização', async () => {
  const { store, cleanup } = await setup();
  try {
    const { deps: d, calls } = deps();
    await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...d });
    await runCollection({ store, now: new Date('2026-11-14T18:00:00Z'), ...d });
    assert.equal((await store.read('snapshots.json')).length, 1);
    const flagged = await store.read('flagged.json');
    assert.equal(flagged.length, 1);
    assert.equal(calls.analyze.length, 1, 'análise já ok não é refeita');
    assert.equal(flagged[0].transcriptAttempts, 2, 'transcrição indisponível é tentada de novo');
    const meta = await store.read('meta.json');
    assert.equal(meta.runs.length, 2);
  } finally {
    await cleanup();
  }
});

test('no dia seguinte vira 2º ponto do histórico; transcrição que enfim funciona refaz a análise com ela', async () => {
  const { store, cleanup } = await setup();
  try {
    const first = deps();
    await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...first.deps });

    const second = deps({
      transcribe: async () => ({ status: 'ok', text: 'Doutor, e se a sua clínica funcionasse sozinha?', language: 'pt' }),
    });
    await runCollection({ store, now: new Date('2026-11-15T12:00:00Z'), ...second.deps });

    const snaps = await store.read('snapshots.json');
    assert.deepEqual(snaps.map((s) => s.date), ['2026-11-14', '2026-11-15']);
    const [f] = await store.read('flagged.json');
    assert.equal(f.transcriptStatus, 'ok');
    assert.equal(f.transcript, 'Doutor, e se a sua clínica funcionasse sozinha?');
    assert.equal(f.analysisBasis, 'transcript+caption');
    assert.equal(second.calls.analyze[0].transcript, 'Doutor, e se a sua clínica funcionasse sozinha?');
  } finally {
    await cleanup();
  }
});

test('falha total da Apify: dados anteriores preservados, nenhum snapshot inventado, exit 1', async () => {
  const { store, cleanup } = await setup();
  try {
    await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...deps().deps });
    const before = await store.read('snapshots.json');

    const failing = deps({
      scrape: async () => {
        throw new Error('A Apify respondeu HTTP 503.');
      },
    });
    const result = await runCollection({ store, now: new Date('2026-11-15T12:00:00Z'), ...failing.deps });
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'failed');
    assert.deepEqual(await store.read('snapshots.json'), before);
    const accounts = await store.read('accounts.json');
    assert.equal(accounts['salute.ia'].status, 'error');
    assert.match(accounts['salute.ia'].error, /503/);
    assert.equal(accounts['salute.ia'].followers, 1148, 'último valor real é mantido, marcado como erro');
    const meta = await store.read('meta.json');
    assert.equal(meta.lastRun.status, 'failed');
  } finally {
    await cleanup();
  }
});

test('falha parcial: perfil que deu certo é gravado, o que falhou fica com o motivo', async () => {
  const { store, cleanup } = await setup(['salute.ia', 'nao.existe']);
  try {
    const result = await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...deps().deps });
    assert.equal(result.status, 'partial');
    assert.equal(result.exitCode, 0);
    const snaps = await store.read('snapshots.json');
    assert.deepEqual(snaps.map((s) => s.handle), ['salute.ia']);
    const accounts = await store.read('accounts.json');
    assert.equal(accounts['nao.existe'].status, 'error');
    assert.match(accounts['nao.existe'].error, /não retornou dados/);
  } finally {
    await cleanup();
  }
});

test('post de imagem sinalizado: sem transcrição, análise só pela legenda', async () => {
  const { store, cleanup } = await setup();
  try {
    const items = structuredClone(fixture);
    const image = items[0].latestPosts.find((p) => p.shortCode === 'Dfj-vValuCT');
    image.likesCount = 90; // vira o post de destaque (dado de teste, só neste teste)
    const { deps: d, calls } = deps({ scrape: async (h) => normalizeItems(items, h) });
    await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...d });
    const flagged = await store.read('flagged.json');
    const entry = flagged.find((f) => f.shortCode === 'Dfj-vValuCT');
    assert.ok(entry);
    assert.equal(entry.type, 'image');
    assert.equal(entry.transcriptStatus, 'not_applicable');
    assert.equal(entry.analysisBasis, 'caption');
    assert.ok(!calls.transcribe.includes(undefined));
    assert.equal(calls.analyze.find((c) => c.shortCode === 'Dfj-vValuCT').transcript, null);
  } finally {
    await cleanup();
  }
});

test('sem ANTHROPIC_API_KEY: post fica sinalizado, análise vazia com motivo (nada inventado)', async () => {
  const { store, cleanup } = await setup();
  try {
    const noKey = deps({ analyze: (entry, transcript) => analyzeHook(entry, transcript, { apiKey: '' }) });
    await runCollection({ store, now: new Date('2026-11-14T12:00:00Z'), ...noKey.deps });
    const [f] = await store.read('flagged.json');
    assert.equal(f.analysis, null);
    assert.equal(f.analysisStatus, 'unavailable');
    assert.match(f.analysisNote, /ANTHROPIC_API_KEY/);
  } finally {
    await cleanup();
  }
});

test('sem perfis monitorados: não faz nada e não falha', async () => {
  const { store, cleanup } = await setup([]);
  try {
    const result = await runCollection({ store, now: new Date(), ...deps().deps });
    assert.equal(result.status, 'idle');
    assert.equal(result.exitCode, 0);
  } finally {
    await cleanup();
  }
});
