// Gera o SQL das editorias e temas iniciais a partir da lista de reserva do
// news-pipeline (src/sources.js). Só insere o que ainda não existe. Uso:
//   node scripts/seed-themes.mjs > themes.sql
//   wrangler d1 execute hooke-news --remote --file themes.sql   (e apague o themes.sql)
import { randomUUID } from "node:crypto";
import { DEFAULT_EDITORIAS, DEFAULT_THEMES } from "../../news-pipeline/src/sources.js";

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
DEFAULT_EDITORIAS.forEach((e, i) => {
  console.log(`INSERT OR IGNORE INTO editorias (name, max_per_run, active, sort, created_at, updated_at) VALUES (${q(e.name)}, ${e.maxPerRun}, 1, ${i + 1}, ${q(now)}, ${q(now)});`);
});
for (const t of DEFAULT_THEMES) {
  console.log(`INSERT INTO themes (id, editoria, kind, value, priority, active, created_at, created_by)
SELECT ${q(randomUUID())}, ${q(t.editoria)}, ${q(t.kind)}, ${q(t.value)}, ${t.priority ? 1 : 0}, 1, ${q(now)}, 'importação inicial'
WHERE NOT EXISTS (SELECT 1 FROM themes WHERE editoria = ${q(t.editoria)} AND value = ${q(t.value)});`);
}
