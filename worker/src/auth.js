// Autenticação do painel: senhas PBKDF2-SHA256 com sal por usuário, sessão
// assinada (HMAC com o secret SESSION_SECRET) que expira, e limites contra
// tentativa e erro (por usuário e por endereço de rede).
import { now } from "./db.js";

export const PBKDF2_ITERATIONS = 100000;
const SESSION_HOURS = 8;
const MAX_USER_FAILS = 5;
const LOCK_MINUTES = 15;
const MAX_IP_ATTEMPTS = 20;      // por janela
const IP_WINDOW_MINUTES = 15;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function hashPassword(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return { hash: b64url(bits), salt: b64url(salt), iterations };
}

export async function verifyPassword(password, user) {
  const { hash } = await hashPassword(password, user.pass_salt, user.pass_iterations);
  return timingSafeEqual(hash, user.pass_hash);
}

// Regras mínimas de senha (as provisórias também precisam cumprir).
export function passwordProblem(password, username) {
  const p = String(password || "");
  if (p.length < 10) return "A senha precisa ter pelo menos 10 caracteres.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Use letras e números na senha.";
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) return "A senha não pode conter o nome de usuário.";
  return null;
}

async function hmac(env, payload) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET não configurado");
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function makeToken(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({ uid: user.id, v: user.token_version, exp: Date.now() + SESSION_HOURS * 3600 * 1000 })));
  return `${payload}.${await hmac(env, payload)}`;
}

// Devolve o usuário da sessão (ativo, com a versão de token atual) ou null.
export async function userFromRequest(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!timingSafeEqual(sig, await hmac(env, payload))) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { return null; }
  if (!data || data.exp < Date.now()) return null;
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(data.uid).first();
  if (!user || !user.active || user.token_version !== data.v) return null;
  return user;
}

export function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
    active: !!u.active, mustChange: !!u.must_change, createdAt: u.created_at, lastLoginAt: u.last_login_at,
    locked: !!(u.locked_until && Date.parse(u.locked_until) > Date.now()),
  };
}

// Limite por endereço de rede: true = pode tentar.
export async function allowIp(env, ip) {
  const key = `login:${ip}`;
  const row = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(key).first();
  const windowOpen = row && Date.now() - Date.parse(row.window_start) < IP_WINDOW_MINUTES * 60 * 1000;
  if (windowOpen && row.count >= MAX_IP_ATTEMPTS) return false;
  if (windowOpen) {
    await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  } else {
    await env.DB.prepare("INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)").bind(key, now()).run();
  }
  return true;
}

export async function registerFailure(env, user) {
  const fails = user.failed_attempts + 1;
  const lock = fails >= MAX_USER_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null;
  await env.DB.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
    .bind(lock ? 0 : fails, lock, user.id).run();
  return lock;
}

export function isLocked(user) {
  return user.locked_until && Date.parse(user.locked_until) > Date.now();
}

export { LOCK_MINUTES };
