import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateInSaoPaulo, parseInstagramHandle } from '../../shared/instagram.js';

const ok = (input) => {
  const r = parseInstagramHandle(input);
  assert.equal(r.ok, true, `deveria aceitar: ${input} -> ${r.error}`);
  return r;
};
const bad = (input) => {
  const r = parseInstagramHandle(input);
  assert.equal(r.ok, false, `deveria recusar: ${input}`);
  assert.ok(r.error.length > 10);
};

test('extrai o @ do link do perfil (caso do pedido)', () => {
  const r = ok('https://www.instagram.com/salute.ia');
  assert.equal(r.handle, 'salute.ia');
  assert.equal(r.url, 'https://www.instagram.com/salute.ia/');
});

test('aceita variações comuns de link', () => {
  for (const input of [
    'https://www.instagram.com/salute.ia/',
    'https://instagram.com/Salute.IA/?igsh=abc123',
    'http://www.instagram.com/salute.ia#x',
    'www.instagram.com/salute.ia',
    'instagram.com/salute.ia',
    'https://m.instagram.com/salute.ia/',
    'https://www.instagram.com/salute.ia/reels/',
    '  @salute.ia  ',
    'salute.ia',
    'SALUTE.IA',
  ]) {
    assert.equal(ok(input).handle, 'salute.ia', input);
  }
});

test('recusa links que não são de perfil', () => {
  for (const input of [
    '',
    '   ',
    null,
    undefined,
    42,
    'https://www.instagram.com/',
    'https://www.instagram.com/p/DfU58YvRiKL/',
    'https://www.instagram.com/reel/DfU58YvRiKL/',
    'https://www.instagram.com/explore/tags/clinica/',
    'https://www.instagram.com/stories/salute.ia/123/',
    'https://twitter.com/salute.ia',
    'https://evil.example/instagram.com/salute.ia',
    'instagram.com',
    'nome com espaco',
    'a'.repeat(31),
    'user!name',
  ]) {
    bad(input);
  }
});

test('dateInSaoPaulo usa o dia de Brasília, não o UTC', () => {
  // 01:30 UTC de 15/11 ainda é 22:30 de 14/11 em São Paulo (UTC-3)
  assert.equal(dateInSaoPaulo(new Date('2026-11-15T01:30:00Z')), '2026-11-14');
  assert.equal(dateInSaoPaulo(new Date('2026-11-15T09:17:00Z')), '2026-11-15');
});
