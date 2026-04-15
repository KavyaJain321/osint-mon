-- migration-011-ai-jobs.sql
-- Creates the ai_jobs queue table used by the TRIJYA-7 GPU worker.
-- This table was previously only on the old Supabase instance.
-- Run this in Supabase SQL Editor on any fresh database.

CREATE TABLE IF NOT EXISTS ai_jobs (
    id          UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    type        TEXT            NOT NULL,                        -- e.g. 'analyze_article', 'video_pipeline'
    status      TEXT            NOT NULL DEFAULT 'pending',      -- pending | processing | completed | failed | cancelled
    priority    INT             NOT NULL DEFAULT 3,              -- 1 = highest, 5 = lowest
    payload     JSONB           NOT NULL DEFAULT '{}'::jsonb,    -- job input data
    result      JSONB,                                           -- job output (written by worker)
    error       TEXT,                                           -- failure reason
    model_used  TEXT,                                           -- e.g. 'trijya7', 'groq/llama-3.3'
    worker      TEXT,                                           -- worker identifier
    client_id   UUID            REFERENCES clients(id) ON DELETE SET NULL,
    started_at  TIMESTAMPTZ,                                    -- when worker picked it up
    expires_at  TIMESTAMPTZ     NOT NULL,                       -- auto-expire after TTL
    created_at  TIMESTAMPTZ     DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status   ON ai_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_type     ON ai_jobs(type);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_client   ON ai_jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_priority ON ai_jobs(priority, created_at);

-- RLS: allow all operations (worker and backend both need full access)
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_jobs_all" ON ai_jobs;
CREATE POLICY "ai_jobs_all" ON ai_jobs FOR ALL USING (true);
