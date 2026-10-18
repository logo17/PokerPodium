import { listYears, playerStats } from '../store.js';
import { money, num, pct, signed, date, esc, kpi, medal, yearSelect, yearParam, setParams } from '../ui.js';

export async function render(root, { args, params, isCurrent }) {
  const year = yearParam(params);
  const [years, data] = await Promise.all([listYears(), playerStats(args[0], { year })]);
  if (!isCurrent()) return;
  const { player, stats: s, history } = data;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/jugadores" class="muted">← Jugadores</a>
        <h1>${esc(player.name)}${player.nickname ? ` <span class="muted" style="font-weight:400">“${esc(player.nickname)}”</span>` : ''}</h1>
        <div class="sub">${year ? `Año ${esc(year)}` : 'Histórico'} · partidas finalizadas</div>
      </div>
      <div class="row">${yearSelect(years, year)}</div>
    </div>

    <div class="kpis" style="margin-bottom:1rem">
      ${kpi('Neto', signed(s.net), `ROI ${pct(s.roi)}`, 'accent')}
      ${kpi('Partidas', s.games)}
      ${kpi('Victorias', s.wins, s.games ? `${pct(s.winRate)} de las partidas` : '')}
      ${kpi('Podios', `${s.wins} · ${s.seconds} · ${s.thirds}`, '1° · 2° · 3°')}
      ${kpi('Cobró premio', s.cashes, s.games ? pct(s.cashRate) : '')}
      ${kpi('Recompras', s.rebuys, `${num(s.avgRebuys)} por partida · máx ${s.maxRebuysInGame}`)}
      ${kpi('Total gastado', money(s.spent))}
      ${kpi('Total ganado', money(s.won))}
    </div>

    <section class="card">
      <h2>Historial</h2>
      ${history.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th class="num">Jug.</th><th>Pos.</th><th class="num">Recompras</th><th class="num">Gastó</th><th class="num">Premio</th><th class="num">Neto</th><th class="num">Acumulado</th></tr></thead>
        <tbody>${history.map((h) => `<tr>
          <td><a href="#/partidas/${h.game_id}">${date(h.date)}</a></td>
          <td class="num">${h.players}</td>
          <td>${medal(h.position)}</td>
          <td class="num">${h.rebuys}</td>
          <td class="num">${money(h.spent)}</td>
          <td class="num">${h.prize ? money(h.prize) : '<span class="muted">—</span>'}</td>
          <td class="num">${signed(h.net)}</td>
          <td class="num">${signed(h.cumulative)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">Sin partidas en este periodo.</div>'}
    </section>`;

  root.querySelector('[data-year]').onchange = (e) => setParams({ year: e.target.value });
}
