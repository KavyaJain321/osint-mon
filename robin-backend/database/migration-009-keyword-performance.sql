-- ============================================================
-- Migration 009: Keyword Performance Tracking
-- Adds a PostgreSQL function that counts per-keyword article
-- match counts for 7d and 30d windows.
-- Run once in Supabase SQL editor.
-- ============================================================

-- Function: get_keyword_performance(brief_id_param)
-- Returns all keywords for a brief enriched with match counts
-- and last_matched_at from the articles table.
CREATE OR REPLACE FUNCTION get_keyword_performance(brief_id_param UUID)
RETURNS TABLE (
    id          UUID,
    keyword     TEXT,
    category    TEXT,
    priority    INTEGER,
    rationale   TEXT,
    match_count_7d  BIGINT,
    match_count_30d BIGINT,
    last_matched_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        kw.id,
        kw.keyword,
        kw.category,
        kw.priority,
        COALESCE(kw.rationale, '') AS rationale,
        COUNT(CASE WHEN a.created_at >= NOW() - INTERVAL '7 days'  THEN 1 END) AS match_count_7d,
        COUNT(CASE WHEN a.created_at >= NOW() - INTERVAL '30 days' THEN 1 END) AS match_count_30d,
        MAX(a.created_at) AS last_matched_at
    FROM brief_generated_keywords kw
    JOIN client_briefs cb ON cb.id = kw.brief_id
    LEFT JOIN articles a
        ON  a.client_id        = cb.client_id
        AND kw.keyword         = ANY(a.matched_keywords)
    WHERE kw.brief_id = brief_id_param
    GROUP BY kw.id, kw.keyword, kw.category, kw.priority, kw.rationale
    ORDER BY match_count_7d DESC, kw.priority DESC;
$$;

-- Grant execute to authenticated role (used by Supabase client)
GRANT EXECUTE ON FUNCTION get_keyword_performance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_keyword_performance(UUID) TO service_role;
