# ♠ Poker Podium

Control de las partidas de poker del grupo: entradas, recompras, premios, dealer, fondo de fin de año, estadísticas y sorteo de mesas.

**Arquitectura:** página estática (HTML + JS, sin build) publicada en **GitHub Pages**, con los datos en **Supabase** (Postgres + Auth). Todo en planes gratuitos.

- Cualquiera con el enlace puede **ver** resultados y estadísticas.
- Solo los **administradores** (correos en la tabla `admins`) pueden registrar o cambiar datos. Lo garantizan las reglas RLS de la base de datos, no la página.

---

## Puesta en marcha (≈15 minutos, una sola vez)

### 1. Supabase

1. En [supabase.com](https://supabase.com) → **New project**. Región sugerida: *East US* (la más cercana a Costa Rica).
2. **SQL Editor → New query**, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y dale **Run**.
3. En otra query, agrega los correos que pueden editar:
   ```sql
   insert into public.admins (email) values
     ('correo-1@ejemplo.com'),
     ('correo-2@ejemplo.com')
   on conflict do nothing;
   ```
4. **Authentication → Users → Add user → Create new user**: correo + contraseña de cada administrador, marcando **Auto Confirm User**.
5. Recomendado: **Authentication → Sign In / Providers** → desactiva **Allow new users to sign up** (así nadie más puede crear cuentas).
6. **Project Settings → API** (o el botón **Connect**): copia la **Project URL** y la **anon public key**.

### 2. Configurar la app

Edita [`public/js/config.js`](public/js/config.js):

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

> La *anon key* es pública por diseño (va dentro de la página). Lo que protege los datos son las reglas de seguridad del esquema. **Nunca** pongas aquí la `service_role` key.

Pruébala localmente (requiere Node 20+):

```bash
npm run dev     # http://localhost:3000
npm test        # pruebas de la lógica de dinero y mesas
```

### 3. Publicar en GitHub Pages

1. Crea un repositorio **público** en GitHub (GitHub Pages gratis requiere repo público) y sube el proyecto a la rama `main`.
2. En el repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada push a `main` corre las pruebas y publica la carpeta `public/` (workflow [`deploy.yml`](.github/workflows/deploy.yml)).
4. La app queda en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

### 4. Evitar que Supabase se pause

Supabase pausa los proyectos gratis tras **7 días sin actividad**. El workflow [`keep-alive.yml`](.github/workflows/keep-alive.yml) hace una consulta mínima cada 3 días.

- Para verificarlo: pestaña **Actions → Mantener Supabase activo → Run workflow**. Debe terminar en verde.
- GitHub desactiva las tareas programadas de un repo si pasan **60 días sin commits**; te avisa por correo y se reactiva con un clic en la pestaña Actions.
- Si aun así se pausa, nada se pierde: en el panel de Supabase se le da **Restore project**.

---

## Reglas de dinero

| Concepto | Cálculo |
|---|---|
| Bote | jugadores × entrada + recompras × valor recompra |
| Premio por posición | bote × % de esa posición (en colones enteros) |
| Fondo fin de año | bote − premios (el % no repartido) |
| Dealer | jugadores × cuota por cabeza (se cobra aparte, **no** sale del bote) |
| Gastó (por jugador) | entrada + recompras × valor + dealer |
| Neto | premio − gastó |

Cada partida guarda su propia configuración, así que cambiar los valores por defecto no altera el historial.

**Estructuras de premios**: porcentajes por posición, p. ej. `100` (solo 1°), `65, 35`, `50, 30, 20`, o `70` (1° se lleva 70% y 30% va al fondo).
**Reparto manual**: para un *chop* o acuerdos, "Repartir manualmente" en la partida permite editar el premio de cada jugador; lo no repartido va al fondo.

## Estructura

```
public/                 Lo que se publica (sin build)
  index.html
  css/styles.css
  js/config.js          URL y anon key de Supabase
  js/supabase.js        Cliente y sesión
  js/store.js           Lecturas/escrituras a la base de datos
  js/calc.js            Bote, premios, fondo, estadísticas y sorteo de mesas
  js/views/             Inicio, partidas, partida, jugadores, estadísticas, fondo, ajustes
supabase/schema.sql     Tablas, reglas de seguridad (RLS) y datos iniciales
scripts/dev-server.js   Servidor local para desarrollo
test/                   Pruebas (node --test)
.github/workflows/      Publicación en Pages y keep-alive de Supabase
```

Respaldo: *Ajustes → Descargar respaldo* (JSON con todas las tablas). Supabase también permite exportar desde su panel.
