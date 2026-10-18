import { listYears, getStats, listGames, getFund } from '../store.js';
import { money, num, signed, date, esc, kpi, medal, yearSelect, yearParam, setParams } from '../ui.js';
import { openNewGame } from './games.js';

export async function render(root, { params, isCurrent }) {
  const years = await listYears();
  const year = yearParam(params);
  const [stats, games, fund] = await Promise.all([
    getStats({ year }),
    listGames({ year }),
    year ? getFund(year) : null,
  ]);
  if (!isCurrent()) return;

  const open = games.filter((g) => g.status === 'open');
  const top = stats.players.slice(0, 8);
  const mostWins = [...stats.players].sort((a, b) => b.wins - a.wins)[0];
  const r = stats.records;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Resumen ${year ? esc(year) : 'histórico'}</h1><div class="sub">Partidas finalizadas</div></div>
      <div class="row">${yearSelect(years, year)}<button class="btn-primary admin-only" data-new>+ Nueva partida</button></div>
    </div>

    ${open.length ? `<div class="card stack" style="margin-bottom:1rem;border-color:var(--accent)">
      <h2>🟢 Partida en curso</h2>
      ${open.map((g) => `<a href="#/partidas/${g.id}" class="row"><strong>${date(g.date)}</strong>${g.location ? ` · ${esc(g.location)}` : ''} · ${g.players} jugadores · bote ${money(g.pot)} →</a>`).join('')}
    </div>` : ''}

    <div class="kpis" style="margin-bottom:1rem">
      ${kpi('Partidas', stats.totals.games, `${stats.totals.players} jugadores distintos`)}
      ${kpi('Total en botes', money(stats.totals.pot), `${stats.totals.rebuys} recompras`)}
      ${kpi('Pagado a dealer', money(stats.totals.dealer))}
      ${fund ? kpi('Fondo fin de año', money(fund.balance), '<a href="#/fondo">Ver detalle</a>', 'accent') : kpi('Al fondo (histórico)', money(stats.totals.fund))}
      ${mostWins && mostWins.wins ? kpi('Más victorias', esc(mostWins.name), `${mostWins.wins} × 1° lugar`) : ''}
    </div>

    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Tabla de posiciones</h2><a href="#/estadisticas${year ? `?year=${year}` : '?year=all'}">Ver todo</a></div>
        ${top.length ? `<div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Jugador</th><th class="num">PJ</th><th class="num">1°</th><th class="num">Neto</th></tr></thead>
          <tbody>${top.map((p, i) => `<tr>
            <td>${i + 1}</td>
            <td><a href="#/jugadores/${p.player_id}${year ? `?year=${year}` : '?year=all'}">${esc(p.name)}</a></td>
            <td class="num">${p.games}</td><td class="num">${p.wins}</td><td class="num">${signed(p.net)}</td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aún no hay partidas finalizadas.</div>'}
      </section>

      <section class="card">
        <div class="card-head"><h2>Últimas partidas</h2><a href="#/partidas${year ? `?year=${year}` : '?year=all'}">Ver todas</a></div>
        ${games.length ? `<ul class="list">${games.slice(0, 6).map((g) => `<li>
          <div class="grow">
            <a class="title" href="#/partidas/${g.id}">${date(g.date)}</a>
            <span class="badge ${g.status === 'open' ? 'badge-open' : 'badge-done'}">${g.status === 'open' ? 'En curso' : 'Finalizada'}</span>
            <div class="muted" style="font-size:.85rem">${g.players} jugadores · ${g.totalRebuys} recompras · bote ${money(g.pot)}</div>
          </div>
          <div>${g.winners.filter((w) => w.position === 1).map((w) => `${medal(1)} ${esc(w.name)}`).join(', ')}</div>
        </li>`).join('')}</ul>` : '<div class="empty">No hay partidas registradas.</div>'}
      </section>

      ${stats.totals.games ? `<section class="card">
        <h2>Récords</h2>
        <ul class="list">
          ${r.biggestPot ? `<li><span class="grow">Bote más grande</span><a href="#/partidas/${r.biggestPot.game_id}">${money(r.biggestPot.value)} · ${date(r.biggestPot.date)}</a></li>` : ''}
          ${r.biggestPrize ? `<li><span class="grow">Premio más grande</span><span>${money(r.biggestPrize.value)} · ${esc(r.biggestPrize.name)}</span></li>` : ''}
          ${r.mostRebuys ? `<li><span class="grow">Más recompras en una noche</span><span>${r.mostRebuys.value} · ${esc(r.mostRebuys.name)}</span></li>` : ''}
          ${r.mostPlayers ? `<li><span class="grow">Más jugadores</span><a href="#/partidas/${r.mostPlayers.game_id}">${r.mostPlayers.value} · ${date(r.mostPlayers.date)}</a></li>` : ''}
          <li><span class="grow">Promedio de bote</span><span>${money(stats.totals.pot / stats.totals.games)}</span></li>
          <li><span class="grow">Promedio de jugadores</span><span>${num(stats.totals.entries / stats.totals.games)}</span></li>
        </ul>
      </section>` : ''}
    </div>`;

  root.querySelector('[data-year]').onchange = (e) => setParams({ year: e.target.value });
  root.querySelector('[data-new]').onclick = openNewGame;
}
