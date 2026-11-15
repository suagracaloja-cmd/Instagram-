// Testa os cálculos de exibição do dashboard (web/src/lib/derive.ts), que rodam direto no Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, buildSeries, colorVar, flaggedWithin, followersDelta, niceTicks, periodStart } from '../../web/src/lib/derive.ts';

// Entradas sintéticas SÓ de teste das fórmulas (nunca chegam a data/).
const snap = (date, handle, followers, avgEngagement = 0.01) => ({
  date, handle, followers, following: null, postsCount: null, avgEngagement, postsConsidered: 5, collectedAt: `${date}T09:00:00Z`,
});

const snaps = [
  snap('2026-10-01', 'a', 1000),
  snap('2026-11-01', 'a', 1100),
  snap('2026-11-10', 'a', 1150, null), // engajamento sem dado
  snap('2026-11-14', 'a', 1200),
  snap('2026-11-14', 'b', 5000),
];
const today = '2026-11-14';

test('janela de período: 7/30/90 dias e "tudo"', () => {
  assert.equal(periodStart(7, today), '2026-11-07');
  assert.equal(periodStart(30, today), '2026-10-15');
  assert.equal(periodStart('all', today), null);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('buildSeries respeita o período e mantém a ordem dos perfis', () => {
  const all = buildSeries(snaps, ['a', 'b'], 'followers', 'all', today);
  assert.deepEqual(all.map((s) => s.handle), ['a', 'b']);
  assert.equal(all[0].points.length, 4);
  const d30 = buildSeries(snaps, ['a'], 'followers', 30, today);
  assert.deepEqual(d30[0].points.map((p) => p.date), ['2026-11-01', '2026-11-10', '2026-11-14']);
  const d7 = buildSeries(snaps, ['a'], 'followers', 7, today);
  assert.deepEqual(d7[0].points.map((p) => p.date), ['2026-11-10', '2026-11-14']);
});

test('engajamento sem dado NÃO vira ponto zero', () => {
  const [s] = buildSeries(snaps, ['a'], 'engagement', 'all', today);
  assert.equal(s.points.length, 3);
  assert.ok(!s.points.some((p) => p.date === '2026-11-10'));
});

test('crescimento %: índice comum desde o 1º ponto da janela', () => {
  const [s] = buildSeries(snaps, ['a'], 'growth', 30, today);
  assert.equal(s.points[0].value, 0); // base
  assert.ok(Math.abs(s.points[2].value - (1200 / 1100 - 1)) < 1e-12);
  assert.equal(s.points[2].raw, 1200); // seguidores absolutos seguem disponíveis p/ o tooltip
  const [one] = buildSeries(snaps, ['b'], 'growth', 'all', today);
  assert.deepEqual(one.points.map((p) => p.value), [0]);
});

test('variação de seguidores: precisa de 2+ coletas na janela', () => {
  assert.equal(followersDelta(snaps, 'b', 'all', today), null);
  assert.deepEqual(followersDelta(snaps, 'a', 30, today), { delta: 100, from: '2026-11-01', to: '2026-11-14' });
  assert.equal(followersDelta(snaps, 'a', 'all', today).delta, 200);
});

test('"bombaram nos últimos 30 dias" conta pela data de publicação e só perfis ativos', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const f = (handle, timestamp) => ({ handle, timestamp });
  const flagged = [
    f('a', '2026-11-04T16:40:26.000Z'),
    f('a', '2026-09-01T10:00:00.000Z'), // fora da janela
    f('b', '2026-11-10T10:00:00.000Z'),
    f('removido', '2026-11-10T10:00:00.000Z'), // perfil que não é mais monitorado
    f('a', null), // sem data: não entra
  ];
  assert.equal(flaggedWithin(flagged, ['a', 'b'], 30, now).length, 2);
});

test('ticks do eixo Y são números redondos e cobrem os dados', () => {
  const t = niceTicks(1043, 1148, 4);
  assert.ok(t[0] <= 1043 && t[t.length - 1] >= 1148);
  assert.ok(t.length >= 3 && t.length <= 8);
  assert.deepEqual(niceTicks(0, 100, 4), [0, 25, 50, 75, 100]);
  const flat = niceTicks(1148, 1148, 4);
  assert.ok(flat[0] < 1148 && flat[flat.length - 1] > 1148, 'valor único ganha uma margem');
  assert.deepEqual(niceTicks(NaN, 1), []);
});

test('cor segue a posição do perfil (5 slots) e não o ranking', () => {
  assert.equal(colorVar(0), 'var(--series-1)');
  assert.equal(colorVar(4), 'var(--series-5)');
  assert.equal(colorVar(5), 'var(--series-1)');
});
