// ============================================================
// ROBIN OSINT — TypeScript Data Model Types
// ============================================================

// ── Auth ────────────────────────────────────────────────────
export interface User {
    id: string;
    email: string;
    role: 'SUPER_ADMIN' | 'ANALYST' | 'CLIENT_ADMIN' | 'CLIENT_VIEWER';
    client_id?: string;
    full_name?: string;
}

// ── Clients ─────────────────────────────────────────────────
export interface Client {
    id: string;
    name: string;
    industry?: string;
    is_active: boolean;
    created_at: string;
}

// ── Articles ────────────────────────────────────────────────
export type Sentiment = 'positive' | 'negative' | 'neutral';

export interface ArticleAnalysis {
    article_id: string;
    summary: string;
    sentiment: Sentiment;
    importance_score: number; // 1-10
    importance_reason: string;
    narrative_frame: string;
    entities: string[];
}

export interface Article {
    id: string;
    title: string;
    title_en?: string;
    url: string;
    published_at: string;
    source_id: string;
    matched_keywords: string[];
    content?: string;
    analysis_status: 'pending' | 'complete' | 'failed';
    analysis?: ArticleAnalysis;
    content_type?: string;
    source_name?: string;
    source_url?: string;
    type_metadata?: { image_url?: string; channel_name?: string; has_captions?: boolean; processing_status?: string; processing_message?: string;[key: string]: unknown };
}

// ── Video Processing ────────────────────────────────────────
export interface KeywordOccurrence {
    keyword: string;
    timestamp: number;
    context: string;
    level: string;
}

export interface VideoTranscript {
    fullText: string;
    segments: Array<{ start: number; end: number; text: string }>;
    words: Array<{ word: string; start: number; end: number }>;
    durationSeconds: number;
    language: string;
    keywordOccurrences: KeywordOccurrence[];
    aiSummary: string;
    createdAt: string;
}

export interface VideoClip {
    id: string;
    keyword: string;
    startTime: number;
    endTime: number;
    duration: number;
    clipUrl: string;
    transcriptSegment: string;
    aiSummary: string;
    startFormatted: string;
    endFormatted: string;
}

// ── Intelligence ────────────────────────────────────────────
export type RiskLevel = 'minimal' | 'low' | 'moderate' | 'elevated' | 'critical';

export interface ThreatAssessment {
    id: string;
    assessment_date: string;
    overall_risk: number;        // 0-100
    risk_level: RiskLevel;
    financial_risk: number;
    regulatory_risk: number;
    reputational_risk: number;
    operational_risk: number;
    geopolitical_risk: number;
    risk_velocity: string;       // accelerating|steady|decelerating
    summary: string;
}

export type SignalSeverity = 'critical' | 'high' | 'medium' | 'low' | 'watch';

export interface IntelligenceSignal {
    id: string;
    signal_type: string;
    title: string;
    description: string;
    severity: SignalSeverity;
    evidence: Array<{ article_id?: string; quote?: string }>;
    confidence: number;         // 0-1
    is_acknowledged: boolean;
    created_at: string;
}

export interface EntityProfile {
    name: string;
    type: string;
    influence: number;
    mentions: number;
    sentiment: Record<string, number>;
    risk_tags: string[];
    relationships: Array<{ entity_name: string; strength: number }>;
    first_seen: string;
    last_seen: string;
}

export interface EntityGraph {
    nodes: Array<{ id: string; type: string; influence: number; mentions: number }>;
    edges: Array<{ source: string; target: string; weight: number }>;
}

export interface SourceReliability {
    name: string;
    reliability: number;        // 0-1
    bias: string;
    sentiment_skew: number;
    articles: number;
    status?: 'healthy' | 'watch' | 'degraded' | 'premium';
}

export interface Narrative {
    id: string;
    pattern_date: string;
    weekly_narrative: string;
    dominant_sentiment: Sentiment;
    positive_pct: number;
    negative_pct: number;
    neutral_pct: number;
    key_entities: Array<{ entity: string; count: number }>;
    emerging_themes: string[];
}

// ── Temporal Intelligence ───────────────────────────────────
export interface IntelligencePattern {
    id: string;
    pattern_type: string;
    title: string;
    description: string;
    evidence: Array<{ article_id?: string; source_id?: string }>;
    confidence: number;
    severity: SignalSeverity;
    entities_involved: string[];
    detected_at: string;
}

export interface ChainStep {
    step_num: number;
    event: string;
    articles: string[];
    confidence: number;
}

export interface InferenceChain {
    id: string;
    title: string;
    chain_steps: ChainStep[];
    conclusion: string;
    conclusion_confidence: number;
    severity: SignalSeverity;
    scenario_7d: Array<{ scenario: string; probability: number; key_trigger?: string }>;
    priority_action?: { title: string; rationale: string; urgency: string };
    created_at: string;
}

export interface CompetitiveBenchmark {
    week_start: string;
    client_sentiment: number;
    client_article_count: number;
    competitor_data: Record<string, { sentiment: number; article_count: number }>;
    strategic_implications: string;
}

// ── Sources ─────────────────────────────────────────────────
export type SourceType = 'rss' | 'html' | 'browser' | 'pdf' | 'youtube';

export interface Source {
    id: string;
    name: string;
    url: string;
    source_type: SourceType;
    is_active: boolean;
    last_scraped_at?: string;
    scrape_success_count: number;
    scrape_fail_count: number;
    last_scrape_error?: string;
    created_at: string;
}

// ── Briefs ──────────────────────────────────────────────────
export type BriefStatus = 'processing' | 'pending_review' | 'approved' | 'active' | 'paused' | 'failed';

export interface ClientBrief {
    id: string;
    client_id: string;
    title: string;
    problem_statement: string;
    industry?: string;
    risk_domains: string[];
    entities_of_interest: string[];
    competitors: string[];
    geographic_focus: string[];
    status: BriefStatus;
    created_at: string;
    activated_at?: string;
}

export interface GeneratedKeyword {
    id: string;
    brief_id: string;
    keyword: string;
    category: 'primary' | 'entity' | 'semantic' | 'competitive' | 'temporal' | 'negative';
    priority: number;
    rationale: string;
    approved: boolean;
    rejected: boolean;
}

export interface RecommendedSource {
    id: string;
    brief_id: string;
    name: string;
    url: string;
    source_type: SourceType;
    expected_hit_rate: 'high' | 'medium' | 'low';
    rationale: string;
    approved: boolean;
    rejected: boolean;
}

// ── Analytics ───────────────────────────────────────────────
export interface SentimentStats {
    positive: number;
    negative: number;
    neutral: number;
    total: number;
    positive_pct: number;
    negative_pct: number;
    neutral_pct: number;
}

export interface ScraperStatus {
    scraper_running: boolean;
    last_run: string;
    total_sources: number;
    total_articles: number;
    articles_last_24h: number;
    pending_analysis: number;
    cross_source_duplicates: number;
    source_types: Record<string, { active: number; total: number }>;
}

// ── API Response wrapper ─────────────────────────────────────
export interface ApiResponse<T> {
    data?: T;
    error?: string;
    message?: string;
    total?: number;
}
