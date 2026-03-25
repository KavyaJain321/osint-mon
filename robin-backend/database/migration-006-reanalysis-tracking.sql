-- Migration 006: Add reanalysis_needed flag to article_analysis
-- Set true when analysis was done by local_fallback (rule-based) — flags for upgrade
-- when TRIJYA-7 / Groq becomes available.

ALTER TABLE article_analysis
    ADD COLUMN IF NOT EXISTS reanalysis_needed BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient polling of articles needing reanalysis
CREATE INDEX IF NOT EXISTS idx_article_analysis_reanalysis
    ON article_analysis (reanalysis_needed)
    WHERE reanalysis_needed = true;

-- Backfill: mark existing local_fallback analyses as needing reanalysis
UPDATE article_analysis
SET reanalysis_needed = true
WHERE analyzer_used = 'local_fallback'
  AND reanalysis_needed = false;
