-- ============================================================
-- brief_newspaper_jobs — tracks newspaper extraction jobs
-- ============================================================

CREATE TABLE IF NOT EXISTS brief_newspaper_jobs (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    brief_id    UUID NOT NULL REFERENCES client_briefs(id) ON DELETE CASCADE,
    job_id      TEXT NOT NULL,
    source_name TEXT NOT NULL,
    pdf_url     TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | completed | failed
    match_count INTEGER DEFAULT 0,
    error       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by brief
CREATE INDEX IF NOT EXISTS idx_bnj_brief_id ON brief_newspaper_jobs(brief_id);
CREATE INDEX IF NOT EXISTS idx_bnj_status   ON brief_newspaper_jobs(status);

-- RLS
ALTER TABLE brief_newspaper_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on brief_newspaper_jobs"
    ON brief_newspaper_jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);
