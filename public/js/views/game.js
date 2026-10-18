import { auth } from '../supabase.js';
import {
  getGame, listPlayers, listTemplates, getSettings, updateGame, deleteGame, createPlayer, addEntries,
  updateEntry, deleteEntry, setPrizeOverrides, clearPrizeOverrides, shuffleSeating, clearSeating,
} from '../store.js';
import { money, num, signed, date, esc, kpi, medal, modal, confirmDialog, run, toast, placesLabel, parsePlaces, playerName } from '../ui.js';

export async function render(root, { args, isCurrent }) {
  const id = args[0];
  const [initial, players, templates, settings] = await Promise.all([
    getGame(id),
    listPlayers(),
    listTemplates(),
    getSettings(),
  ]);
  if (!isCurrent()) return;

  let game = initial;
  const update = (g) => {
    if (g) {
      game = g;
      draw();
    }
  };

  function draw() {
    const s = game.summary;
    const inGame = new Set(s.entries.map((e) => e.player_id));
    const available = players.filter((p) => p.active && !inGame.has(p.id));
    const finished = game.status === 'finished';
    const ro = auth.isAdmin ? '' : 'disabled';
    const byPosition = Object.fromEntries(s.entries.filter((e) => e.position).map((e) => [e.position, e]));

    root.innerHTML = `
      <div class="page-head">
        <div>
          <a href="#/partidas" class="muted">← Partidas</a>
          <h1>${date(game.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h1>
          <div class="sub">${game.location ? `${esc(game.location)} · ` : ''}<span class="badge ${finished ? 'badge-done' : 'badge-open'}">${finished ? 'Finalizada' : 'En curso'}</span></div>
        </div>
        <div class="row no-print admin-only">
          <button data-edit>⚙︎ Configuración</button>
          <button class="${finished ? '' : 'btn-primary'}" data-status>${finished ? 'Reabrir' : '✓ Finalizar partida'}</button>
          <button class="btn-ghost btn-danger" data-delete title="Eliminar partida">🗑</button>
        </div>
      </div>

      ${s.warnings.length ? `<div class="alert" style="margin-bottom:1rem">⚠️ ${s.warnings.map(esc).join(' ')}</div>` : ''}

      <div class="kpis" style="margin-bottom:1rem">
        ${kpi('Jugadores', s.players)}
        ${kpi('Recompras', s.totalRebuys, money(s.rebuyTotal))}
        ${kpi('Bote', money(s.pot), `Entradas ${money(s.buyInTotal)}`, 'accent')}
        ${kpi('Premios', money(s.prizesTotal), s.manual ? 'Manual' : '')}
        ${kpi('Fondo fin de año', money(s.fund), s.pot ? `${num(s.fundPct)}% del bote` : '')}
        ${kpi('Dealer', money(s.dealerTotal), `${money(game.dealer_fee)} × ${s.players}`)}
        ${kpi('Cobrado', `${s.paidCount}/${s.players}`, `${money(s.collected)} de ${money(s.totalCollected)}`)}
      </div>

      <div class="grid" style="grid-template-columns:minmax(0,1fr)">
        <section class="card">
          <div class="card-head">
            <h2>Premios</h2>
            <div class="row no-print admin-only">
              ${s.manual
                ? '<span class="badge badge-open">Montos manuales</span><button class="btn-sm" data-auto>Volver a porcentajes</button>'
                : '<button class="btn-sm" data-manual title="Para acuerdos (chop) o repartos distintos">Repartir manualmente</button>'}
            </div>
          </div>
          <div class="hint" style="margin-bottom:.5rem">${placesLabel(game.places)} · Entrada ${money(game.buy_in)} · Recompra ${money(game.rebuy)}</div>
          <ul class="list">
            ${s.manual
              ? s.entries.filter((e) => e.prize > 0).sort((a, b) => b.prize - a.prize).map((e) => `<li>${medal(e.position)}<span class="grow title">${esc(e.name)}</span><strong>${money(e.prize)}</strong></li>`).join('')
              : s.payouts.map((p) => `<li>${medal(p.position)}<span class="grow">${byPosition[p.position] ? `<span class="title">${esc(byPosition[p.position].name)}</span>` : '<span class="muted">Sin asignar</span>'} <span class="muted">· ${num(p.pct)}%</span></span><strong>${money(p.amount)}</strong></li>`).join('')}
            <li><span class="medal" style="background:var(--accent)">F</span><span class="grow">Fondo fin de año</span><strong>${money(s.fund)}</strong></li>
          </ul>
        </section>

        <section class="card">
          <div class="card-head">
            <h2>Participantes</h2>
            <div class="row no-print admin-only">
              <select data-add-select ${available.length ? '' : 'disabled'}>
                <option value="">${available.length ? 'Agregar jugador…' : 'Todos los jugadores agregados'}</option>
                ${available.map((p) => `<option value="${p.id}">${playerName(p)}</option>`).join('')}
              </select>
              <button class="btn-sm" data-new-player>+ Jugador nuevo</button>
            </div>
          </div>
          ${s.entries.length ? `<div class="table-wrap"><table>
            <thead><tr>
              <th>Jugador</th><th>Recompras</th><th>Posición</th><th class="num">Premio</th><th class="num">Gastó</th><th class="num">Neto</th><th>Pagó</th><th class="no-print admin-only"></th>
            </tr></thead>
            <tbody>
              ${s.entries.map((e) => `<tr data-entry="${e.id}">
                <td><a href="#/jugadores/${e.player_id}">${esc(e.name)}</a></td>
                <td><div class="stepper">
                  <button class="btn-icon btn-sm no-print admin-only" data-rebuy="-1" ${e.rebuys === 0 ? 'disabled' : ''} aria-label="Quitar recompra">−</button>
                  <span class="val">${e.rebuys}</span>
                  <button class="btn-icon btn-sm no-print admin-only" data-rebuy="1" aria-label="Agregar recompra">+</button>
                </div></td>
                <td><select data-position aria-label="Posición" ${ro}>
                  <option value="">—</option>
                  ${Array.from({ length: s.players }, (_, i) => `<option value="${i + 1}" ${e.position === i + 1 ? 'selected' : ''}>${i + 1}°</option>`).join('')}
                </select></td>
                <td class="num">${s.manual
                  ? `<input type="number" min="0" step="500" value="${e.prize}" data-prize style="width:110px;text-align:right" ${ro}>`
                  : e.prize ? `<strong>${money(e.prize)}</strong>` : '<span class="muted">—</span>'}</td>
                <td class="num">${money(e.spent)}</td>
                <td class="num">${signed(e.net)}</td>
                <td><input type="checkbox" data-paid ${e.paid ? 'checked' : ''} aria-label="Pagó" ${ro}></td>
                <td class="no-print admin-only"><button class="btn-ghost btn-sm btn-danger" data-remove title="Quitar de la partida">✕</button></td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td>${s.players} jugadores</td><td>${s.totalRebuys}</td><td></td>
              <td class="num">${money(s.prizesTotal)}</td><td class="num">${money(s.totalCollected)}</td><td></td><td>${s.paidCount}/${s.players}</td><td class="no-print admin-only"></td>
            </tr></tfoot>
          </table></div>
          <p class="hint">Gastó = entrada + recompras + dealer. Neto = premio − gastó.</p>` : '<div class="empty">Agrega jugadores a la partida.</div>'}
        </section>

        <section class="card">
          <div class="card-head">
            <h2>Mesas</h2>
            <div class="row no-print admin-only">
              <label class="row hint">Máx. por mesa <input type="number" min="2" max="12" value="${game.seating?.seats_per_table || settings.seats_per_table}" data-seats style="width:70px"></label>
              <label class="row hint">Mesas <input type="number" min="1" max="10" placeholder="auto" data-tables style="width:70px"></label>
              <button class="btn-primary btn-sm" data-shuffle ${s.players < 2 ? 'disabled' : ''}>🎲 Sortear</button>
              ${game.seating ? '<button class="btn-sm" data-print>Imprimir</button><button class="btn-sm btn-ghost" data-clear-seats>Limpiar</button>' : ''}
            </div>
          </div>
          ${seatingHtml(game, s)}
        </section>

        ${game.notes ? `<section class="card"><h2>Notas</h2><p style="white-space:pre-wrap;margin:0">${esc(game.notes)}</p></section>` : ''}
      </div>`;

    bind(available);
  }

  function seatingHtml(g, s) {
    if (!g.seating) return '<p class="hint">Sortea para asignar mesas y asientos al azar. Si son más del máximo por mesa, se reparten en varias mesas parejas.</p>';
    const names = Object.fromEntries(s.entries.map((e) => [e.player_id, e.name]));
    const seated = new Set(g.seating.tables.flatMap((t) => t.seats));
    const unseated = s.entries.filter((e) => !seated.has(e.player_id));
    return `
      ${unseated.length ? `<div class="alert" style="margin-bottom:.75rem">Sin mesa: ${unseated.map((e) => esc(e.name)).join(', ')}. Vuelve a sortear para incluirlos.</div>` : ''}
      <div class="tables">
        ${g.seating.tables.map((t) => `<div class="poker-table">
          <h3><span>Mesa ${t.table}</span><span style="opacity:.75;font-weight:400">${t.seats.length} jugadores</span></h3>
          <ol>${t.seats.map((pid, i) => `<li>${names[pid] ? esc(names[pid]) : '<em style="opacity:.6">(retirado)</em>'}${t.button === i ? '<span class="dealer-btn" title="Botón inicial">D</span>' : ''}</li>`).join('')}</ol>
        </div>`).join('')}
      </div>
      <p class="hint">Sorteado ${new Date(g.seating.created_at).toLocaleString('es-CR')}. El número es el asiento; <span class="dealer-btn" style="margin:0">D</span> marca el botón inicial.</p>`;
  }

  function bind(available) {
    const $ = (sel) => root.querySelector(sel);
    const s = game.summary;

    $('[data-edit]').onclick = () => editConfig(game, templates).then(update);

    $('[data-status]').onclick = async () => {
      const next = game.status === 'finished' ? 'open' : 'finished';
      if (next === 'finished') {
        const missing = !s.manual && s.payouts.some((p) => p.amount > 0 && !s.entries.some((e) => e.position === p.position));
        const unpaid = s.players - s.paidCount;
        const issues = [missing && 'faltan posiciones con premio por asignar', unpaid > 0 && `${unpaid} jugador(es) sin marcar como pagado`].filter(Boolean);
        if (issues.length && !(await modal({ title: '¿Finalizar de todas formas?', body: `<p>Atención: ${issues.join(' y ')}.</p>`, submitLabel: 'Finalizar' }))) return;
      }
      update(await run(() => updateGame(game.id, { status: next }), next === 'finished' ? 'Partida finalizada 🏆' : 'Partida reabierta'));
    };

    $('[data-delete]').onclick = async () => {
      if (!(await confirmDialog('Eliminar partida', 'Se eliminará la partida con todos sus registros. Esta acción no se puede deshacer.'))) return;
      if ((await run(() => deleteGame(game.id), 'Partida eliminada')) !== undefined) location.hash = '#/partidas';
    };

    $('[data-add-select]').onchange = async (e) => {
      if (!e.target.value) return;
      update(await run(() => addEntries(game.id, [Number(e.target.value)])));
    };

    $('[data-new-player]').onclick = async () => {
      const p = await modal({
        title: 'Jugador nuevo',
        submitLabel: 'Agregar a la partida',
        body: `<div class="form-grid"><label class="field"><span>Nombre</span><input name="name" required></label><label class="field"><span>Apodo (opcional)</span><input name="nickname"></label></div>`,
        onSubmit: (form) => createPlayer({ name: form.elements.name.value, nickname: form.elements.nickname.value }),
      });
      if (!p) return;
      players.push(p);
      update(await run(() => addEntries(game.id, [p.id]), `${p.name} agregado`));
    };

    root.querySelectorAll('[data-entry]').forEach((row) => {
      const entryId = row.dataset.entry;
      const entry = s.entries.find((e) => String(e.id) === entryId);
      const put = (body, msg) => run(() => updateEntry(entryId, body), msg).then(update);

      row.querySelectorAll('[data-rebuy]').forEach((b) => {
        b.onclick = () => put({ rebuys: Math.max(0, entry.rebuys + Number(b.dataset.rebuy)) });
      });
      row.querySelector('[data-position]').onchange = (e) => put({ position: e.target.value || null });
      row.querySelector('[data-paid]').onchange = (e) => put({ paid: e.target.checked });
      const prize = row.querySelector('[data-prize]');
      if (prize) prize.onchange = () => put({ prize_override: Number(prize.value) || 0 });
      row.querySelector('[data-remove]').onclick = async () => {
        if (!(await confirmDialog('Quitar jugador', `¿Quitar a ${entry.name} de esta partida?`, 'Quitar'))) return;
        update(await run(() => deleteEntry(entryId)));
      };
    });

    const manual = $('[data-manual]');
    if (manual) {
      manual.onclick = async () => {
        // Arranca con los montos calculados para que solo haya que ajustar.
        const g = await run(() => setPrizeOverrides(game.id, s.entries.map((e) => [e.id, e.prize])));
        if (!g) return;
        update(g);
        toast('Ahora puedes editar el premio de cada jugador. Lo que no se reparta va al fondo.');
      };
    }
    const auto = $('[data-auto]');
    if (auto) auto.onclick = async () => update(await run(() => clearPrizeOverrides(game.id), 'Premios por porcentaje'));

    $('[data-shuffle]').onclick = async () => {
      if (game.seating && !(await modal({ title: 'Volver a sortear', body: '<p>Se reemplazará la distribución actual de mesas.</p>', submitLabel: 'Sortear' }))) return;
      update(await run(() => shuffleSeating(game.id, {
        seatsPerTable: Number($('[data-seats]').value) || settings.seats_per_table,
        tables: Number($('[data-tables]').value) || undefined,
      }), 'Mesas sorteadas 🎲'));
    };
    const clear = $('[data-clear-seats]');
    if (clear) clear.onclick = async () => update(await run(() => clearSeating(game.id)));
    const print = $('[data-print]');
    if (print) print.onclick = () => window.print();
  }

  draw();
}

function editConfig(game, templates) {
  return modal({
    title: 'Configuración de la partida',
    body: `
      <div class="form-grid">
        <label class="field"><span>Fecha</span><input type="date" name="date" value="${esc(game.date)}" required></label>
        <label class="field"><span>Lugar</span><input name="location" value="${esc(game.location || '')}"></label>
        <label class="field"><span>Entrada (₡)</span><input type="number" name="buy_in" min="0" step="500" value="${game.buy_in}" required></label>
        <label class="field"><span>Recompra (₡)</span><input type="number" name="rebuy" min="0" step="500" value="${game.rebuy}" required></label>
        <label class="field"><span>Dealer por cabeza (₡)</span><input type="number" name="dealer_fee" min="0" step="500" value="${game.dealer_fee}" required></label>
      </div>
      <div class="field" style="margin-top:.75rem">
        <span>Porcentajes de premio por posición</span>
        <input name="places" value="${game.places.join(', ')}" placeholder="Ej: 70" required>
        <div class="chips" style="margin-top:.35rem">${templates.map((t) => `<button type="button" class="btn-sm" data-tpl="${t.places.join(', ')}">${esc(t.name)}</button>`).join('')}</div>
        <span class="hint" data-hint></span>
      </div>
      <label class="field" style="margin-top:.75rem"><span>Notas</span><textarea name="notes">${esc(game.notes || '')}</textarea></label>`,
    onOpen(form) {
      const input = form.elements.places;
      const hint = form.querySelector('[data-hint]');
      const sync = () => (hint.textContent = placesLabel(parsePlaces(input.value)));
      input.oninput = sync;
      form.querySelectorAll('[data-tpl]').forEach((b) => (b.onclick = () => { input.value = b.dataset.tpl; sync(); }));
      sync();
    },
    onSubmit(form) {
      const f = form.elements;
      const places = parsePlaces(f.places.value);
      if (!places.length) throw new Error('Define al menos un porcentaje de premio.');
      return updateGame(game.id, {
        date: f.date.value,
        location: f.location.value,
        buy_in: f.buy_in.value,
        rebuy: f.rebuy.value,
        dealer_fee: f.dealer_fee.value,
        places,
        notes: f.notes.value,
      });
    },
  });
}
