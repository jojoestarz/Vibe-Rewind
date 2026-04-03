import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** Repo root (directory that contains `promptlog/`). Same as db.js — not process.cwd(). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load `.env` from repo root so Cursor hooks and `npm start` agree even when cwd differs.
 * Fills vars only when missing or empty so a bad empty export does not block `.env`.
 */
export function loadDotenv() {
  try {
    const envPath = path.join(repoRoot, '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!key || val === '') continue;
      const cur = process.env[key];
      if (cur === undefined || cur === '') process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

loadDotenv();
