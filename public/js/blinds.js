// Reloj de ciegas: se usa compacto en la partida y grande en la pantalla de reloj.
// Cada dispositivo calcula el tiempo con el estado guardado en la partida (ver blindState en calc.js),
// así que todos ven lo mismo sin que nadie tenga que escribir cada segundo.
import { blindState } from './calc.js';
import { auth } from './supabase.js';
import { money, toast, confirmDialog } from './ui.js';

// ---------- Sonido y vibración ----------

const SOUND_KEY = 'poker-alerts';
let audio;

export function alertsOn() {
  try {
    return localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

function setAlerts(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {}
  if (on) unlockAudio();
}

// Los navegadores solo permiten sonido después de que el usuario toca la página.
function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {}
}
document.addEventListener('pointerdown', () => alertsOn() && unlockAudio(), { capture: true });

function tones(freqs, gap = 0.18, dur = 0.35) {
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime + 0.02;
  freqs.forEach((f, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = t0 + i * gap;
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  });
}

function alertLevelUp() {
  if (!alertsOn()) return;
  tones([660, 880, 1175, 660, 880, 1175]);
  navigator.vibrate?.([400, 150, 400, 150, 400]);
}

function alertOneMinute() {
  if (!alertsOn()) return;
  tones([520, 520], 0.3, 0.2);
  navigator.vibrate?.(200);
}

// ---------- Formato ----------

export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const blindsLabel = (l) => `${money(l.sb)} / ${money(l.bb)}`;

function rulesLabel(game) {
  const parts = [];
  if (game.blind_minutes > 0) parts.push(`cada ${game.blind_minutes} min`);
  if (game.blind_on_elimination) parts.push('al eliminar a un jugador');
  return parts.length ? `Suben ${parts.join(' y ')}` : 'Solo suben manualmente';
}

// ---------- Componente ----------

/**
 * Monta el reloj en `el`. `onAction(action)` hace el cambio (start/pause/resume/up/down/reset)
 * y devuelve la partida actualizada. Devuelve { set(game), destroy() }.
 */
export function mountClock(el, { large = false, gameId, onAction }) {
  let game = null;
  let renderedLevel = null;
  let lastLevel = null;
  let warnedLevel = null;
  let busy = false;

  function render() {
    const s = blindState(game);
    renderedLevel = s.level;
    const alive = game.summary.entries.filter((e) => !e.eliminated_at).length;
    const status = !s.started ? 'Sin iniciar' : s.running ? 'Corriendo' : 'En pausa';
    const playBtn = !s.started
      ? '<button class="btn-primary" data-act="start">▶ Iniciar</button>'
      : s.running
        ? '<button data-act="pause">⏸ Pausar</button>'
        : '<button class="btn-primary" data-act="resume">▶ Reanudar</button>';

    el.innerHTML = `
      <div class="bc ${large ? 'bc-large' : ''}">
        <div class="bc-head">
          <span class="bc-level">Nivel ${s.level + 1} <span class="muted">de ${s.levels.length}</span>${s.atMax ? ' · <strong>Tope</strong>' : ''}</span>
          <span class="badge ${s.running ? 'badge-done' : 'badge-open'}">${status}</span>
          <span class="spacer"></span>
          <button class="btn-sm btn-ghost" data-alerts title="Sonido y vibración al subir las ciegas">${alertsOn() ? '🔔 Alertas' : '🔕 Alertas'}</button>
        </div>
        <div class="bc-blinds">
          <div><span class="bc-label">Ciega chica</span><span class="bc-amount">${money(s.current.sb)}</span></div>
          <div><span class="bc-label">Ciega grande</span><span class="bc-amount">${money(s.current.bb)}</span></div>
        </div>
        <div class="bc-timer" data-countdown></div>
        <div class="bc-bar"><span data-progress></span></div>
        <div class="bc-next">${s.next ? `Siguiente: <strong>${blindsLabel(s.next)}</strong>` : 'Último nivel: las ciegas ya no suben'}</div>
        <div class="bc-meta">Quedan <strong>${alive}</strong> de ${game.summary.players} jugadores · ${rulesLabel(game)}</div>
        <div class="bc-controls admin-only">
          <button data-act="down" ${s.level === 0 ? 'disabled' : ''} title="Bajar un nivel">− Nivel</button>
          ${playBtn}
          <button data-act="up" ${s.atMax ? 'disabled' : ''} title="Subir un nivel">+ Nivel</button>
          ${s.started ? '<button class="btn-ghost" data-act="reset" title="Volver al nivel 1 sin iniciar">↺ Reiniciar</button>' : ''}
        </div>
        ${large ? '' : `<a class="bc-full" href="#/partidas/${gameId}/reloj">⛶ Pantalla completa</a>`}
      </div>`;

    el.querySelector('[data-alerts]').onclick = () => {
      setAlerts(!alertsOn());
      if (alertsOn()) tones([880], 0, 0.15); // confirma que el sonido funciona
      render();
      tick();
    };
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        if (busy || !auth.isAdmin) return;
        const action = b.dataset.act;
        if (action === 'reset' && !(await confirmDialog('Reiniciar reloj', 'El reloj vuelve al nivel 1 y queda sin iniciar.', 'Reiniciar'))) return;
        busy = true;
        el.querySelectorAll('[data-act]').forEach((x) => (x.disabled = true));
        try {
          const g = await onAction(action);
          if (g) set(g);
        } finally {
          busy = false;
          render();
          tick();
        }
      };
    });
  }

  function tick() {
    if (!game) return;
    const s = blindState(game);
    if (lastLevel !== null && s.level > lastLevel) {
      alertLevelUp();
      el.querySelector('.bc')?.classList.add('bc-flash');
      setTimeout(() => el.querySelector('.bc')?.classList.remove('bc-flash'), 3000);
      toast(`⬆ Suben las ciegas: ${blindsLabel(s.current)}`);
    }
    lastLevel = s.level;
    if (s.level !== renderedLevel) render();

    const countdown = el.querySelector('[data-countdown]');
    const progress = el.querySelector('[data-progress]');
    if (s.remainingMs !== null) {
      countdown.textContent = formatDuration(s.remainingMs);
      countdown.classList.toggle('bc-urgent', s.running && s.remainingMs <= 60000);
      progress.style.width = `${(s.elapsedInLevel / s.durationMs) * 100}%`;
      if (s.running && s.remainingMs <= 60000 && warnedLevel !== s.level) {
        warnedLevel = s.level;
        alertOneMinute();
      }
    } else {
      countdown.textContent = s.atMax ? 'Tope' : 'Sin límite de tiempo';
      countdown.classList.remove('bc-urgent');
      progress.style.width = s.atMax ? '100%' : '0%';
    }
  }

  function set(g) {
    game = g;
    render();
    tick();
  }

  const timer = setInterval(tick, 1000);
  return { set, destroy: () => clearInterval(timer) };
}
