import { auth } from '../supabase.js';
import { getSettings, saveSettings, listTemplates, saveTemplate, deleteTemplate, exportAll } from '../store.js';
import { esc, modal, confirmDialog, run, placesLabel, parsePlaces } from '../ui.js';

export async function render(root, { isCurrent }) {
  const [settings, templates] = await Promise.all([getSettings(), listTemplates()]);
  if (!isCurrent()) return;
  const ro = auth.isAdmin ? '' : 'disabled';

  root.innerHTML = `
    <div class="page-head"><h1>Ajustes</h1></div>
    <div class="grid grid-2">
      <section class="card">
        <h2>Valores por defecto</h2>
        <p class="hint">Se copian a cada partida nueva. Cambiarlos no afecta partidas anteriores.</p>
        <form data-settings class="stack">
          <fieldset ${ro} style="border:0;padding:0;margin:0" class="stack">
            <label class="field"><span>Nombre del grupo</span><input name="group_name" value="${esc(settings.group_name)}"></label>
            <div class="form-grid">
              <label class="field"><span>Entrada (₡)</span><input type="number" name="buy_in" min="0" step="500" value="${esc(settings.buy_in)}"></label>
              <label class="field"><span>Recompra (₡)</span><input type="number" name="rebuy" min="0" step="500" value="${esc(settings.rebuy)}"></label>
              <label class="field"><span>Dealer por cabeza (₡)</span><input type="number" name="dealer_fee" min="0" step="500" value="${esc(settings.dealer_fee)}"></label>
              <label class="field"><span>Máx. jugadores por mesa</span><input type="number" name="seats_per_table" min="2" max="12" value="${esc(settings.seats_per_table)}"></label>
            </div>
            <label class="field"><span>Estructura de premios por defecto</span>
              <select name="default_template_id">${templates.map((t) => `<option value="${t.id}" ${String(t.id) === settings.default_template_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
            </label>
          </fieldset>
          <div class="admin-only"><button class="btn-primary">Guardar</button></div>
        </form>
      </section>

      <section class="card">
        <div class="card-head"><h2>Estructuras de premios</h2><button class="btn-sm admin-only" data-new-tpl>+ Nueva</button></div>
        <p class="hint">Porcentaje del bote para cada posición. Lo que falte para 100% va al fondo de fin de año.</p>
        <ul class="list">${templates.map((t) => `<li data-id="${t.id}">
          <div class="grow"><div class="title">${esc(t.name)}</div><div class="muted" style="font-size:.85rem">${placesLabel(t.places)}</div></div>
          <button class="btn-sm admin-only" data-edit>Editar</button>
          <button class="btn-sm btn-ghost btn-danger admin-only" data-del title="Eliminar">✕</button>
        </li>`).join('')}</ul>
      </section>

      <section class="card stack">
        <h2>Acceso</h2>
        ${auth.isAdmin
          ? `<p><span class="badge badge-done">Administrador</span> Sesión iniciada como <strong>${esc(auth.user.email)}</strong>.</p>`
          : auth.user
            ? `<p><span class="badge badge-open">Solo lectura</span> <strong>${esc(auth.user.email)}</strong> no está en la lista de administradores.</p>`
            : '<p><span class="badge">Solo lectura</span> Cualquiera con el enlace puede ver. Para registrar resultados usa <strong>Entrar</strong> arriba.</p>'}
        <p class="hint">Los administradores se agregan en Supabase (tabla <code>admins</code> + usuario en Authentication). Ver README.</p>
      </section>

      <section class="card stack">
        <h2>Respaldo</h2>
        <p class="hint">Descarga todos los datos en un archivo JSON. Recomendado hacerlo cada cierto tiempo.</p>
        <div><button data-export>⬇ Descargar respaldo</button></div>
      </section>
    </div>`;

  const reload = () => render(root, { isCurrent });

  root.querySelector('[data-settings]').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (await run(() => saveSettings(body), 'Ajustes guardados')) {
      document.getElementById('brand-name').textContent = body.group_name || 'Poker Podium';
    }
  };

  const editTpl = (t) =>
    modal({
      title: t ? 'Editar estructura' : 'Nueva estructura',
      body: `
        <label class="field"><span>Nombre</span><input name="name" value="${esc(t?.name || '')}" placeholder="Ej: Top 2 + fondo" required></label>
        <label class="field" style="margin-top:.75rem"><span>Porcentajes por posición</span><input name="places" value="${t ? t.places.join(', ') : ''}" placeholder="Ej: 60, 25" required></label>
        <p class="hint" data-hint></p>`,
      onOpen(form) {
        const sync = () => (form.querySelector('[data-hint]').textContent = placesLabel(parsePlaces(form.elements.places.value)));
        form.elements.places.oninput = sync;
        sync();
      },
      onSubmit: (form) => saveTemplate(t?.id, { name: form.elements.name.value, places: parsePlaces(form.elements.places.value) }),
    }).then((ok) => ok && reload());

  root.querySelector('[data-new-tpl]').onclick = () => editTpl(null);
  root.querySelectorAll('[data-id]').forEach((li) => {
    const t = templates.find((x) => String(x.id) === li.dataset.id);
    li.querySelector('[data-edit]').onclick = () => editTpl(t);
    li.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmDialog('Eliminar estructura', `¿Eliminar "${t.name}"? Las partidas existentes no se modifican.`))) return;
      if ((await run(() => deleteTemplate(t.id))) !== undefined) reload();
    };
  });

  root.querySelector('[data-export]').onclick = async () => {
    const dump = await run(exportAll);
    if (!dump) return;
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `poker-respaldo-${dump.exported_at.slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };
}
