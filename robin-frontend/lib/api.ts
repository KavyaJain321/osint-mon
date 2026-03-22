// ============================================================
// ROBIN OSINT — Typed API Client
// All reads use /api/test/* (no-auth, dev) endpoints.
// Once auth is wired, swap BASE_AUTH for authenticated routes.
// ============================================================

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ── Helper: refresh expired token ────────────────────────────
async function refreshAccessToken(): Promise<string | null> {
    try {
        const refreshToken = typeof window !== "undefined" ? localStorage.getItem("robin_refresh_token") : null;
        if (!refreshToken) return null;
        const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.token) {
            localStorage.setItem("robin_token", data.token);
            if (data.refresh_token) localStorage.setItem("robin_refresh_token", data.refresh_token);
            return data.token;
        }
        return null;
    } catch { return null; }
}

// ── Core fetch wrapper ───────────────────────────────────────
async function apiFetch<T = unknown>(
    path: string,
    opts: RequestInit = {},
    _retried = false
): Promise<T> {
    const token =
        typeof window !== "undefined" ? localStorage.getItem("robin_token") : null;

    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts.headers || {}),
        },
    });

    // Auto-refresh on 401 (expired token) — retry once
    if (res.status === 401 && !_retried) {
        const newToken = await refreshAccessToken();
        if (newToken) return apiFetch<T>(path, opts, true);
        // Refresh also failed — session fully expired, redirect to login
        if (typeof window !== 'undefined') {
            localStorage.removeItem('robin_token');
            localStorage.removeItem('robin_refresh_token');
            window.location.href = '/auth/login';
        }
    }

    if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((body.error as string) || `HTTP ${res.status}`);
    }

    return res.json() as T;
}

// ── Test (no-auth) endpoints — /api/test/* ───────────────────
// These are available in dev without a token.

export const testApi = {
    /** Article feed + analysis (last 50) */
    articles: (limit = 50) =>
        apiFetch(`/api/test/articles?limit=${limit}`),

    /** Sentiment + avg importance */
    analytics: () => apiFetch(`/api/test/analytics`),

    /** Full intelligence picture: threat, signals, entities, sources, narrative */
    intelligence: () => apiFetch(`/api/test/intelligence`),

    /** Scraper status: running, article counts, source breakdown */
    scraperStatus: () => apiFetch(`/api/test/scraper-status`),

    /** Source list for this client */
    sources: () => apiFetch(`/api/test/sources`),

    /** Watch keywords */
    keywords: () => apiFetch(`/api/test/keywords`),

    /** Trigger scrape (optional sourceId) */
    scrape: (sourceId?: string) =>
        apiFetch(`/api/test/scrape`, {
            method: "POST",
            body: JSON.stringify(sourceId ? { sourceId } : {}),
        }),

    /** RAG chat — returns SSE stream */
    chatUrl: () => `${BASE}/api/test/chat`,
};

// ── Content API — unified content feed ──────────────────────

export const contentApi = {
    /** All content items (articles + videos + PDFs + etc.) with optional type filter */
    list: (limit = 50, type?: string) =>
        apiFetch(`/api/test/content?limit=${limit}${type && type !== 'all' ? `&type=${type}` : ''}`),
    /** Delete a single content item by ID */
    delete: (id: string) =>
        apiFetch(`/api/test/content/${id}`, { method: 'DELETE' }),
};

// ── Video Processing API ────────────────────────────────────

export const videoApi = {
    /** Get full transcript + keyword occurrences */
    transcript: (articleId: string) =>
        apiFetch(`/api/test/video/${articleId}/transcript`),
    /** Get all clips with summaries */
    clips: (articleId: string) =>
        apiFetch(`/api/test/video/${articleId}/clips`),
    /** Search within a video's transcript */
    search: (articleId: string, query: string) =>
        apiFetch(`/api/test/video/${articleId}/search?q=${encodeURIComponent(query)}`),
    /** Get processing status */
    status: (articleId: string) =>
        apiFetch(`/api/test/video/${articleId}/status`),
    /** Manually trigger processing */
    process: (articleId: string) =>
        apiFetch(`/api/test/video/${articleId}/process`, { method: 'POST' }),
};

// ── Convenience: expose top-level helpers page components expect ─

/** Article data — wraps testApi.articles for components */
export const articlesApi = {
    list: (limit = 50) => testApi.articles(limit),
};

/** Analytics data — sentiment + volume */
export const analyticsApi = {
    /** Returns { client, sentiment: { positive, negative, neutral, total, *_pct }, avg_importance } */
    sentiment: () => testApi.analytics(),

    /** Returns velocity array from scraper status
     * BUG FIX #15: `data` was always returned as a hardcoded empty array `[]`,
     * so no velocity chart ever had data. Now builds a real single-point array
     * from the scraper-status response so components have something to render.
     * For true historical velocity, wire this to /api/analytics/volume.
     */
    velocity: (_days = 14) => testApi.scraperStatus().then(d => {
        const scraperData = d as Record<string, unknown>;
        const today = new Date().toISOString().split('T')[0];
        const point = {
            date: today,
            article_count: (scraperData.articles_last_24h as number) || 0,
        };
        return {
            data: [point] as Array<{ date: string; article_count: number }>,
            articles_last_24h: scraperData.articles_last_24h,
            total: scraperData.total_articles,
        };
    }),
};

