// Capa de datos: todas las lecturas/escrituras a Supabase pasan por aquí.
// Los permisos los aplica la base de datos (RLS); aquí solo se traducen los errores.
import { supabase } from './supabase.js';
import { computeGame, validatePlaces, randomSeating, emptyStats, addEntry, finalizeStats, aggregateStats } from './calc.js';

const NO_PERMISSION = 'No tienes permiso para hacer cambios. Inicia sesión como administrador.';
const FRIENDLY = {
  23505: 'Ya existe un registro con ese valor (¿nombre repetido?).',
  23503: 'No se puede eliminar porque tiene partidas registradas. Desactívalo en lugar de eliminarlo.',
  23514: 'Algún valor no es válido.',
  42501: NO_PERMISSION,
  PGRST301: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

async function q(request) {
  const { data, error } = await request;
  if (error) throw new Error(FRIENDLY[error.code] || error.message);
  return data;
}

// Con RLS, un update/delete sin permiso no da error: simplemente no afecta filas.
async function mutate(request) {
  const data = await q(request);
  if (Array.isArray(data) && data.length === 0) throw new Error(NO_PERMISSION);
  return data;
}

const int = (v, field, { min = 0, nullable = false } = {}) => {
  if (nullable && (v === null || v === undefined || v === '')) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`Valor inválido para ${field}.`);
  return n;
};

const ENTRY_SELECT = 'id, game_id, player_id, rebuys, position, prize_override, paid, players(name, nickname)';

function normEntries(list) {
  return list
    .map(({ players, ...e }) => ({ ...e, name: players?.name ?? '?', nickname: players?.nickname ?? null }))
    .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.name.localeCompare(b.name, 'es'));
}

// Filtros: { year } | { from, to } | status: 'finished' (defecto) | 'open' | 'all'
function applyFilter(query, { year, from, to, status = 'finished' } = {}) {
  if (year && year !== 'all') query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);
  if (status !== 'all') query = query.eq('status', status);
  return query;
}

async function computedGames(filter) {
  const rows = await q(applyFilter(supabase.from('games').select(`*, entries(${ENTRY_SELECT})`), filter).order('date').order('id'));
  return rows.map(({ entries, ...game }) => ({ game, summary: computeGame(game, normEntries(entries)) }));
}

// ---------- Ajustes y plantillas ----------

export async function getSettings() {
  const rows = await q(supabase.from('settings').select('key, value'));
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
}

export async function saveSettings(values) {
  for (const k of ['buy_in', 'rebuy', 'dealer_fee']) if (k in values) int(values[k], k);
  if ('seats_per_table' in values) int(values.seats_per_table, 'asientos por mesa', { min: 2 });
  const rows = Object.entries(values).map(([key, value]) => ({ key, value: String(value ?? '') }));
  await mutate(supabase.from('settings').upsert(rows).select());
  return getSettings();
}

export const listTemplates = () => q(supabase.from('payout_templates').select('*').order('id'));

export async function saveTemplate(id, { name, places }) {
  name = String(name || '').trim();
  if (!name) throw new Error('El nombre es requerido.');
  const row = { name, places: validatePlaces(places) };
  if (id) return (await mutate(supabase.from('payout_templates').update(row).eq('id', id).select()))[0];
  return q(supabase.from('payout_templates').insert(row).select().single());
}

export async function deleteTemplate(id) {
  await mutate(supabase.from('payout_templates').delete().eq('id', id).select());
  return true;
}

// ---------- Jugadores ----------

