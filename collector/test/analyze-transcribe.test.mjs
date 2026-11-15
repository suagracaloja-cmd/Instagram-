import assert from 'node:assert/strict';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { analyzeHook, buildPrompt } from '../lib/analyze.mjs';
import { downloadVideo, transcribeVideo } from '../lib/transcribe.mjs';

const entry = {
  handle: 'salute.ia',
  type: 'video',
  timestamp: '2026-11-04T16:40:26.000Z',
  likes: 24,
  comments: 8,
  engagement: 32 / 1148,
  baseline: 6.8 / 1148,
  baselinePosts: 10,
  multiple: 32 / 6.8,
  caption: 'Doutor, doutora, e se a sua clínica funcionasse sozinha?',
};

const fakeClient = (handlers = {}) => ({
  beta: { messages: { create: handlers.beta ?? (async () => ({ stop_reason: 'end_turn', model: 'm', content: [{ type: 'text', text: 'Gancho de pergunta provocativa.' }] })) } },
  messages: { create: handlers.plain ?? (async () => ({ stop_reason: 'end_turn', model: 'm', content: [{ type: 'text', text: 'Resposta simples.' }] })) },
});

test('prompt: legenda real, formato, múltiplo; vídeo sem transcrição avisa que está INDISPONÍVEL', () => {
  const p = buildPrompt(entry, null);
  assert.match(p, /<legenda>\nDoutor, doutora/);
  assert.match(p, /Formato: vídeo/);
  assert.match(p, /4,7x a média/);
  assert.match(p, /INDISPONÍVEL/);
  assert.match(p, /APENAS na legenda/);
  const withT = buildPrompt(entry, 'olá, tudo bem');
  assert.match(withT, /<transcricao>\nolá, tudo bem/);
  assert.doesNotMatch(withT, /INDISPONÍVEL/);
});

test('análise ok usa o SDK e devolve o texto do modelo', async () => {
  let params;
  const client = fakeClient({ beta: async (p) => ((params = p), { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: ' Gancho forte. ' }] }) });
  const r = await analyzeHook(entry, null, { client });
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'Gancho forte.');
  assert.equal(r.basis, 'caption');
  assert.equal(params.model, 'claude-opus-5-5');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.equal(params.output_config.effort, 'low');
  assert.equal('thinking' in params, false, 'Opus 5.5 não aceita thinking desativado');
  assert.equal('temperature' in params, false);
});

test('base da análise muda para transcript+caption quando há transcrição', async () => {
  const r = await analyzeHook(entry, 'texto falado', { client: fakeClient() });
  assert.equal(r.basis, 'transcript+caption');
});

test('recusa do modelo vira status "refused", sem texto', async () => {
  const client = fakeClient({ beta: async () => ({ stop_reason: 'refusal', content: [] }) });
  const r = await analyzeHook(entry, null, { client });
  assert.equal(r.status, 'refused');
  assert.equal(r.text, undefined);
});

test('se a API recusar o parâmetro de fallback (400), repete o pedido simples', async () => {
  const client = fakeClient({
    beta: async () => {
      throw Anthropic.APIError.generate(400, { error: { message: 'bad' } }, 'bad request', new Headers());
    },
  });
  const r = await analyzeHook(entry, null, { client });
  assert.equal(r.status, 'ok');
  assert.equal(r.text, 'Resposta simples.');
});

test('chave inválida e limite de uso viram mensagens claras', async () => {
  const auth = fakeClient({ beta: async () => { throw Anthropic.APIError.generate(401, { error: { message: 'x' } }, 'x', new Headers()); } });
  assert.match((await analyzeHook(entry, null, { client: auth })).note, /ANTHROPIC_API_KEY foi recusada/);
  const rate = fakeClient({ beta: async () => { throw Anthropic.APIError.generate(429, { error: { message: 'x' } }, 'x', new Headers()); } });
  assert.match((await analyzeHook(entry, null, { client: rate })).note, /Limite de uso/);
});

