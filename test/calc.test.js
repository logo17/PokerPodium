import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGame, validatePlaces, randomSeating, aggregateStats, blindState, clockAfter, parseLevels, validateLevels, DEFAULT_BLINDS, blindSettings } from '../public/js/calc.js';

const game = (over = {}) => ({ buy_in: 10000, rebuy: 10000, dealer_fee: 2000, places: [70], status: 'finished', ...over });
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

test('premios exactos por porcentaje, sin redondeo', () => {
  const s = computeGame(game({ places: [50, 30, 20] }), [1, 2, 3, 4, 5, 6, 7].map((i) => entry(i, 0, i <= 3 ? i : null)));
  assert.deepEqual(s.payouts.map((p) => p.amount), [35000, 21000, 14000]);
  assert.equal(s.fund, 0);
  const s2 = computeGame(game({ places: [66.6, 33.4] }), [entry(1, 0, 1), entry(2, 0, 2), entry(3)]);
  // bote 30000 → 19980 / 10020, nada se redondea a miles
  assert.deepEqual(s2.payouts.map((p) => p.amount), [19980, 10020]);
  assert.equal(s2.fund, 0);
  const s3 = computeGame(game({ places: [60, 30] }), [entry(1, 0, 1), entry(2, 0, 2), entry(3, 1)]);
  // bote 40000 → 24000 / 12000, el 10% restante al fondo
  assert.deepEqual(s3.payouts.map((p) => p.amount), [24000, 12000]);
  assert.equal(s3.fund, 4000);
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

// ---------- Ciegas ----------

const T0 = Date.parse('2026-11-07T20:00:00Z');
const MIN = 60000;
const bgame = (clock, over = {}) => ({ blind_levels: DEFAULT_BLINDS, blind_minutes: 45, blind_on_elimination: true, clock, ...over });

test('reloj sin iniciar: nivel 1 con el tiempo completo', () => {
  const s = blindState(bgame(null), T0);
  assert.equal(s.level, 0);
  assert.deepEqual(s.current, { sb: 50, bb: 100 });
  assert.deepEqual(s.next, { sb: 100, bb: 200 });
  assert.equal(s.remainingMs, 45 * MIN);
  assert.equal(s.started, false);
});

test('las ciegas suben solas con el tiempo y se detienen en el tope', () => {
  const g = bgame(clockAfter(bgame(null), 'start', T0));
  assert.equal(blindState(g, T0 + 44 * MIN).level, 0);
  const s = blindState(g, T0 + 46 * MIN);
  assert.equal(s.level, 1);
  assert.equal(s.remainingMs, 44 * MIN);
  const end = blindState(g, T0 + 10 * 60 * MIN);
  assert.equal(end.level, 6);
  assert.deepEqual(end.current, { sb: 2500, bb: 5000 });
  assert.equal(end.atMax, true);
  assert.equal(end.next, null);
  assert.equal(end.remainingMs, null);
});

test('pausa congela el tiempo y reanudar sigue donde iba', () => {
  let g = bgame(clockAfter(bgame(null), 'start', T0));
  g = bgame(clockAfter(g, 'pause', T0 + 10 * MIN));
  assert.equal(blindState(g, T0 + 500 * MIN).remainingMs, 35 * MIN);
  assert.equal(blindState(g, T0 + 500 * MIN).level, 0);
  g = bgame(clockAfter(g, 'resume', T0 + 60 * MIN));
  assert.equal(blindState(g, T0 + 70 * MIN).remainingMs, 25 * MIN);
});

test('subir/bajar nivel reinicia el tiempo del nivel y respeta los límites', () => {
  let g = bgame(clockAfter(bgame(null), 'start', T0));
  g = bgame(clockAfter(g, 'up', T0 + 20 * MIN));
  let s = blindState(g, T0 + 20 * MIN);
  assert.equal(s.level, 1);
  assert.equal(s.remainingMs, 45 * MIN);
  assert.equal(s.running, true);
  g = bgame(clockAfter(g, 'down', T0 + 21 * MIN));
  g = bgame(clockAfter(g, 'down', T0 + 22 * MIN));
  assert.equal(blindState(g, T0 + 22 * MIN).level, 0);
  // subir sin haber iniciado deja el reloj en pausa en el nivel 2
  s = blindState(bgame(clockAfter(bgame(null), 'up', T0)), T0 + 99 * MIN);
  assert.equal(s.level, 1);
  assert.equal(s.running, false);
  assert.equal(clockAfter(g, 'reset', T0), null);
});

test('con 0 minutos las ciegas solo suben a mano o al eliminar', () => {
  const g = bgame(clockAfter(bgame(null), 'start', T0), { blind_minutes: 0 });
  const s = blindState(g, T0 + 600 * MIN);
  assert.equal(s.level, 0);
  assert.equal(s.remainingMs, null);
});

test('parseLevels acepta chica/grande o grande-chica', () => {
  assert.deepEqual(parseLevels('100-50, 200-100\n400 / 200'), [{ sb: 50, bb: 100 }, { sb: 100, bb: 200 }, { sb: 200, bb: 400 }]);
  assert.throws(() => validateLevels([]), /al menos/);
  assert.throws(() => validateLevels([{ sb: 0, bb: 100 }]), /mayores a 0/);
});

test('blindSettings usa la estructura por defecto si no hay ajustes', () => {
  assert.deepEqual(blindSettings({}), { levels: DEFAULT_BLINDS, minutes: 45, onElimination: true });
  assert.deepEqual(blindSettings({ blind_minutes: '60', blind_on_elimination: 'false', blind_levels: '[{"sb":25,"bb":50}]' }), {
    levels: [{ sb: 25, bb: 50 }], minutes: 60, onElimination: false,
  });
});