export async function listPlayers() {
  const rows = await q(supabase.from('players').select('*, entries(count)').order('name'));
  return rows
    .map(({ entries, ...p }) => ({ ...p, games: entries?.[0]?.count ?? 0 }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'));
}

export async function createPlayer({ name, nickname }) {
  name = String(name || '').trim();
  if (!name) throw new Error('El nombre es requerido.');
  return q(supabase.from('players').insert({ name, nickname: String(nickname || '').trim() || null }).select().single());
}

export async function updatePlayer(id, patch) {
  const row = {};
  if (patch.name !== undefined) {
    row.name = String(patch.name).trim();
    if (!row.name) throw new Error('El nombre es requerido.');
  }
  if (patch.nickname !== undefined) row.nickname = String(patch.nickname).trim() || null;
  if (patch.active !== undefined) row.active = !!patch.active;
  return (await mutate(supabase.from('players').update(row).eq('id', id).select()))[0];
}

export async function deletePlayer(id) {
  await mutate(supabase.from('players').delete().eq('id', id).select());
  return true;
}

export async function playerStats(id, filter) {
  const player = await q(supabase.from('players').select('*').eq('id', id).maybeSingle());
  if (!player) throw new Error('Jugador no encontrado.');
  const stats = emptyStats({ player_id: player.id, name: player.name, nickname: player.nickname });
  const history = [];
  let cumulative = 0;
  for (const { game, summary } of await computedGames(filter)) {
    const e = summary.entries.find((x) => x.player_id === player.id);
    if (!e) continue;
    addEntry(stats, e);
    cumulative += e.net;
    history.push({
      game_id: game.id,
      date: game.date,
      location: game.location,
      players: summary.players,
      pot: summary.pot,
      position: e.position,
      rebuys: e.rebuys,
      spent: e.spent,
      prize: e.prize,
      net: e.net,
      cumulative,
    });
  }
  return { player, stats: finalizeStats(stats), history: history.reverse() };
}

// ---------- Partidas ----------

export async function listYears() {
  const rows = await q(supabase.from('games').select('date'));
  const years = new Set(rows.map((r) => Number(r.date.slice(0, 4))));
  years.add(new Date().getFullYear());
  return [...years].sort((a, b) => b - a);
}

export async function listGames(filter = {}) {
  const list = (await computedGames({ status: 'all', ...filter })).map(({ game, summary }) => ({
    id: game.id,
    date: game.date,
    location: game.location,
    status: game.status,
    places: game.places,
    players: summary.players,
    totalRebuys: summary.totalRebuys,
    pot: summary.pot,
    fund: summary.fund,
    dealerTotal: summary.dealerTotal,
    winners: summary.entries
      .filter((e) => e.prize > 0 || e.position === 1)
      .sort((a, b) => (a.position || 99) - (b.position || 99))
      .map((e) => ({ name: e.name, position: e.position, prize: e.prize })),
  }));
  return list.reverse();
}

export async function getGame(id) {
  const row = await q(supabase.from('games').select(`*, entries(${ENTRY_SELECT})`).eq('id', id).maybeSingle());
  if (!row) throw new Error('Partida no encontrada.');
  const { entries, ...game } = row;
  return { ...game, summary: computeGame(game, normEntries(entries)) };
}

function gameFields(body) {
  const f = {};
  if (body.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new Error('Fecha inválida.');
    f.date = body.date;
  }
  if (body.location !== undefined) f.location = String(body.location || '').trim() || null;
  if (body.notes !== undefined) f.notes = String(body.notes || '').trim() || null;
  for (const k of ['buy_in', 'rebuy', 'dealer_fee']) if (body[k] !== undefined) f[k] = int(body[k], k);
  if (body.places !== undefined) f.places = validatePlaces(body.places);
  if (body.status !== undefined) f.status = body.status;
  return f;
}

export async function createGame({ player_ids = [], ...body }) {
  const game = await q(supabase.from('games').insert(gameFields(body)).select('id').single());
  if (player_ids.length) await addEntries(game.id, player_ids);
  return getGame(game.id);
}

export async function updateGame(id, body) {
  await mutate(supabase.from('games').update(gameFields(body)).eq('id', id).select('id'));
  return getGame(id);
}

export async function deleteGame(id) {
  await mutate(supabase.from('games').delete().eq('id', id).select('id'));
  return true;
}

export async function addEntries(gameId, playerIds) {
  const rows = playerIds.map((pid) => ({ game_id: gameId, player_id: int(pid, 'jugador', { min: 1 }) }));
  await q(supabase.from('entries').upsert(rows, { onConflict: 'game_id,player_id', ignoreDuplicates: true }));
  return getGame(gameId);
}

export async function updateEntry(id, patch) {
  const row = {};
  if (patch.rebuys !== undefined) row.rebuys = int(patch.rebuys, 'recompras');
  if (patch.position !== undefined) row.position = int(patch.position, 'posición', { min: 1, nullable: true });
  if (patch.prize_override !== undefined) row.prize_override = int(patch.prize_override, 'premio', { nullable: true });
  if (patch.paid !== undefined) row.paid = !!patch.paid;
  const [e] = await mutate(supabase.from('entries').update(row).eq('id', id).select('game_id'));
  return getGame(e.game_id);
}

// Varias filas a la vez (para pasar a reparto manual).
export async function setPrizeOverrides(gameId, prizes) {
  for (const [entryId, prize] of prizes) {
    await mutate(supabase.from('entries').update({ prize_override: prize }).eq('id', entryId).select('id'));
  }
  return getGame(gameId);
}

export async function clearPrizeOverrides(gameId) {
  await mutate(supabase.from('entries').update({ prize_override: null }).eq('game_id', gameId).select('id'));
  return getGame(gameId);
}

export async function deleteEntry(id) {
  const [e] = await mutate(supabase.from('entries').delete().eq('id', id).select('game_id'));
  return getGame(e.game_id);
}

export async function shuffleSeating(gameId, { seatsPerTable, tables } = {}) {
  const game = await getGame(gameId);
  if (game.summary.players < 2) throw new Error('Se necesitan al menos 2 jugadores para sortear mesas.');
  const seats = int(seatsPerTable, 'asientos por mesa', { min: 2 });
  const seating = {
    created_at: new Date().toISOString(),
    seats_per_table: seats,
    tables: randomSeating(
      game.summary.entries.map((e) => e.player_id),
      { seatsPerTable: seats, tables: tables ? int(tables, 'mesas', { min: 1 }) : undefined },
    ),
  };
  await mutate(supabase.from('games').update({ seating }).eq('id', gameId).select('id'));
  return getGame(gameId);
}

export async function clearSeating(gameId) {
  await mutate(supabase.from('games').update({ seating: null }).eq('id', gameId).select('id'));
  return getGame(gameId);
}

// ---------- Estadísticas ----------

export async function getStats(filter) {
  return aggregateStats(await computedGames(filter));
}

// ---------- Fondo de fin de año ----------

export async function getFund(year) {
  const contributions = (await computedGames({ year, status: 'finished' }))
    .filter(({ summary }) => summary.fund !== 0)
    .map(({ game, summary }) => ({ game_id: game.id, date: game.date, location: game.location, pot: summary.pot, amount: summary.fund }));
  const movements = await q(
    supabase.from('fund_movements').select('*').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`).order('date').order('id'),
  );
  const totalIn = contributions.reduce((a, c) => a + c.amount, 0);
  const totalMovements = movements.reduce((a, m) => a + m.amount, 0);
  return { year: Number(year), contributions, movements, totalIn, totalMovements, balance: totalIn + totalMovements };
}

export async function addFundMovement({ date, amount, description }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Fecha inválida.');
  if (!Number.isInteger(amount) || amount === 0) throw new Error('Monto inválido.');
  return q(supabase.from('fund_movements').insert({ date, amount, description: String(description || '').trim() || null }).select().single());
}

export async function deleteFundMovement(id) {
  await mutate(supabase.from('fund_movements').delete().eq('id', id).select('id'));
  return true;
}

// ---------- Respaldo ----------

export async function exportAll() {
  const tables = ['settings', 'payout_templates', 'players', 'games', 'entries', 'fund_movements'];
  const dump = { exported_at: new Date().toISOString() };
  for (const t of tables) dump[t] = await q(supabase.from(t).select('*'));
  return dump;
}
