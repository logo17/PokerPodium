import { listYears, getFund, addFundMovement, deleteFundMovement } from '../store.js';
import { money, signed, date, esc, kpi, yearSelect, setParams, today, run, confirmDialog } from '../ui.js';

export async function render(root, { params, isCurrent }) {
  const year = params.year && params.year !== 'all' ? params.year : String(new Date().getFullYear());
  const [years, fund] = await Promise.all([listYears(), getFund(year)]);
  if (!isCurrent()) return;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Fondo fin de año ${esc(year)}</h1><div class="sub">Lo que no se reparte en premios se acumula aquí para el compartir.</div></div>
      <div class="row">${yearSelect(years, year, { all: false })}</div>
    </div>

    <div class="kpis" style="margin-bottom:1rem">
      ${kpi('Saldo', money(fund.balance), '', 'accent')}
      ${kpi('Aportes de partidas', money(fund.totalIn), `${fund.contributions.length} partidas`)}
      ${kpi('Movimientos manuales', signed(fund.totalMovements))}
    </div>

    <div class="grid grid-2">
      <section class="card">
        <h2>Aportes por partida</h2>
        ${fund.contributions.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Partida</th><th class="num">Bote</th><th class="num">Al fondo</th></tr></thead>
          <tbody>${fund.contributions.map((c) => `<tr>
            <td><a href="#/partidas/${c.game_id}">${date(c.date)}</a>${c.location ? ` <span class="muted">· ${esc(c.location)}</span>` : ''}</td>
            <td class="num">${money(c.pot)}</td><td class="num">${money(c.amount)}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td></td><td class="num">${money(fund.totalIn)}</td></tr></tfoot>
        </table></div>` : '<div class="empty">Ninguna partida finalizada ha aportado al fondo este año.</div>'}
      </section>

      <section class="card">
        <h2>Gastos y aportes extra</h2>
        <form class="form-grid no-print admin-only" data-add style="margin-bottom:1rem">
          <label class="field"><span>Fecha</span><input type="date" name="date" value="${today()}" required></label>
          <label class="field"><span>Tipo</span><select name="kind"><option value="-1">Gasto</option><option value="1">Aporte extra</option></select></label>
          <label class="field"><span>Monto (₡)</span><input type="number" name="amount" min="1" step="500" required></label>
          <label class="field" style="grid-column:1/-1"><span>Descripción</span><input name="description" placeholder="Ej: Reserva restaurante"></label>
          <div><button class="btn-primary">Registrar</button></div>
        </form>
        ${fund.movements.length ? `<ul class="list">${fund.movements.map((m) => `<li data-id="${m.id}">
          <div class="grow"><div class="title">${esc(m.description || (m.amount < 0 ? 'Gasto' : 'Aporte'))}</div><div class="muted" style="font-size:.85rem">${date(m.date)}</div></div>
          <strong>${signed(m.amount)}</strong>
          <button class="btn-sm btn-ghost btn-danger no-print admin-only" data-del title="Eliminar">✕</button>
        </li>`).join('')}</ul>` : '<p class="hint">Sin movimientos registrados.</p>'}
      </section>
    </div>`;

  const reload = () => render(root, { params, isCurrent });
  root.querySelector('[data-year]').onchange = (e) => setParams({ year: e.target.value });
  root.querySelector('[data-add]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const amount = Number(f.amount.value) * Number(f.kind.value);
    if (await run(() => addFundMovement({ date: f.date.value, amount, description: f.description.value }), 'Movimiento registrado')) reload();
  };
  root.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmDialog('Eliminar movimiento', '¿Eliminar este movimiento del fondo?'))) return;
      if ((await run(() => deleteFundMovement(b.closest('[data-id]').dataset.id))) !== undefined) reload();
    };
  });
}
