import * as db from './db.js';

/**
 * @param {import('express').Express} app
 */
export function attachPromptlogRoutes(app) {
  app.get('/api/health', async (_req, res) => {
    try {
      const sessions = await db.getAllSessions();
      res.json({ ok: true, sessionCount: sessions.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/projects', async (_req, res) => {
    try {
      const sessions = await db.getAllSessions();
      const byProj = new Map();
      for (const s of sessions) {
        const pid = s.project_id;
        if (!pid) continue;
        if (!byProj.has(pid)) {
          byProj.set(pid, {
            id: pid,
            repo_path: s.project_repo_path ?? '',
            intent_text: s.project_intent ?? '',
            session_count: 0,
            last_started_at: 0,
          });
        }
        const g = byProj.get(pid);
        g.session_count += 1;
        const st = Number(s.started_at) || 0;
        if (st > g.last_started_at) g.last_started_at = st;
      }
      const list = [...byProj.values()].sort(
        (a, b) => b.last_started_at - a.last_started_at
      );
      res.json(list);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/projects/:projectId/sessions', async (req, res) => {
    try {
      const pid = req.params.projectId;
      const all = await db.getAllSessions();
      const filtered = all
        .filter((s) => s.project_id === pid)
        .sort((a, b) => (Number(b.started_at) || 0) - (Number(a.started_at) || 0));
      res.json(filtered);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/sessions', async (_req, res) => {
    try {
      res.json(await db.getAllSessions());
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/session/:id', async (req, res) => {
    try {
      const sessions = await db.getAllSessions();
      const session = sessions.find((s) => s.id === req.params.id) ?? null;
      const prompts = await db.getSessionPrompts(req.params.id);
      const project = session
        ? {
            id: session.project_id,
            intent_text: session.project_intent ?? '',
            repo_path: session.project_repo_path ?? session.repo ?? '',
          }
        : null;
      res.json({ session, prompts, project });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
