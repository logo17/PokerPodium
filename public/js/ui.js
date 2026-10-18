const moneyFmt = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 1 });
const pctFmt = new Intl.NumberFormat('es-CR', { style: 'percent', maximumFractionDigits: 0 });

export const money = (n) => moneyFmt.format(n || 0);
export const num = (n) => numFmt.format(n || 0);
export const pct = (n) => pctFmt.format(n || 0);
export const signed = (n) => `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted'}">${n > 0 ? '+' : ''}${money(n)}</span>`;

export function date(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CR', opts);
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const playerName = (p) => esc(p.nickname ? `${p.name} (${p.nickname})` : p.name);

export function medal(position) {
  if (!position) return '<span class="muted">—</span>';
  return `<span class="medal medal-${position}">${position}</span>`;
}

export function kpi(label, value, sub = '', cls = '') {
  return `<div class="kpi ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2500);
}

// Ejecuta una acción async mostrando errores como toast. Devuelve el resultado o undefined.
export async function run(fn, success) {
  try {
    const r = await fn();
    if (success) toast(success);
    return r;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/**
 * Abre un modal. `body` es HTML. `onSubmit(form)` puede devolver false para mantenerlo abierto.
 * Resuelve con el valor de onSubmit, o null si se cancela.
 */
export function modal({ title, body, submitLabel = 'Guardar', danger = false, onSubmit, onOpen }) {
  const dlg = document.getElementById('modal');
  dlg.innerHTML = `
    <form method="dialog">
      <div class="modal-body">
        <h2>${esc(title)}</h2>
        ${body}
      </div>
      <div class="modal-actions">
        <button type="button" value="cancel" data-cancel>Cancelar</button>
        <button type="submit" class="${danger ? 'btn-primary btn-danger' : 'btn-primary'}" ${danger ? 'style="background:var(--neg);border-color:var(--neg);color:#fff"' : ''}>${esc(submitLabel)}</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      dlg.close();
      resolve(v);
    };
    form.querySelector('[data-cancel]').onclick = () => done(null);
    dlg.onclose = () => done(null);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const r = onSubmit ? await onSubmit(form) : true;
        if (r !== false) done(r ?? true);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };
    dlg.showModal();
    onOpen?.(form);
    form.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
  });
}

export const confirmDialog = (title, message, submitLabel = 'Eliminar') =>
  modal({ title, body: `<p>${esc(message)}</p>`, submitLabel, danger: true });

// Año seleccionado en la URL: por defecto el actual; "all" = sin filtro ('').
export const yearParam = (params) => (params.year === 'all' ? '' : params.year || String(new Date().getFullYear()));

export function yearSelect(years, selected, { all = true } = {}) {
  return `<select data-year>
    ${all ? `<option value="all" ${!selected ? 'selected' : ''}>Todos los años</option>` : ''}
    ${years.map((y) => `<option value="${y}" ${String(y) === String(selected) ? 'selected' : ''}>${y}</option>`).join('')}
  </select>`;
}

// Parsea "70, 20, 10" → [70, 20, 10]
export function parsePlaces(text) {
  return String(text)
    .split(/[,;\s/]+/)
    .map((s) => Number(s.replace('%', '')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const placesLabel = (places) => {
  const reserve = 100 - places.reduce((a, b) => a + b, 0);
  const parts = places.map((p, i) => `${i + 1}° ${num(p)}%`);
  if (reserve > 0.0001) parts.push(`Fondo ${num(reserve)}%`);
  return parts.join(' · ');
};

// Ordenamiento de tablas por columna (estado en memoria por clave).
export function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const r = typeof x === 'string' ? x.localeCompare(y, 'es') : (x ?? -Infinity) - (y ?? -Infinity);
    return dir === 'asc' ? r : -r;
  });
}

export function downloadCsv(filename, header, rows) {
  const escCell = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escCell).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  URL.revokeObjectURL(a.href);
}

// Navega cambiando solo los parámetros de la URL actual (filtros).
export function setParams(params) {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  location.hash = `#/${path}${q.toString() ? `?${q}` : ''}`;
}
