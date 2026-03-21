-- ============================================================
-- Migration 007: Video Translation Support
-- Adds original_text column to video_transcripts for Odia → English
-- full_text now stores English (translated if Odia, original if English)
-- original_text stores the raw Odia transcript (null for English videos)
-- ============================================================

ALTER TABLE video_transcripts
    ADD COLUMN IF NOT EXISTS original_text TEXT DEFAULT NULL;

COMMENT ON COLUMN video_transcripts.full_text IS
    'English transcript text — translated from Odia if needed. Used for search and AI analysis.';

COMMENT ON COLUMN video_transcripts.original_text IS
    'Original Odia transcript text (only populated when source language was Odia). Null for English videos.';

COMMENT ON COLUMN video_transcripts.language IS
    'Detected source language code from Whisper (e.g. "or" for Odia, "en" for English).';
