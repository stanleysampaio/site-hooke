// Gera o SQL do usuário administrador inicial (senha provisória, troca
// obrigatória no 1º login) e das regras editoriais atuais. Uso:
//   node scripts/seed-admin.mjs <usuario> "<nome>" "<senha provisória>" > seed.sql
//   wrangler d1 execute hooke-news --remote --file seed.sql   (e apague o seed.sql)
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const [username, name, password] = process.argv.slice(2);
if (!username || !name || !password) {
  console.error('uso: node scripts/seed-admin.mjs <usuario> "<nome>" "<senha>"');
  process.exit(1);
}
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const iterations = 100000; // igual a PBKDF2_ITERATIONS em src/auth.js
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const rules = readFileSync(new URL("../../news-pipeline/regras-editoriais.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

console.log(`INSERT OR IGNORE INTO users (id, username, name, email, role, pass_hash, pass_salt, pass_iterations, must_change, active, token_version, failed_attempts, created_at)
VALUES (${q(randomUUID())}, ${q(username.toLowerCase())}, ${q(name)}, NULL, 'admin', ${q(b64url(hash))}, ${q(b64url(salt))}, ${iterations}, 1, 1, 1, 0, ${q(now)});`);
console.log(`INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('rules', ${q(rules)}, ${q(now)}, 'importação inicial');`);
console.log(`INSERT INTO settings_history (key, value, at, username) VALUES ('rules', ${q(rules)}, ${q(now)}, 'importação inicial');`);
