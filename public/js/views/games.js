import { listYears, listGames, getSettings, listTemplates, listPlayers, createGame } from '../store.js';
import { money, date, esc, medal, modal, today, yearSelect, yearParam, setParams, placesLabel, parsePlaces, playerName } from '../ui.js';

export async function render(root, { params, isCurrent }) {
  const year = yearParam(params);
  const [years, games] = await Promise.all([listYears(), listGames({ year })]);
  if (!isCurrent()) return;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Partidas</h1><div class="sub">${games.length} partida${games.length === 1 ? '' : 's'}</div></div>
      <div class="row">${yearSelect(years, year)}<button class="btn-primary admin-only" data-new>+ Nueva partida</button></div>
    </div>
    ${games.length ? `<div class="grid grid-2">${games.map(card).join('')}</div>` : '<div class="card empty">No hay partidas en este periodo. ¡Crea la primera!</div>'}`;

  root.querySelector('[data-year]').onchange = (e) => setParams({ year: e.target.value });
  root.querySelector('[data-new]').onclick = openNewGame;
}

function card(g) {
  return `<a class="card game-card" href="#/partidas/${g.id}">
    <div class="row">
      <strong>${date(g.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
      <span class="spacer"></span>
      <span class="badge ${g.status === 'open' ? 'badge-open' : 'badge-done'}">${g.status === 'open' ? 'En curso' : 'Finalizada'}</span>
    </div>
    <div class="meta">${g.location ? `${esc(g.location)} · ` : ''}${g.players} jugadores · ${g.totalRebuys} recompras</div>
    <div class="meta">Bote <strong>${money(g.pot)}</strong>${g.fund > 0 ? ` · Fondo ${money(g.fund)}` : ''} · ${placesLabel(g.places)}</div>
    ${g.winners.length ? `<div class="winners">${g.winners.map((w) => `<span class="winner">${medal(w.position)} ${esc(w.name)} <span class="muted">${money(w.prize)}</span></span>`).join('')}</div>` : ''}
  </a>`;
}

export async function openNewGame() {
  const [settings, templates, players] = await Promise.all([getSettings(), listTemplates(), listPlayers()]);
  const active = players.filter((p) => p.active);
  const defaultTpl = templates.find((t) => String(t.id) === settings.default_template_id) || templates[0];

  const created = await modal({
    title: 'Nueva partida',
    submitLabel: 'Crear partida',
    body: `
      <div class="form-grid">
        <label class="field"><span>Fecha</span><input type="date" name="date" value="${today()}" required></label>
        <label class="field"><span>Lugar</span><input name="location" placeholder="Casa de…"></label>
        <label class="field"><span>Entrada (₡)</span><input type="number" name="buy_in" min="0" step="500" value="${esc(settings.buy_in)}" required></label>
        <label class="field"><span>Recompra (₡)</span><input type="number" name="rebuy" min="0" step="500" value="${esc(settings.rebuy)}" required></label>
        <label class="field"><span>Dealer por cabeza (₡)</span><input type="number" name="dealer_fee" min="0" step="500" value="${esc(settings.dealer_fee)}" required></label>
        <label class="field"><span>Redondear premios a (₡)</span><input type="number" name="rounding" min="0" step="100" value="${esc(settings.rounding)}"></label>
      </div>
      <div class="field" style="margin-top:.75rem">
        <span>Estructura de premios</span>
        <select name="template">
          ${templates.map((t) => `<option value="${t.id}" ${t === defaultTpl ? 'selected' : ''}>${esc(t.name)} — ${placesLabel(t.places)}</option>`).join('')}
          <option value="custom">Personalizada…</option>
        </select>
        <input name="places" placeholder="Ej: 60, 25, 15" hidden>
        <span class="hint" data-places-hint></span>
      </div>
      <div class="field" style="margin-top:.75rem">
        <div class="row"><span class="muted" style="font-size:.82rem">Jugadores (${active.length})</span><span class="spacer"></span>
          <button type="button" class="btn-sm" data-all>Todos</button><button type="button" class="btn-sm" data-none>Ninguno</button></div>
        <div class="chips">${active.map((p) => `<label class="chip"><input type="checkbox" name="player" value="${p.id}">${playerName(p)}</label>`).join('') || '<span class="hint">No hay jugadores. Puedes agregarlos después.</span>'}</div>
        <span class="hint" data-count></span>
      </div>`,
    onOpen(form) {
      const tpl = form.elements.template;
      const placesInput = form.elements.places;
      const hint = form.querySelector('[data-places-hint]');
      const sync = () => {
        placesInput.hidden = tpl.value !== 'custom';
        hint.textContent = tpl.value === 'custom' ? (placesInput.value ? placesLabel(parsePlaces(placesInput.value)) : 'Porcentajes por posición separados por coma. Lo que falte para 100% va al fondo.') : '';
      };
      tpl.onchange = sync;
      placesInput.oninput = sync;
      sync();
      const count = () => (form.querySelector('[data-count]').textContent = `${form.querySelectorAll('[name=player]:checked').length} seleccionados`);
      form.querySelectorAll('[name=player]').forEach((c) => (c.onchange = count));
      form.querySelector('[data-all]').onclick = () => { form.querySelectorAll('[name=player]').forEach((c) => (c.checked = true)); count(); };
      form.querySelector('[data-none]').onclick = () => { form.querySelectorAll('[name=player]').forEach((c) => (c.checked = false)); count(); };
      count();
    },
    async onSubmit(form) {
      const f = form.elements;
      const places = f.template.value === 'custom' ? parsePlaces(f.places.value) : templates.find((t) => String(t.id) === f.template.value)?.places;
      if (!places?.length) throw new Error('Define al menos un porcentaje de premio.');
      return createGame({
        date: f.date.value,
        location: f.location.value,
        buy_in: f.buy_in.value,
        rebuy: f.rebuy.value,
        dealer_fee: f.dealer_fee.value,
        rounding: f.rounding.value || 0,
        places,
        player_ids: [...form.querySelectorAll('[name=player]:checked')].map((c) => Number(c.value)),
      });
    },
  });
  if (created) location.hash = `#/partidas/${created.id}`;
}
