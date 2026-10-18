import { listYears, getStats } from '../store.js';
import { money, num, pct, signed, date, esc, kpi, yearSelect, yearParam, setParams, sortRows, downloadCsv } from '../ui.js';

const COLUMNS = [
  { key: 'name', label: 'Jugador', fmt: (p) => `<a href="#/jugadores/${p.player_id}">${esc(p.name)}</a>` },
  { key: 'games', label: 'PJ', num: true, title: 'Partidas jugadas' },
  { key: 'wins', label: '1°', num: true },
  { key: 'seconds', label: '2°', num: true },
  { key: 'thirds', label: '3°', num: true },
  { key: 'cashes', label: 'Cobró', num: true, title: 'Veces que ganó dinero' },
  { key: 'winRate', label: '% Vict.', num: true, fmt: (p) => pct(p.winRate) },
  { key: 'rebuys', label: 'Recompras', num: true },
  { key: 'avgRebuys', label: 'Rec./PJ', num: true, fmt: (p) => num(p.avgRebuys), title: 'Recompras promedio por partida' },
  { key: 'spent', label: 'Gastó', num: true, fmt: (p) => money(p.spent) },
  { key: 'won', label: 'Ganó', num: true, fmt: (p) => money(p.won) },
  { key: 'net', label: 'Neto', num: true, fmt: (p) => signed(p.net) },
  { key: 'roi', label: 'ROI', num: true, fmt: (p) => pct(p.roi), title: 'Neto / gastado' },
];

let sort = { key: 'net', dir: 'desc' };

export async function render(root, { params, isCurrent }) {
  const year = params.from || params.to ? '' : yearParam(params);
  const [years, stats] = await Promise.all([listYears(), getStats({ year, from: params.from, to: params.to })]);
  if (!isCurrent()) return;
  const t = stats.totals;
  let search = '';

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Estadísticas</h1><div class="sub">${params.from || params.to ? `Del ${params.from ? date(params.from) : 'inicio'} al ${params.to ? date(params.to) : 'hoy'}` : year ? `Año ${esc(year)}` : 'Histórico'} · partidas finalizadas</div></div>
    </div>

    <div class="card row no-print" style="margin-bottom:1rem">
      ${yearSelect(years, year)}
      <span class="muted">o rango:</span>
      <input type="date" data-from value="${esc(params.from || '')}" aria-label="Desde">
      <input type="date" data-to value="${esc(params.to || '')}" aria-label="Hasta">
      <button class="btn-sm" data-range>Aplicar</button>
      <span class="spacer"></span>
      <input type="search" placeholder="Buscar jugador…" data-search>
      <button class="btn-sm" data-csv>Exportar CSV</button>
    </div>

    <div class="kpis" style="margin-bottom:1rem">
      ${kpi('Partidas', t.games)}
      ${kpi('Jugadores', t.players, `${t.entries} participaciones`)}
      ${kpi('Total en botes', money(t.pot), t.games ? `Promedio ${money(t.pot / t.games)}` : '')}
      ${kpi('Recompras', t.rebuys, t.entries ? `${num(t.rebuys / t.entries)} por jugador` : '')}
      ${kpi('Premios pagados', money(t.prizes))}
      ${kpi('Al fondo', money(t.fund))}
      ${kpi('Dealer', money(t.dealer))}
    </div>

    <section class="card">
      <h2>Tabla general</h2>
      <div class="table-wrap" data-table></div>
      <p class="hint">Toca un encabezado para ordenar. Gastó incluye entrada, recompras y dealer.</p>
    </section>`;

  const drawTable = () => {
    const rows = sortRows(stats.players.filter((p) => p.name.toLowerCase().includes(search)), sort.key, sort.dir);
    root.querySelector('[data-table]').innerHTML = rows.length
      ? `<table>
        <thead><tr><th>#</th>${COLUMNS.map((c) => `<th class="sortable ${c.num ? 'num' : ''} ${sort.key === c.key ? `sorted ${sort.dir}` : ''}" data-sort="${c.key}" ${c.title ? `title="${c.title}"` : ''}>${c.label}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((p, i) => `<tr><td class="muted">${i + 1}</td>${COLUMNS.map((c) => `<td class="${c.num ? 'num' : ''}">${c.fmt ? c.fmt(p) : esc(p[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`
      : '<div class="empty">Sin datos para este filtro.</div>';
    root.querySelectorAll('[data-sort]').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        sort = { key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : key === 'name' ? 'asc' : 'desc' };
        drawTable();
      };
    });
  };
  drawTable();

  root.querySelector('[data-year]').onchange = (e) => setParams({ year: e.target.value });
  root.querySelector('[data-range]').onclick = () =>
    setParams({ from: root.querySelector('[data-from]').value, to: root.querySelector('[data-to]').value });
  root.querySelector('[data-search]').oninput = (e) => {
    search = e.target.value.trim().toLowerCase();
    drawTable();
  };
  root.querySelector('[data-csv]').onclick = () =>
    downloadCsv(
      `estadisticas-${year || 'historico'}.csv`,
      COLUMNS.map((c) => c.label),
      sortRows(stats.players, sort.key, sort.dir).map((p) =>
        COLUMNS.map((c) => (['winRate', 'roi'].includes(c.key) ? (p[c.key] * 100).toFixed(1) : c.key === 'avgRebuys' ? p[c.key].toFixed(2) : p[c.key])),
      ),
    );
}
