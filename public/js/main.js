import { configured, auth, refreshAuth, signIn, signOut, supabase } from './supabase.js';
import { getSettings } from './store.js';
import { esc, modal, toast } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as games from './views/games.js';
import * as game from './views/game.js';
import * as players from './views/players.js';
import * as player from './views/player.js';
import * as stats from './views/stats.js';
import * as fund from './views/fund.js';
import * as settings from './views/settings.js';

const routes = [
  [/^$/, dashboard],
  [/^partidas$/, games],
  [/^partidas\/(\d+)$/, game],
  [/^jugadores$/, players],
  [/^jugadores\/(\d+)$/, player],
  [/^estadisticas$/, stats],
  [/^fondo$/, fund],
  [/^ajustes$/, settings],
];

const root = document.getElementById('app');
let renderId = 0;

async function router() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  const section = path.split('/')[0];
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === section));

  const match = routes.find(([re]) => re.test(path));
  const id = ++renderId;
  if (!match) {
    root.innerHTML = '<div class="empty">Página no encontrada. <a href="#/">Volver al inicio</a></div>';
    return;
  }
  const [re, view] = match;
  const args = path.match(re).slice(1);
  root.innerHTML = '<div class="loading">Cargando…</div>';
  try {
    // `isCurrent` permite a la vista ignorar respuestas tardías si el usuario ya navegó a otro lado.
    await view.render(root, { args, params, isCurrent: () => id === renderId });
  } catch (err) {
    if (id === renderId) root.innerHTML = `<div class="empty">Error: ${esc(err.message)}</div>`;
  }
}

function drawAuth() {
  const area = document.getElementById('auth-area');
  if (!auth.user) {
    area.innerHTML = '<button class="btn-sm auth-btn" data-login>Entrar</button>';
    area.querySelector('[data-login]').onclick = openLogin;
    return;
  }
  area.innerHTML = `
    <span class="auth-user" title="${esc(auth.user.email)}">${auth.isAdmin ? '✏️' : '👁'} ${esc(auth.user.email.split('@')[0])}</span>
    <button class="btn-sm auth-btn" data-logout>Salir</button>`;
  area.querySelector('[data-logout]').onclick = async () => {
    await signOut();
    drawAuth();
    router();
  };
}

async function openLogin() {
  const ok = await modal({
    title: 'Entrar como administrador',
    submitLabel: 'Entrar',
    body: `
      <p class="hint">Solo quienes registran los resultados necesitan entrar. Para ver no hace falta.</p>
      <div class="stack">
        <label class="field"><span>Correo</span><input type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span>Contraseña</span><input type="password" name="password" autocomplete="current-password" required></label>
      </div>`,
    onSubmit: (form) => signIn(form.elements.email.value.trim(), form.elements.password.value),
  });
  if (!ok) return;
  drawAuth();
  toast(auth.isAdmin ? 'Sesión iniciada ✔' : 'Sesión iniciada, pero este correo no tiene permiso de edición.', auth.isAdmin ? 'info' : 'error');
  router();
}

async function start() {
  if (!configured) {
    root.innerHTML = `<div class="card stack" style="max-width:640px;margin:2rem auto">
      <h1>Falta configurar Supabase</h1>
      <p>Edita <code>public/js/config.js</code> con la URL y la <em>anon key</em> de tu proyecto de Supabase.</p>
      <p class="hint">Los pasos completos están en el README.</p>
    </div>`;
    return;
  }
  await refreshAuth().catch(() => {});
  drawAuth();
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') refreshAuth().then(drawAuth);
  });
  window.addEventListener('hashchange', router);
  router();
  getSettings()
    .then((s) => {
      if (s.group_name) {
        document.getElementById('brand-name').textContent = s.group_name;
        document.title = s.group_name;
      }
    })
    .catch(() => {});
}

start();
