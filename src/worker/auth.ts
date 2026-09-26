import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import type { Env } from './env';

type AppContext = Context<{ Bindings: Env; Variables: { csrfToken: string } }>;
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function randomToken(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, roundsText, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'pbkdf2-sha256' || !roundsText || !saltText || !hashText) return false;
  const rounds = Number(roundsText);
  if (!Number.isInteger(rounds) || rounds < 100_000 || rounds > 1_000_000) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = base64ToBytes(saltText);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations: rounds }, key, 256));
  const expected = base64ToBytes(hashText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

async function currentSession(c: AppContext): Promise<{ csrf_token: string } | null> {
  const token = getCookie(c, 'marketing_session');
  if (!token || !c.env.SESSION_SECRET) return null;
  const hash = await sha256(`${c.env.SESSION_SECRET}:${token}`);
  return c.env.DB.prepare('SELECT csrf_token FROM sessions WHERE id_hash=? AND expires_at > ?')
    .bind(hash, new Date().toISOString()).first<{ csrf_token: string }>();
}

export async function requireAuth(c: AppContext, next: Next): Promise<Response | void> {
  if (c.env.APP_ENV === 'local' && c.env.DEV_AUTH_BYPASS === 'true') {
    c.set('csrfToken', 'local-dev-token');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('X-CSRF-Token') !== 'local-dev-token')
      return c.json({ error: 'Token CSRF inválido' }, 403);
    return next();
  }
  const session = await currentSession(c);
  if (!session) return c.json({ error: 'Sessão expirada ou inválida' }, 401);
  c.set('csrfToken', session.csrf_token);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('X-CSRF-Token') !== session.csrf_token)
    return c.json({ error: 'Token CSRF inválido' }, 403);
  return next();
}

export async function getSession(c: AppContext): Promise<Response> {
  if (c.env.APP_ENV === 'local' && c.env.DEV_AUTH_BYPASS === 'true')
    return c.json({ data: { authenticated: true, username: 'Marketing', csrfToken: 'local-dev-token' } });
  const session = await currentSession(c);
  return c.json({ data: session
    ? { authenticated: true, username: c.env.ADMIN_USERNAME ?? 'Marketing', csrfToken: session.csrf_token }
    : { authenticated: false } });
}

export async function login(c: AppContext): Promise<Response> {
  if (!c.env.ADMIN_USERNAME || !c.env.ADMIN_PASSWORD_HASH || !c.env.SESSION_SECRET)
    return c.json({ error: 'Login ainda não configurado' }, 503);
  const input = await c.req.json().catch(() => null) as { username?: string; password?: string } | null;
  if (!input || typeof input.username !== 'string' || typeof input.password !== 'string')
    return c.json({ error: 'Informe usuário e senha' }, 400);
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await sha256(`${c.env.SESSION_SECRET}:${ip}`);
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const attempts = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE ip_hash=? AND attempted_at>?')
    .bind(ipHash, since).first<{ count: number }>();
  if ((attempts?.count ?? 0) >= 5) return c.json({ error: 'Muitas tentativas. Tente novamente em 15 minutos.' }, 429);
  const valid = input.username === c.env.ADMIN_USERNAME && await verifyPassword(input.password, c.env.ADMIN_PASSWORD_HASH);
  if (!valid) {
    await c.env.DB.prepare('INSERT INTO login_attempts (ip_hash, attempted_at) VALUES (?, ?)')
      .bind(ipHash, new Date().toISOString()).run();
    return c.json({ error: 'Usuário ou senha inválidos' }, 401);
  }
  const token = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash=?').bind(ipHash),
    c.env.DB.prepare('INSERT INTO sessions (id_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(`${c.env.SESSION_SECRET}:${token}`), csrfToken,
        new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString(), now.toISOString()),
  ]);
  setCookie(c, 'marketing_session', token, {
    httpOnly: true, secure: c.env.APP_ENV !== 'local', sameSite: 'Strict', path: '/', maxAge: SESSION_SECONDS,
  });
  return c.json({ data: { authenticated: true, username: c.env.ADMIN_USERNAME, csrfToken } });
}

export async function logout(c: AppContext): Promise<Response> {
  const token = getCookie(c, 'marketing_session');
  if (token && c.env.SESSION_SECRET) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash=?')
    .bind(await sha256(`${c.env.SESSION_SECRET}:${token}`)).run();
  deleteCookie(c, 'marketing_session', { path: '/' });
  return c.json({ data: { authenticated: false } });
}
