import assert from 'node:assert/strict';
import { test } from 'node:test';
import { averageEngagement, detectFlags, engagementOf, mean } from '../lib/metrics.mjs';

const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ''} esperado ${expected}, veio ${actual}`);

// Entradas sintéticas SÓ de teste unitário das fórmulas (nunca chegam a data/).
const post = (shortCode, likes, comments, extra = {}) => ({
  shortCode,
  likes,
  comments,
  timestamp: `2026-10-${String(10 + Number(shortCode.slice(1))).padStart(2, '0')}T12:00:00.000Z`,
  ...extra,
});

test('engajamento = (curtidas + comentários) / seguidores', () => {
  near(engagementOf(post('p1', 90, 10), 1000), 0.1);
});

test('curtidas ocultas (null/negativas) NÃO entram: engajamento é null, não zero', () => {
  assert.equal(engagementOf(post('p1', null, 4), 1000), null);
  assert.equal(engagementOf(post('p1', -1, 4), 1000), null);
  assert.equal(engagementOf(post('p1', 5, null), 1000), null);
});

test('seguidores inválidos => null (nunca divide por zero)', () => {
  assert.equal(engagementOf(post('p1', 5, 1), 0), null);
  assert.equal(engagementOf(post('p1', 5, 1), undefined), null);
});

test('média ignora posts com curtidas ocultas', () => {
  const posts = [post('p1', 10, 0), post('p2', -1, 99), post('p3', 20, 0)];
  const { average, count } = averageEngagement(posts, 100);
  assert.equal(count, 2);
  near(average, 0.15);
  assert.equal(mean([]), null);
});

const base = [post('p1', 10, 0), post('p2', 10, 0), post('p3', 10, 0), post('p4', 10, 0), post('p5', 10, 0)];

test('sinaliza quando engajamento > 2x a média dos OUTROS posts', () => {
  const big = post('p6', 31, 0); // 3,1x a média dos 5 outros (10 cada)
  const [flag, ...rest] = detectFlags({ candidates: [big], knownPosts: [...base, big], followers: 100, alreadyFlagged: new Set() });
  assert.equal(rest.length, 0);
  assert.equal(flag.post.shortCode, 'p6');
  assert.ok(Math.abs(flag.multiple - 3.1) < 1e-9);
  assert.equal(flag.baselinePosts, 5);
});

test('exatamente 2x NÃO sinaliza (a regra é "maior que" 2x)', () => {
  const edge = post('p6', 20, 0); // média dos outros = 10 => 2,0x exato
  const flags = detectFlags({ candidates: [edge], knownPosts: [...base, edge], followers: 100, alreadyFlagged: new Set() });
  assert.equal(flags.length, 0);
});

test('nunca duplica: shortCode já sinalizado é ignorado', () => {
  const big = post('p6', 60, 0);
  const flags = detectFlags({
    candidates: [big],
    knownPosts: [...base, big],
    followers: 100,
    alreadyFlagged: new Set(['p6']),
  });
  assert.equal(flags.length, 0);
});

test('post com curtidas ocultas nunca é sinalizado', () => {
  const hidden = post('p6', -1, 500);
  const flags = detectFlags({ candidates: [hidden], knownPosts: [...base, hidden], followers: 100, alreadyFlagged: new Set() });
  assert.equal(flags.length, 0);
});

test('sem base mínima de posts, não sinaliza (evita ruído)', () => {
  const few = [post('p1', 10, 0), post('p2', 10, 0)];
  const big = post('p3', 100, 0);
  const flags = detectFlags({ candidates: [big], knownPosts: [...few, big], followers: 100, alreadyFlagged: new Set() });
  assert.equal(flags.length, 0);
});

test('o próprio post não entra na média que ele precisa superar', () => {
  // Se o p6 entrasse na própria média: média = (50+30)/6 ≈ 13.3 e 2x = 26.7; ainda sinaliza,
  // mas o baseline registrado tem que ser o dos outros (10 por post = 0.10).
  const big = post('p6', 30, 0);
  const [flag] = detectFlags({ candidates: [big], knownPosts: [...base, big], followers: 100, alreadyFlagged: new Set() });
  near(flag.baseline, 0.1);
  assert.equal(flag.baselinePosts, 5);
  near(flag.multiple, 3);
});
