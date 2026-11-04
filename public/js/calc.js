// Reglas de dinero de una partida. Todo en colones enteros.
//
//   Bote       = jugadores × entrada + recompras × valor recompra
//   Premios    = bote × % de cada posición (en colones enteros, sin decimales)
//   Fondo      = bote − premios  (el % no repartido)
//   Dealer     = jugadores × cuota dealer  (se cobra aparte, no sale del bote)
//   Gasto      = entrada + recompras × valor recompra + cuota dealer
//   Neto       = premio − gasto
//
// Si algún jugador tiene premio manual (p. ej. un "chop"), los premios dejan de calcularse
// por porcentaje y se usan los montos manuales; el resto del bote va al fondo.

export function parsePlaces(places) {
  const arr = Array.isArray(places) ? places : JSON.parse(places || '[]');
  return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

export function validatePlaces(places) {
  const arr = parsePlaces(places);
  if (!arr.length) throw new Error('Define al menos un porcentaje de premio.');
  const total = arr.reduce((a, b) => a + b, 0);
  if (total > 100.0001) throw new Error(`Los porcentajes suman ${total}%, no pueden pasar de 100%.`);
  return arr;
}

export function computeGame(game, entries) {
  const places = parsePlaces(game.places);

  const players = entries.length;
  const totalRebuys = entries.reduce((a, e) => a + e.rebuys, 0);
  const buyInTotal = players * game.buy_in;
  const rebuyTotal = totalRebuys * game.rebuy;
  const pot = buyInTotal + rebuyTotal;
  const dealerTotal = players * game.dealer_fee;

  const payouts = places.map((pct, i) => ({ position: i + 1, pct, amount: Math.floor(Math.round(pot * pct * 100) / 10000) }));
  const manual = entries.some((e) => e.prize_override !== null && e.prize_override !== undefined);

  const computedEntries = entries.map((e) => {
    let prize = 0;
    if (manual) prize = e.prize_override ?? 0;
    else if (e.position && payouts[e.position - 1]) prize = payouts[e.position - 1].amount;
    const spent = game.buy_in + e.rebuys * game.rebuy + game.dealer_fee;
    return { ...e, prize, spent, net: prize - spent };
  });

  const prizesTotal = manual
    ? computedEntries.reduce((a, e) => a + e.prize, 0)
    : payouts.reduce((a, p) => a + p.amount, 0);
  const fund = pot - prizesTotal;
  const paidCount = entries.filter((e) => e.paid).length;
  const collected = computedEntries.filter((e) => e.paid).reduce((a, e) => a + e.spent, 0);

  const warnings = [];
  if (fund < 0) warnings.push('Los premios superan el bote.');
  const positions = entries.map((e) => e.position).filter(Boolean);
  if (new Set(positions).size !== positions.length) warnings.push('Hay posiciones repetidas.');
  if (!manual && game.status === 'finished') {
    for (const p of payouts) {
      if (p.amount > 0 && !positions.includes(p.position)) warnings.push(`Falta asignar el ${p.position}° lugar.`);
    }
  }

  return {
    players,
    totalRebuys,
    buyInTotal,
    rebuyTotal,
    pot,
    dealerTotal,
    payouts,
    manual,
    prizesTotal,
    fund,
    fundPct: pot > 0 ? (fund / pot) * 100 : 100 - places.reduce((a, b) => a + b, 0),
    totalCollected: pot + dealerTotal,
    collected,
    paidCount,
    warnings,
    entries: computedEntries,
  };
}

// Número aleatorio criptográfico en [0, 1).
const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// Reparte jugadores al azar en mesas lo más parejas posible.
export function randomSeating(playerIds, { seatsPerTable = 9, tables } = {}, rand = secureRandom) {
  const ids = [...playerIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const tableCount = Math.max(1, tables || Math.ceil(ids.length / Math.max(2, seatsPerTable)));
  const result = Array.from({ length: tableCount }, (_, i) => ({ table: i + 1, seats: [] }));
  ids.forEach((id, i) => result[i % tableCount].seats.push(id));
  // Botón de dealer inicial al azar en cada mesa (índice dentro de seats).
  for (const t of result) t.button = t.seats.length ? Math.floor(rand() * t.seats.length) : null;
  return result;
}

// ---------- Estadísticas por jugador ----------

export function emptyStats(e) {
  return {
    player_id: e.player_id,
    name: e.name,
    nickname: e.nickname,
    games: 0,
    wins: 0,
    seconds: 0,
    thirds: 0,
    cashes: 0,
    rebuys: 0,
    spent: 0,
    won: 0,
    net: 0,
    bestPosition: null,
    maxRebuysInGame: 0,
  };
}

export function addEntry(s, e) {
  s.games++;
  if (e.position === 1) s.wins++;
  if (e.position === 2) s.seconds++;
  if (e.position === 3) s.thirds++;
  if (e.prize > 0) s.cashes++;
  s.rebuys += e.rebuys;
  s.spent += e.spent;
  s.won += e.prize;
  s.net += e.net;
  if (e.position && (s.bestPosition === null || e.position < s.bestPosition)) s.bestPosition = e.position;
  s.maxRebuysInGame = Math.max(s.maxRebuysInGame, e.rebuys);
}

export function finalizeStats(s) {
  return {
    ...s,
    avgRebuys: s.games ? s.rebuys / s.games : 0,
    winRate: s.games ? s.wins / s.games : 0,
    cashRate: s.games ? s.cashes / s.games : 0,
    roi: s.spent ? s.net / s.spent : 0,
  };
}

// Tabla general + totales + récords a partir de [{ game, summary }].
export function aggregateStats(games) {
  const byPlayer = new Map();
  const totals = { games: games.length, pot: 0, dealer: 0, fund: 0, prizes: 0, rebuys: 0, entries: 0 };
  const records = { biggestPot: null, biggestPrize: null, mostRebuys: null, mostPlayers: null };
  const better = (cur, value) => !cur || value > cur.value;

  for (const { game, summary } of games) {
    totals.pot += summary.pot;
    totals.dealer += summary.dealerTotal;
    totals.fund += summary.fund;
    totals.prizes += summary.prizesTotal;
    totals.rebuys += summary.totalRebuys;
    totals.entries += summary.players;
    const ref = { game_id: game.id, date: game.date };
    if (better(records.biggestPot, summary.pot)) records.biggestPot = { ...ref, value: summary.pot };
    if (better(records.mostPlayers, summary.players)) records.mostPlayers = { ...ref, value: summary.players };
    for (const e of summary.entries) {
      if (!byPlayer.has(e.player_id)) byPlayer.set(e.player_id, emptyStats(e));
      addEntry(byPlayer.get(e.player_id), e);
      if (e.prize > 0 && better(records.biggestPrize, e.prize)) records.biggestPrize = { ...ref, value: e.prize, name: e.name };
      if (e.rebuys > 0 && better(records.mostRebuys, e.rebuys)) records.mostRebuys = { ...ref, value: e.rebuys, name: e.name };
    }
  }
  const players = [...byPlayer.values()].map(finalizeStats).sort((a, b) => b.net - a.net || b.wins - a.wins);
  return { totals: { ...totals, players: players.length }, records, players };
}

// ---------- Ciegas ----------
//
// El reloj se guarda como { level, offset_ms, anchor, running }:
//   - level:     nivel en el que se fijó el estado (0 = primero)
//   - offset_ms: tiempo ya transcurrido dentro de ese nivel en el momento `anchor`
//   - anchor:    fecha ISO desde la que corre el tiempo (null si está en pausa)
// Con eso cualquier dispositivo calcula el nivel y el tiempo restante sin escribir cada segundo.

export const DEFAULT_BLINDS = [
  { sb: 50, bb: 100 },
  { sb: 100, bb: 200 },
  { sb: 200, bb: 400 },
  { sb: 400, bb: 800 },
  { sb: 800, bb: 1600 },
  { sb: 1600, bb: 3200 },
  { sb: 2500, bb: 5000 },
];

export function validateLevels(levels) {
  if (!Array.isArray(levels) || !levels.length) throw new Error('Define al menos un nivel de ciegas.');
  if (levels.length > 40) throw new Error('Máximo 40 niveles de ciegas.');
  return levels.map((l, i) => {
    const sb = Number(l.sb);
    const bb = Number(l.bb);
    if (!Number.isInteger(sb) || !Number.isInteger(bb) || sb <= 0 || bb <= 0) throw new Error(`Nivel ${i + 1}: las ciegas deben ser montos enteros mayores a 0.`);
    return { sb: Math.min(sb, bb), bb: Math.max(sb, bb) };
  });
}

// "50/100, 100/200" (o "100-50") → [{ sb: 50, bb: 100 }, …]. Cada par se ordena: la menor es la chica.
export function parseLevels(text) {
  const pairs = String(text).match(/\d+\s*[/\-–]\s*\d+/g) || [];
  return pairs.map((p) => {
    const [a, b] = p.split(/[/\-–]/).map((n) => Number(n.trim()));
    return { sb: Math.min(a, b), bb: Math.max(a, b) };
  });
}

export const levelsText = (levels) => levels.map((l) => `${l.sb}/${l.bb}`).join(', ');

export function blindState(game, now = Date.now()) {
  const levels = game.blind_levels?.length ? game.blind_levels : DEFAULT_BLINDS;
  const max = levels.length - 1;
  const c = game.clock;
  const durationMs = Math.max(0, Number(game.blind_minutes) || 0) * 60000;
  let level = Math.min(Math.max(c?.level ?? 0, 0), max);
  let elapsed = (c?.offset_ms || 0) + (c?.running && c.anchor ? Math.max(0, now - Date.parse(c.anchor)) : 0);
  if (durationMs > 0 && level < max) {
    const steps = Math.min(Math.floor(elapsed / durationMs), max - level);
    level += steps;
    elapsed -= steps * durationMs;
  }
  const atMax = level === max;
  return {
    level,
    levels,
    current: levels[level],
    next: atMax ? null : levels[level + 1],
    atMax,
    elapsedInLevel: elapsed,
    remainingMs: durationMs > 0 && !atMax ? durationMs - elapsed : null,
    durationMs,
    running: !!c?.running,
    started: !!c,
  };
}

// Nuevo estado del reloj tras una acción: start | pause | resume | up | down | reset.
export function clockAfter(game, action, now = Date.now()) {
  const s = blindState(game, now);
  const iso = new Date(now).toISOString();
  const max = s.levels.length - 1;
  switch (action) {
    case 'start':
      return { level: 0, offset_ms: 0, anchor: iso, running: true };
    case 'pause':
      return { level: s.level, offset_ms: s.elapsedInLevel, anchor: null, running: false };
    case 'resume':
      return { level: s.level, offset_ms: s.elapsedInLevel, anchor: iso, running: true };
    case 'up':
    case 'down': {
      const level = Math.min(Math.max(s.level + (action === 'up' ? 1 : -1), 0), max);
      return { level, offset_ms: 0, anchor: s.running ? iso : null, running: s.running };
    }
    case 'reset':
      return null;
    default:
      throw new Error(`Acción de reloj desconocida: ${action}`);
  }
}

// Valores por defecto de ciegas guardados en Ajustes (texto), con respaldo si aún no existen.
export function blindSettings(settings) {
  let levels = DEFAULT_BLINDS;
  try {
    const parsed = JSON.parse(settings.blind_levels || 'null');
    if (Array.isArray(parsed) && parsed.length) levels = parsed;
  } catch {}
  const minutes = settings.blind_minutes === undefined || settings.blind_minutes === '' ? 45 : Number(settings.blind_minutes);
  return { levels, minutes, onElimination: settings.blind_on_elimination !== 'false' };
}
