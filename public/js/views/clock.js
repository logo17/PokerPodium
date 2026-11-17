// Pantalla completa del reloj de ciegas, para dejar abierta en un celular, tablet o TV.
import { getGame, clockAction, subscribeGame } from '../store.js';
import { date, esc, run, money } from '../ui.js';
import { mountClock } from '../blinds.js';

export async function render(root, { args, isCurrent }) {
  const id = args[0];
  let game = await getGame(id);
  if (!isCurrent()) return;

  root.innerHTML = `
    <div class="clock-page">
      <div class="clock-top">
        <a href="#/partidas/${id}" class="muted">← Volver a la partida</a>
        <span class="spacer"></span>
        <button class="btn-sm" data-fs>⛶ Pantalla completa</button>
      </div>
      <div class="clock-title">${date(game.date, { weekday: 'long', day: 'numeric', month: 'long' })}${game.location ? ` · ${esc(game.location)}` : ''}</div>
      <div class="clock-layout">
        <div class="clock-main">
          <div data-clock></div>
          <div class="clock-pot" data-pot></div>
        </div>
        <aside class="card clock-roster" data-roster></aside>
      </div>
    </div>`;

  const potEl = root.querySelector('[data-pot]');
  const rosterEl = root.querySelector('[data-roster]');
  const showPot = () => (potEl.innerHTML = `Bote: <strong>${money(game.summary.pot)}</strong> · ${game.summary.totalRebuys} recompras`);
  const showRoster = () => {
    rosterEl.innerHTML = rosterHtml(game.summary.entries, game.seating);
    // Con varias mesas el panel se ensancha para que quepan más nombres por fila.
    root.querySelector('.clock-layout').classList.toggle('roster-wide', (game.seating?.tables?.length ?? 0) > 1);
  };

  if (game.status === 'finished') {
    root.querySelector('[data-clock]').innerHTML = '<div class="card empty">Esta partida ya finalizó.</div>';
    showRoster();
    return;
  }

  const clock = mountClock(root.querySelector('[data-clock]'), {
    large: true,
    gameId: id,
    onAction: (action) => run(() => clockAction(game, action)),
  });
  const set = (g) => {
    game = g;
    clock.set(g);
    showPot();
    showRoster();
  };
  set(game);

  const unsubscribe = subscribeGame(id, async () => {
    const g = await getGame(id).catch(() => null);
    if (g && isCurrent()) set(g);
  });

  root.querySelector('[data-fs]').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Evita que la pantalla se apague mientras el reloj está abierto (donde el navegador lo permita).
  let wakeLock = null;
  const keepAwake = async () => {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {}
  };
  const onVisible = () => document.visibilityState === 'visible' && keepAwake();
  keepAwake();
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    unsubscribe();
    clock.destroy();
    document.removeEventListener('visibilitychange', onVisible);
    wakeLock?.release?.().catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
}

// Quiénes siguen en juego y quiénes salieron (del último eliminado al primero).
// - Una sola mesa (p. ej. tras unirlas): lista en orden de asiento con el botón de dealer.
// - Varias mesas: un bloque por mesa, en orden de asiento; los eliminados indican de qué mesa salieron.
// - Sin mesas sorteadas: todos los que siguen, por nombre.
function rosterHtml(entries, seating) {
  const byPlayer = Object.fromEntries(entries.map((e) => [e.player_id, e]));
  const alive = entries.filter((e) => !e.eliminated_at).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const out = entries
    .filter((e) => e.eliminated_at)
    .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || b.eliminated_at.localeCompare(a.eliminated_at));
  const winner = alive.length === 1 && entries.length > 1;
  const tables = seating?.tables ?? [];
  const multi = tables.length > 1;
  const tableOf = {};
  for (const t of tables) for (const pid of t.seats) tableOf[pid] = t.table;

  // Los que siguen en una mesa, en orden de asiento (el número es el asiento original).
  const seatsOf = (t) => t.seats.map((pid, i) => ({ e: byPlayer[pid], i })).filter(({ e }) => e && !e.eliminated_at);
  const dealer = (t, i) => (t.button === i ? '<span class="dealer-btn" title="Botón inicial">D</span>' : '');
  const legend = '<p class="hint" style="margin:0">Número = asiento · <span class="dealer-btn" style="margin:0">D</span> = botón inicial</p>';

  let playing;
  if (winner) {
    playing = `<h3>Ganador</h3><ul class="roster-in"><li>🏆 ${esc(alive[0].name)}</li></ul>`;
  } else if (tables.length === 1) {
    const t = tables[0];
    playing = `<h3>${seating.final ? '🏆 Mesa final' : 'Mesa'} <span class="roster-count">${alive.length}</span></h3>
      <ol class="roster-seats">${seatsOf(t).map(({ e, i }) => `<li><span class="roster-pos">${i + 1}</span>${esc(e.name)}${dealer(t, i)}</li>`).join('')}</ol>
      ${legend}`;
  } else if (multi) {
    const unseated = alive.filter((e) => !tableOf[e.player_id]);
    playing = `<h3>En juego <span class="roster-count">${alive.length}</span></h3>
      ${tables.map((t) => {
        const seats = seatsOf(t);
        return `<div class="roster-table">
          <h4>Mesa ${t.table} <span class="roster-count">${seats.length}</span></h4>
          <ul class="roster-in">${seats.map(({ e, i }) => `<li><span class="chip-seat">${i + 1}</span>${esc(e.name)}${dealer(t, i)}</li>`).join('') || '<li class="muted">Sin jugadores</li>'}</ul>
        </div>`;
      }).join('')}
      ${unseated.length ? `<div class="roster-table"><h4>Sin mesa <span class="roster-count">${unseated.length}</span></h4>
        <ul class="roster-in">${unseated.map((e) => `<li>${esc(e.name)}</li>`).join('')}</ul></div>` : ''}
      ${legend}`;
  } else {
    playing = `<h3>En juego <span class="roster-count">${alive.length}</span></h3>
      <ul class="roster-in">${alive.map((e) => `<li>${esc(e.name)}</li>`).join('') || '<li class="muted">Sin jugadores</li>'}</ul>`;
  }

  return `
    ${playing}
    ${out.length ? `
      <h3>Eliminados <span class="roster-count">${out.length}</span></h3>
      <ol class="roster-out">${out.map((e) => `<li><span class="roster-pos">${e.position ? `${e.position}°` : '—'}</span><span class="grow">${esc(e.name)}</span>${multi && tableOf[e.player_id] ? `<span class="roster-tag">Mesa ${tableOf[e.player_id]}</span>` : ''}</li>`).join('')}</ol>` : ''}`;
}