// Shared cache — deduplicates parallel calls within 30s window
// BUG FIX #35: Previously used .finally() which cached rejected promises too.
// A failed request would block retries for 30s. Now only successful responses
// are cached; rejections clear the cache immediately so the next call retries.
let _intellCache: Promise<unknown> | null = null;

function getCachedIntelligence(): Promise<unknown> {
    if (!_intellCache) {
        _intellCache = testApi.intelligence().then(
            (result) => {
                setTimeout(() => { _intellCache = null; }, 30000);
                return result;
            },
            (err) => {
                _intellCache = null;
                throw err;
            }
        );
    }
    return _intellCache;
}

/** Intelligence — all analysis data from the full intelligence endpoint */
export const intelligenceApi = {
    /** Returns { threat_assessment, signals, entity_profiles, entity_graph, source_reliability, narrative } */
    overview: () => getCachedIntelligence(),

    signals: (limit = 50) =>
        getCachedIntelligence().then((d) => {
            const data = d as { signals?: unknown[] };
            return { data: (data.signals || []).slice(0, limit) };
        }),

    patterns: () =>
        getCachedIntelligence().then((d) => {
            const data = d as { threat_assessment?: { patterns?: unknown[] }; narrative?: unknown };
            return {
                data: data.threat_assessment?.patterns || [],
                narrative: data.narrative || null,
            };
        }),

    chains: () =>
        getCachedIntelligence().then((d) => {
            const data = d as { threat_assessment?: { inference_chains?: unknown[] } };
            return { data: data.threat_assessment?.inference_chains || [] };
        }),

    entities: (limit = 40) =>
        getCachedIntelligence().then((d) => {
            const data = d as { entity_profiles?: unknown[] };
            return { data: (data.entity_profiles || []).slice(0, limit) };
        }),

    sources: () =>
        testApi.sources().then((d) => ({ data: (d as { data?: unknown[] }).data || [] })),

    narratives: (limit = 6) =>
        getCachedIntelligence().then((d) => {
            const data = d as { narrative?: unknown };
            const narrative = data.narrative;
            return { data: narrative ? [narrative] : [] };
        }),

    threatAssessment: () =>
        getCachedIntelligence().then((d) => {
            const data = d as { threat_assessment?: unknown };
            return { data: data.threat_assessment || null };
        }),
};

/** Admin endpoints (authenticated, SUPER_ADMIN) */
export const adminApi = {
    clients: () => apiFetch(`/api/admin/clients`),
    health: () => apiFetch(`/api/admin/system-health`),
    briefs: (status = "pending_review") =>
        apiFetch(`/api/admin/briefs?status=${status}`),
    activate: (briefId: string) =>
        apiFetch(`/api/admin/briefs/${briefId}/activate`, { method: "POST" }),
    scrape: (clientId: string) =>
        apiFetch(`/api/admin/scrape/${clientId}`, { method: "POST" }),
};

/** Chat
 * BUG FIX #14: Was calling /api/test/chat (no authentication required).
 * Now correctly calls /api/chat which enforces Bearer token auth.
 */
export const chatApi = {
    send: (body: { message: string }) =>
        apiFetch(`/api/chat`, {
            method: "POST",
            body: JSON.stringify({ question: body.message }),
        }),
};

/** Brief submission */
export const briefApi = {
    submit: (body: { title: string; problem_statement: string }) =>
        apiFetch(`/api/briefs`, { method: "POST", body: JSON.stringify(body) }),
    status: (briefId: string) => apiFetch(`/api/briefs/${briefId}`),
    list: () => apiFetch(`/api/briefs`),
};

/** Daily Intel — aggregated daily situation report data */
export const dailyIntelApi = {
    /** Top articles for the day filtered by importance and date */
    criticalArticles: (date: string, limit = 10) =>
        apiFetch(`/api/articles?min_score=7&limit=${limit}&date=${date}`),

    /** All articles for a date (for sector analysis) */
    articles: (date: string, limit = 100) =>
        apiFetch(`/api/articles?limit=${limit}&date=${date}`),

    /** Intelligence brief: situation summary, entity watch, signals */
    intel: () => getCachedIntelligence(),

    /** Analytics: sentiment + volume */
    analytics: () => testApi.analytics(),

    /** Scraper status: articles_last_24h, total */
    scraperStatus: () => testApi.scraperStatus(),

    /** Watch keywords for topic pre-selection */
    keywords: () => testApi.keywords(),
};

export default apiFetch;
