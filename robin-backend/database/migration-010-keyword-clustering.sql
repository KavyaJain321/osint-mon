-- ============================================================
-- Migration 010: Keyword Semantic Clustering
-- Adds cluster_group column to brief_generated_keywords so
-- LLM-assigned semantic clusters can be stored and displayed.
-- Run once in Supabase SQL editor.
-- ============================================================

ALTER TABLE brief_generated_keywords
    ADD COLUMN IF NOT EXISTS cluster_group TEXT;

-- Index for fast cluster-based lookups
CREATE INDEX IF NOT EXISTS idx_brief_generated_keywords_cluster
    ON brief_generated_keywords (brief_id, cluster_group);

COMMENT ON COLUMN brief_generated_keywords.cluster_group IS
    'Semantic cluster label assigned by LLM (e.g. "Corruption & Accountability"). '
    'NULL = not yet clustered.';
