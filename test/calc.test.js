import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGame, validatePlaces, randomSeating, aggregateStats, blindState, clockAfter, parseLevels, validateLevels, DEFAULT_BLINDS, blindSettings, canMergeTables, finalTableSize } from '../public/js/calc.js';

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
  assert.deepEqual(blindSettings({}), { levels: DEFAULT_BLINDS, minutes: 45, onElimination: true, totalMinutes: 240 });
  assert.deepEqual(blindSettings({ blind_minutes: '60', blind_on_elimination: 'false', blind_levels: '[{"sb":25,"bb":50}]', total_minutes: '180' }), {
    levels: [{ sb: 25, bb: 50 }], minutes: 60, onElimination: false, totalMinutes: 180,
  });
});

// ---------- Tiempo total de la partida ----------

const tgame = (clock, over = {}) => bgame(clock, { total_minutes: 240, ...over });

test('tiempo total: corre con el reloj y se detiene con la pausa', () => {
  let g = tgame(clockAfter(tgame(null), 'start', T0));
  assert.equal(blindState(tgame(null), T0).totalRemainingMs, 240 * MIN);
  assert.equal(blindState(g, T0 + 60 * MIN).totalRemainingMs, 180 * MIN);
  g = tgame(clockAfter(g, 'pause', T0 + 60 * MIN));
  assert.equal(blindState(g, T0 + 200 * MIN).totalRemainingMs, 180 * MIN); // en pausa no corre
  g = tgame(clockAfter(g, 'resume', T0 + 200 * MIN));
  assert.equal(blindState(g, T0 + 230 * MIN).totalRemainingMs, 150 * MIN);
});

test('tiempo total: subir o bajar de nivel no lo reinicia', () => {
  let g = tgame(clockAfter(tgame(null), 'start', T0));
  g = tgame(clockAfter(g, 'up', T0 + 20 * MIN));
  g = tgame(clockAfter(g, 'down', T0 + 50 * MIN));
  const s = blindState(g, T0 + 70 * MIN);
  assert.equal(s.totalElapsedMs, 70 * MIN);
  assert.equal(s.elapsedInLevel, 20 * MIN); // el nivel sí arrancó de cero al bajar
});

test('tiempo total: al cumplirse marca timeUp y sigue contando el excedente', () => {
  const g = tgame(clockAfter(tgame(null), 'start', T0));
  assert.equal(blindState(g, T0 + 239 * MIN).timeUp, false);
  const s = blindState(g, T0 + 250 * MIN);
  assert.equal(s.timeUp, true);
  assert.equal(s.totalRemainingMs, 0);
  assert.equal(s.totalElapsedMs - s.totalMs, 10 * MIN);
});

test('tiempo total en 0 = sin límite; relojes viejos sin total_offset_ms siguen funcionando', () => {
  const g = tgame(clockAfter(tgame(null), 'start', T0), { total_minutes: 0 });
  const s = blindState(g, T0 + 999 * MIN);
  assert.equal(s.totalRemainingMs, null);
  assert.equal(s.timeUp, false);
  const old = tgame({ level: 1, offset_ms: 0, anchor: new Date(T0).toISOString(), running: true });
  assert.equal(blindState(old, T0 + 30 * MIN).totalRemainingMs, 210 * MIN);
});

// ---------- Unir mesas ----------

const mgame = (aliveCount, total, tables, over = {}) => ({
  status: 'open',
  seating: tables ? { tables: Array.from({ length: tables }, (_, i) => ({ table: i + 1, seats: [] })) } : null,
  summary: { entries: Array.from({ length: total }, (_, i) => ({ player_id: i + 1, eliminated_at: i < total - aliveCount ? '2026-11-07T21:00:00Z' : null })) },
  ...over,
});

test('se sugiere unir con 10 o menos en juego y más de una mesa', () => {
  assert.equal(canMergeTables(mgame(11, 18, 2), 10).can, false);
  assert.deepEqual(canMergeTables(mgame(10, 18, 2), 10), { alive: 10, tables: 2, can: true });
  assert.equal(canMergeTables(mgame(8, 18, 1), 10).can, false); // ya es una sola mesa
  assert.equal(canMergeTables(mgame(8, 18, 0), 10).can, false); // sin mesas sorteadas
  assert.equal(canMergeTables(mgame(1, 18, 2), 10).can, false); // ya hay ganador
  assert.equal(canMergeTables(mgame(8, 18, 2, { status: 'finished' }), 10).can, false);
  assert.equal(canMergeTables(mgame(12, 18, 2), 12).can, true); // umbral configurable
});

test('finalTableSize: 10 por defecto, o lo configurado en Ajustes', () => {
  assert.equal(finalTableSize({}), 10);
  assert.equal(finalTableSize({ final_table_size: '8' }), 8);
  assert.equal(finalTableSize({ final_table_size: 'x' }), 10);
});

test('una sola mesa con todos los que siguen y botón válido', () => {
  const ids = [3, 5, 8, 9, 11, 14, 15];
  const [t, ...rest] = randomSeating(ids, { tables: 1 });
  assert.equal(rest.length, 0);
  assert.deepEqual([...t.seats].sort((a, b) => a - b), ids);
  assert.ok(t.button >= 0 && t.button < ids.length);
});
