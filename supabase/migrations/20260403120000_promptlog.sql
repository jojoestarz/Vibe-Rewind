-- Promptlog: projects → sessions → prompts (Postgres / Supabase)

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_path TEXT NOT NULL UNIQUE,
  intent_text TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  repo TEXT,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  display_title TEXT
);

CREATE TABLE IF NOT EXISTS prompts (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  "timestamp" BIGINT NOT NULL,
  type TEXT,
  influence INTEGER,
  drift INTEGER,
  spec_coverage INTEGER,
  decision TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON sessions (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_session_seq ON prompts (session_id, seq ASC);

-- Use SUPABASE_SERVICE_ROLE_KEY from server/hooks only. Configure RLS in the Supabase dashboard if you expose anon keys.
