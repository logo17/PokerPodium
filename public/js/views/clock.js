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
  const showRoster = () => (rosterEl.innerHTML = rosterHtml(game.summary.entries));

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

// Quiénes siguen en juego (por nombre) y quiénes salieron (del último eliminado al primero).
function rosterHtml(entries) {
  const alive = entries.filter((e) => !e.eliminated_at).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const out = entries
    .filter((e) => e.eliminated_at)
    .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || b.eliminated_at.localeCompare(a.eliminated_at));
  const winner = alive.length === 1 && entries.length > 1;
  return `
    <h3>${winner ? 'Ganador' : 'En juego'} <span class="roster-count">${alive.length}</span></h3>
    <ul class="roster-in">${alive.map((e) => `<li>${winner ? '🏆 ' : ''}${esc(e.name)}</li>`).join('') || '<li class="muted">Sin jugadores</li>'}</ul>
    ${out.length ? `
      <h3>Eliminados <span class="roster-count">${out.length}</span></h3>
      <ol class="roster-out">${out.map((e) => `<li><span class="roster-pos">${e.position ? `${e.position}°` : '—'}</span>${esc(e.name)}</li>`).join('')}</ol>` : ''}`;
}
