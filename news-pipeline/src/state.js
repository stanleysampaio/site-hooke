import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const MAX_SEEN = 5000;

// Links já processados (gerados, descartados por texto curto ou rejeitados pela
// curadoria), para não gastar cota da IA com eles de novo.
export function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
    return { seen: new Set(raw.seen || []) };
  } catch {
    return { seen: new Set() };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  const seen = [...state.seen].slice(-MAX_SEEN);
  fs.writeFileSync(config.stateFile, JSON.stringify({ seen, updatedAt: new Date().toISOString() }, null, 2));
}

// Evita duas execuções ao mesmo tempo (cron diário + pedido do painel).
export function acquireLock() {
  fs.mkdirSync(path.dirname(config.lockFile), { recursive: true });
  try {
    const { pid, startedAt } = JSON.parse(fs.readFileSync(config.lockFile, 'utf8'));
    const stale = Date.now() - new Date(startedAt).getTime() > 2 * 60 * 60 * 1000;
    // Em Docker cada execução tem PIDs próprios (o node costuma ser o PID 1): um
    // lock com o nosso próprio PID é sobra de um container anterior que caiu.
    let alive = false;
    if (pid !== process.pid) {
      try { process.kill(pid, 0); alive = true; } catch { /* processo não existe */ }
    }
    if (alive && !stale) return false;
  } catch { /* sem lock */ }
  fs.writeFileSync(config.lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return true;
}

export function releaseLock() {
  try { fs.unlinkSync(config.lockFile); } catch { /* já removido */ }
}