test('sem chave => "unavailable"; sem legenda nem transcrição => não inventa nada', async () => {
  assert.equal((await analyzeHook(entry, null, { apiKey: '' })).status, 'unavailable');
  const r = await analyzeHook({ ...entry, caption: '   ' }, null, { client: fakeClient() });
  assert.equal(r.status, 'unavailable');
  assert.match(r.note, /nem transcrição/);
});

// ---------- Download e transcrição ----------
const fakeRes = ({ ok = true, status = 200, type = 'video/mp4', length, body = Buffer.from('fakevideo') } = {}) => ({
  ok,
  status,
  headers: { get: (k) => ({ 'content-type': type, 'content-length': length }[k.toLowerCase()] ?? null) },
  arrayBuffer: async () => body,
});

test('download: HTTP 403 do CDN vira motivo legível', async () => {
  const r = await downloadVideo('https://cdn.invalid/v.mp4', { fetchImpl: async () => fakeRes({ ok: false, status: 403 }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 403/);
});

test('download: resposta que não é vídeo (ex.: HTML de bloqueio) é recusada', async () => {
  const r = await downloadVideo('https://cdn.invalid/v.mp4', { fetchImpl: async () => fakeRes({ type: 'text/html' }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /não devolveu um vídeo/);
});

test('download: erro de rede/timeout vira motivo legível', async () => {
  const r = await downloadVideo('https://cdn.invalid/v.mp4', {
    fetchImpl: async () => {
      throw Object.assign(new Error('x'), { name: 'TimeoutError' });
    },
  });
  assert.match(r.reason, /tempo esgotado/);
});

test('transcrição: vídeo não baixa => "unavailable" com aviso claro (transcrição fica em branco)', async () => {
  const r = await transcribeVideo('https://cdn.invalid/v.mp4', { fetchImpl: async () => fakeRes({ ok: false, status: 403 }) });
  assert.equal(r.status, 'unavailable');
  assert.match(r.note, /^Não foi possível baixar o vídeo/);
});

test('transcrição: sucesso devolve o texto do Whisper', async () => {
  const exec = async () => ({ stdout: 'ruído de log\n{"language":"pt","text":" Olá, doutor. "}\n' });
  const r = await transcribeVideo('https://cdn.invalid/v.mp4', { fetchImpl: async () => fakeRes(), exec });
  assert.deepEqual(r, { status: 'ok', text: 'Olá, doutor.', language: 'pt' });
});

test('transcrição: vídeo sem fala => "no_speech"', async () => {
  const exec = async () => ({ stdout: '{"language":"en","text":""}\n' });
  const r = await transcribeVideo('https://cdn.invalid/v.mp4', { fetchImpl: async () => fakeRes(), exec });
  assert.equal(r.status, 'no_speech');
});

test('transcrição: instala o faster-whisper na primeira vez e tenta de novo', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(args.join(' '));
    if (args[0].endsWith('whisper_transcribe.py') && calls.filter((c) => c.includes('whisper_transcribe')).length === 1) {
      throw Object.assign(new Error('falhou'), { stderr: "ModuleNotFoundError: No module named 'faster_whisper'" });
    }
    return { stdout: '{"language":"pt","text":"ok"}' };
  };
  const r = await transcribeVideo('https://cdn.invalid/v.mp4', { fetchImpl: async () => fakeRes(), exec });
  assert.equal(r.status, 'ok');
  assert.ok(calls.some((c) => c.includes('pip install')));
});

test('transcrição: erro do Whisper vira "unavailable" com o motivo', async () => {
  const exec = async () => {
    throw Object.assign(new Error('falhou'), { stderr: 'RuntimeError: modelo não baixou' });
  };
  const r = await transcribeVideo('https://cdn.invalid/v.mp4', { fetchImpl: async () => fakeRes(), exec });
  assert.equal(r.status, 'unavailable');
  assert.match(r.note, /transcrição falhou: RuntimeError/);
});
