import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';

function loadEnvFromDotenv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
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
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

loadEnvFromDotenv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const port = Number(process.env.PROMPTLOG_PORT) || 3000;

const app = express();

app.get('/', (_req, res) => {
  res.sendFile(path.join(root, 'viewer.html'));
});

app.get('/api/sessions', (_req, res) => {
  res.json(db.getAllSessions());
});

app.get('/api/session/:id', (req, res) => {
  const sessions = db.getAllSessions();
  const session = sessions.find((s) => s.id === req.params.id) ?? null;
  const prompts = db.getSessionPrompts(req.params.id);
  res.json({ session, prompts });
});

app.listen(port, () => {
  console.log(`Promptlog running at http://localhost:${port}`);
});
