-- ============================================================
-- Migration 006: Media Outlets Intelligence Database
-- Curated database of 500+ global media outlets with reliability
-- ratings, political alignment, and editorial metadata.
-- ============================================================

CREATE TABLE IF NOT EXISTS media_outlets (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    country_id      TEXT NOT NULL,          -- ISO 3-letter code (GBR, IND, PAK)
    country_name    TEXT NOT NULL,
    outlet_id       TEXT NOT NULL UNIQUE,   -- e.g. GBR001, IND007
    outlet_name     TEXT NOT NULL,
    primary_domain  TEXT,                   -- website URL / domain
    format          TEXT,                   -- Newspaper-Legacy, TV-Legacy, Digital-Native, etc.
    ownership_type  TEXT,                   -- Corporate, State-Owned, Independent, Family-Owned
    political_alignment TEXT,               -- Pro-Government, Anti-Establishment, Centre-Left, etc.
    factual_reliability TEXT,               -- High, Generally Reliable, Mixed, Low, Very Low
    primary_audience TEXT,
    language_primary TEXT,                  -- en, hi, ur, sw, etc.
    established_year TEXT,
    last_updated     TEXT,
    verified_by      TEXT,                  -- Reuters Institute, RSF, CPJ, etc.
    notes           TEXT,
    tags_economic   TEXT,
    tags_sociocultural TEXT,
    tags_governance TEXT,
    tags_foreign    TEXT,
    tags_other      TEXT,
    -- Computed fields for ROBIN integration
    reliability_score REAL DEFAULT 0.5,     -- 0.0-1.0 numeric reliability
    is_scrapeable   BOOLEAN DEFAULT false,  -- true if primary_domain is a valid URL
    rss_feed_url    TEXT,                   -- discovered RSS feed URL (populated later)
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for fast country lookups
CREATE INDEX IF NOT EXISTS idx_media_outlets_country ON media_outlets(country_id);
CREATE INDEX IF NOT EXISTS idx_media_outlets_reliability ON media_outlets(factual_reliability);
CREATE INDEX IF NOT EXISTS idx_media_outlets_domain ON media_outlets(primary_domain);

-- RLS policy: readable by all authenticated users
ALTER TABLE media_outlets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "media_outlets_read_all" ON media_outlets;
DROP POLICY IF EXISTS "media_outlets_admin_all" ON media_outlets;
CREATE POLICY "media_outlets_read_all" ON media_outlets FOR SELECT USING (true);
CREATE POLICY "media_outlets_admin_all" ON media_outlets FOR ALL USING (true);
