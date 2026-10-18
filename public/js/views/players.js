import { listPlayers, createPlayer, updatePlayer, deletePlayer } from '../store.js';
import { esc, modal, confirmDialog, run } from '../ui.js';

export async function render(root, { isCurrent }) {
  const players = await listPlayers();
  if (!isCurrent()) return;
  const active = players.filter((p) => p.active);
  const inactive = players.filter((p) => !p.active);

  const item = (p) => `<li data-id="${p.id}">
    <div class="grow">
      <a class="title" href="#/jugadores/${p.id}?year=all">${esc(p.name)}</a>${p.nickname ? ` <span class="muted">“${esc(p.nickname)}”</span>` : ''}
      <div class="muted" style="font-size:.85rem">${p.games} partida${p.games === 1 ? '' : 's'}</div>
    </div>
    <button class="btn-sm admin-only" data-edit>Editar</button>
    <button class="btn-sm admin-only" data-toggle>${p.active ? 'Desactivar' : 'Activar'}</button>
    ${p.games ? '' : '<button class="btn-sm btn-ghost btn-danger admin-only" data-delete title="Eliminar">✕</button>'}
  </li>`;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Jugadores</h1><div class="sub">${active.length} activos</div></div>
    </div>
    <div class="grid grid-2">
      <section class="card admin-only">
        <h2>Agregar jugador</h2>
        <form class="row" data-add>
          <input name="name" placeholder="Nombre" required style="flex:2">
          <input name="nickname" placeholder="Apodo (opcional)" style="flex:1">
          <button class="btn-primary">Agregar</button>
        </form>
        <p class="hint">Los jugadores inactivos no aparecen al crear partidas, pero conservan su historial.</p>
      </section>
      <section class="card">
        <h2>Activos</h2>
        ${active.length ? `<ul class="list">${active.map(item).join('')}</ul>` : '<div class="empty">Aún no hay jugadores.</div>'}
      </section>
      ${inactive.length ? `<section class="card"><h2>Inactivos</h2><ul class="list">${inactive.map(item).join('')}</ul></section>` : ''}
    </div>`;

  const reload = () => render(root, { isCurrent });

  root.querySelector('[data-add]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (await run(() => createPlayer({ name: f.name.value, nickname: f.nickname.value }), 'Jugador agregado')) reload();
  };

  root.querySelectorAll('[data-id]').forEach((li) => {
    const p = players.find((x) => String(x.id) === li.dataset.id);
    li.querySelector('[data-edit]').onclick = async () => {
      const ok = await modal({
        title: 'Editar jugador',
        body: `<div class="form-grid">
          <label class="field"><span>Nombre</span><input name="name" value="${esc(p.name)}" required></label>
          <label class="field"><span>Apodo</span><input name="nickname" value="${esc(p.nickname || '')}"></label>
        </div>`,
        onSubmit: (form) => updatePlayer(p.id, { name: form.elements.name.value, nickname: form.elements.nickname.value }),
      });
      if (ok) reload();
    };
    li.querySelector('[data-toggle]').onclick = async () => {
      if (await run(() => updatePlayer(p.id, { active: !p.active }))) reload();
    };
    const del = li.querySelector('[data-delete]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('Eliminar jugador', `¿Eliminar a ${p.name}?`))) return;
      if ((await run(() => deletePlayer(p.id), 'Jugador eliminado')) !== undefined) reload();
    };
  });
}
