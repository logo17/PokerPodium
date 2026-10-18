import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGame, validatePlaces, randomSeating, aggregateStats } from '../public/js/calc.js';

const game = (over = {}) => ({ buy_in: 10000, rebuy: 10000, dealer_fee: 2000, places: [70], rounding: 1000, status: 'finished', ...over });
const entry = (player_id, rebuys = 0, position = null, extra = {}) => ({ id: player_id, player_id, name: `P${player_id}`, rebuys, position, prize_override: null, paid: false, ...extra });

test('bote, premio del 1° con 70% y resto al fondo', () => {
  const s = computeGame(game(), [entry(1, 2, 1), entry(2, 1, 2), entry(3)]);
  assert.equal(s.pot, 60000); // 3 entradas + 3 recompras
  assert.equal(s.payouts[0].amount, 42000);
  assert.equal(s.fund, 18000);
  assert.equal(s.dealerTotal, 6000);
  const winner = s.entries.find((e) => e.player_id === 1);
  assert.equal(winner.spent, 32000);
  assert.equal(winner.net, 10000);
});

test('redondeo hacia abajo manda el sobrante al fondo', () => {
  const s = computeGame(game({ places: [50, 30, 20] }), [1, 2, 3, 4, 5, 6, 7].map((i) => entry(i, 0, i <= 3 ? i : null)));
  // bote 70000 → 35000 / 21000 / 14000 exactos
  assert.deepEqual(s.payouts.map((p) => p.amount), [35000, 21000, 14000]);
  const s2 = computeGame(game({ places: [65, 35] }), [entry(1, 0, 1), entry(2, 0, 2), entry(3, 1)]);
  // bote 40000 → 26000 / 14000
  assert.deepEqual(s2.payouts.map((p) => p.amount), [26000, 14000]);
  const s3 = computeGame(game({ places: [60, 40] }), [entry(1, 0, 1), entry(2, 0, 2), entry(3, 0, 3)]);
  // bote 30000 → 18000 / 12000 ; con places 60/40 no sobra
  assert.equal(s3.fund, 0);
  const s4 = computeGame(game({ places: [66.6, 33.4] }), [entry(1, 0, 1), entry(2, 0, 2), entry(3)]);
  assert.deepEqual(s4.payouts.map((p) => p.amount), [19000, 10000]);
  assert.equal(s4.fund, 1000);
});

test('premios manuales (chop)', () => {
  const s = computeGame(game(), [entry(1, 0, 1, { prize_override: 15000 }), entry(2, 0, 2, { prize_override: 12000 }), entry(3, 0, null, { prize_override: 0 })]);
  assert.equal(s.manual, true);
  assert.equal(s.prizesTotal, 27000);
  assert.equal(s.fund, 3000);
});

test('advertencias', () => {
  const s = computeGame(game({ places: [60, 40] }), [entry(1, 0, 1), entry(2)]);
  assert.ok(s.warnings.some((w) => w.includes('2°')));
  const s2 = computeGame(game(), [entry(1, 0, 1), entry(2, 0, 1)]);
  assert.ok(s2.warnings.some((w) => w.includes('repetidas')));
});

test('validatePlaces rechaza más de 100%', () => {
  assert.throws(() => validatePlaces([70, 40]), /100%/);
  assert.deepEqual(validatePlaces([50, 30, 20]), [50, 30, 20]);
});

test('randomSeating reparte parejo en varias mesas sin perder jugadores', () => {
  const ids = Array.from({ length: 19 }, (_, i) => i + 1);
  const tables = randomSeating(ids, { seatsPerTable: 9 });
  assert.equal(tables.length, 3);
  assert.deepEqual(tables.map((t) => t.seats.length).sort(), [6, 6, 7]);
  assert.deepEqual(tables.flatMap((t) => t.seats).sort((a, b) => a - b), ids);
  for (const t of tables) assert.ok(t.button >= 0 && t.button < t.seats.length);
  assert.equal(randomSeating(ids, { tables: 2 }).length, 2);
});

test('validatePlaces exige al menos un porcentaje', () => {
  assert.throws(() => validatePlaces([]), /al menos/);
});

test('aggregateStats suma por jugador y detecta récords', () => {
  const g1 = { id: 1, date: '2026-01-10', ...game() };
  const g2 = { id: 2, date: '2026-01-24', ...game({ places: [60, 40] }) };
  const games = [
    { game: g1, summary: computeGame(g1, [entry(1, 2, 1), entry(2, 0, 2), entry(3)]) },
    { game: g2, summary: computeGame(g2, [entry(1, 0, 2), entry(2, 3, 1), entry(3)]) },
  ];
  const s = aggregateStats(games);
  assert.equal(s.totals.games, 2);
  assert.equal(s.totals.players, 3);
  const p1 = s.players.find((p) => p.player_id === 1);
  assert.equal(p1.games, 2);
  assert.equal(p1.wins, 1);
  assert.equal(p1.seconds, 1);
  assert.equal(p1.rebuys, 2);
  assert.equal(s.records.mostRebuys.value, 3);
  assert.equal(s.records.mostRebuys.name, 'P2');
  const netSum = s.players.reduce((a, p) => a + p.net, 0);
  assert.equal(netSum, -(s.totals.fund + s.totals.dealer)); // lo que pierde el grupo = fondo + dealer
});
