/**
 * auth.ts — session management for C-Shopper.
 *
 * CURRENT: implemented on localStorage (name + email only, 13+ implied by the
 * legal docs; kids NEVER get accounts — COPPA). This is a demo/local auth
 * layer; there is no password and no server round-trip.
 *
 * FUTURE (Supabase Auth migration): replace ONLY the internals of these four
 * functions — the call sites in App.tsx must not change:
 *   - getSession()  -> supabase.auth.getSession() (map user -> {name,email,signedInAt})
 *   - signIn()      -> supabase.auth.signInWithOtp({ email }) for passwordless
 *                     email-link sign-in, or signInWithPassword() if passwords
 *                     are added later. Keep the (name, email) signature by
 *                     storing the display name in the user metadata on sign-up.
 *   - signOut()     -> supabase.auth.signOut()
 *   - onAuthChange()-> supabase.auth.onAuthStateChange(cb) — same callback
 *                     shape ({name, email, signedInAt} | null), so App.tsx
 *                     keeps working untouched.
 * Until then, everything below is local-only and never leaves the device.
 */

export interface AuthSession {
  name: string;
  email: string;
  signedInAt: string; // ISO timestamp
}

const SESSION_KEY = 'ws_auth_session';
const LEGACY_LOGGED_IN_KEY = 'ws_logged_in'; // kept in sync for backwards compat

type Listener = (session: AuthSession | null) => void;
const listeners = new Set<Listener>();

const notify = (session: AuthSession | null) => {
  listeners.forEach((cb) => {
    try { cb(session); } catch { /* listener error must not break auth */ }
  });
};

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.name !== 'string') return null;
    return parsed;
  } catch {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
    return null;
  }
}

/** Current session, or null when signed out. */
export function getSession(): AuthSession | null {
  return readSession();
}

/**
 * Sign in with name + email. No password by design (kids never get accounts;
 * login is a lightweight identity for community + watchlist, 13+ per the
 * Terms of Service).
 */
export function signIn(name: string, email: string): AuthSession {
  const session: AuthSession = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    signedInAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(LEGACY_LOGGED_IN_KEY, 'true');
  } catch { /* storage unavailable — session lives in memory only */ }
  notify(session);
  return session;
}

/** Sign out. Legal acceptance (per-device) is intentionally NOT cleared here. */
export function signOut(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_LOGGED_IN_KEY);
  } catch { /* ignore */ }
  notify(null);
}

/**
 * Subscribe to session changes. Returns an unsubscribe function.
 * Mirrors supabase.auth.onAuthStateChange so the migration is mechanical.
 */
export function onAuthChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
