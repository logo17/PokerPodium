import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = /^https:\/\/.+\.supabase\.co/.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.startsWith('TU-');

export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Estado de sesión compartido por las vistas.
export const auth = { user: null, isAdmin: false };

export async function refreshAuth() {
  const { data } = await supabase.auth.getSession();
  auth.user = data.session?.user ?? null;
  auth.isAdmin = false;
  if (auth.user) {
    const { data: ok } = await supabase.rpc('is_admin');
    auth.isAdmin = ok === true;
  }
  document.body.classList.toggle('readonly', !auth.isAdmin);
  return auth;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
  return refreshAuth();
}

export async function signOut() {
  await supabase.auth.signOut();
  return refreshAuth();
}
