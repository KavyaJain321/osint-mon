// ============================================================
// Source Discoverer — AI-powered source recommendation engine
// Two strategies: LLM recommendations + hardcoded quality library
// ============================================================

import { groqChat } from '../lib/groq.js';
import { log } from '../lib/logger.js';

// ── Curated source library by industry + region ────────────
// Global = truly general-purpose. Industry/region = specific.
const SOURCE_LIBRARY = {
    // ── GLOBAL (general-purpose only) ──
    global: [
        { name: 'Reuters Top News', url: 'https://feeds.reuters.com/reuters/topNews', source_type: 'rss', expected_hit_rate: 'medium' },
        { name: 'BBC World News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', source_type: 'rss', expected_hit_rate: 'medium' },
        { name: 'AP News', url: 'https://apnews.com/', source_type: 'html', expected_hit_rate: 'medium' },
        { name: 'Al Jazeera English', url: 'https://www.youtube.com/@AlJazeeraEnglish', source_type: 'youtube', expected_hit_rate: 'medium' },
    ],

    // ── REGIONAL: ODISHA (Strictly Local) ────────────────────
    odisha: [
        // Top Odia Print/HTML Dailies
        { name: 'Sambad', url: 'https://sambad.in/feed/', source_type: 'rss', expected_hit_rate: 'high' },
        { name: 'Prameya News7', url: 'https://www.prameyanews7.com/feed/', source_type: 'rss', expected_hit_rate: 'high' },
        { name: 'Dharitri', url: 'https://www.dharitri.com/', source_type: 'html', expected_hit_rate: 'high' },
        { name: 'The Samaja', url: 'https://thesamaja.in/', source_type: 'html', expected_hit_rate: 'high' },
        { name: 'Pragativadi', url: 'https://pragativadi.com/feed/', source_type: 'rss', expected_hit_rate: 'high' },
        { name: 'Odisha Bhaskar', url: 'https://odishabhaskar.in/', source_type: 'html', expected_hit_rate: 'medium' },
        { name: 'Orissa Post (English)', url: 'https://www.orissapost.com/feed/', source_type: 'rss', expected_hit_rate: 'high' },
        
        // Odisha TV / Video
        { name: 'OTV (Odisha TV)', url: 'https://www.youtube.com/@otv', source_type: 'youtube', expected_hit_rate: 'high' },
        { name: 'Kanak News', url: 'https://www.youtube.com/@KanakNews', source_type: 'youtube', expected_hit_rate: 'high' },
        { name: 'Argus News', url: 'https://www.youtube.com/@ArgusNews', source_type: 'youtube', expected_hit_rate: 'high' },
        { name: 'Nandighosha TV', url: 'https://www.youtube.com/@NandighoshaTV', source_type: 'youtube', expected_hit_rate: 'high' },
        { name: 'Kalinga TV', url: 'https://www.youtube.com/@KalingaTV', source_type: 'youtube', expected_hit_rate: 'high' },
        { name: 'News18 Odia', url: 'https://www.youtube.com/@News18Odia', source_type: 'youtube', expected_hit_rate: 'medium' },

        // Google News Aggregations (Strictly Odisha)
        { name: 'Google News: Odisha CM', url: 'https://news.google.com/rss/search?q=Odisha+CM&hl=en-IN&gl=IN&ceid=IN:en', source_type: 'rss', expected_hit_rate: 'high' },
        { name: 'Google News: Odisha Cabinet', url: 'https://news.google.com/rss/search?q=Odisha+Cabinet&hl=en-IN&gl=IN&ceid=IN:en', source_type: 'rss', expected_hit_rate: 'high' },
        { name: 'Google News: Odisha Assembly', url: 'https://news.google.com/rss/search?q=Odisha+Assembly&hl=en-IN&gl=IN&ceid=IN:en', source_type: 'rss', expected_hit_rate: 'medium' },
        { name: 'Google News: BJD Politics', url: 'https://news.google.com/rss/search?q=BJD+politics+Odisha&hl=en-IN&gl=IN&ceid=IN:en', source_type: 'rss', expected_hit_rate: 'medium' }
    ],

    // ── INDUSTRY-SPECIFIC ────────────────────────────────────
};

// ── LLM-powered source discovery (Layer 4) ─────────────────
async function discoverSourcesViaLLM(context) {
    try {
        const prompt = `You are an OSINT source analyst. Your job: recommend REAL, ACTIVE web sources for continuous intelligence monitoring.

CLIENT CONTEXT:
- Industry: ${context.industry}
- Core Problem: ${context.core_problem}
- Risk Domains: ${context.risk_domains?.join(', ')}
- Key Entities: ${context.entities_of_interest?.join(', ')}
- Geography: ${context.geographic_focus?.join(', ')}

YOU MUST recommend sources across ALL 7 source types. Provide EXACTLY 30 sources:

1. RSS FEEDS (6 sources) — news wire feeds, newspaper RSS, blog feeds
   Example: {"name": "Reuters Top News", "url": "https://feeds.reuters.com/reuters/topNews", "source_type": "rss"}

2. HTML WEBSITES (5 sources) — news sites, portals, government pages without RSS
   Example: {"name": "Business Recorder", "url": "https://www.brecorder.com/", "source_type": "html"}

3. YOUTUBE CHANNELS (8 sources) — news channels, press briefings, analysis channels
   IMPORTANT: ONLY use channel URLs in these formats:
   - https://www.youtube.com/@ChannelHandle
   - https://www.youtube.com/channel/UCxxxxxxxxx
   NEVER use: youtube.com/results?search_query=... (search pages don't work)
   Example: {"name": "Geo News", "url": "https://www.youtube.com/@GeoNews", "source_type": "youtube"}

4. PDF DOCUMENT SOURCES (4 sources) — regulatory filings, research papers, government gazettes
   Example: {"name": "SBP Circulars", "url": "https://www.sbp.org.pk/bsrvd/list.asp", "source_type": "pdf"}

5. BROWSER-RENDERED SITES (3 sources) — JS-heavy portals, dashboards, SPAs
   Example: {"name": "Google News Topic", "url": "https://news.google.com/topics/CAAqBwgKMOfHlgswtJqyAw", "source_type": "browser"}

6. REDDIT SUBREDDITS (4 sources) — relevant communities for grassroots intelligence
   Example: {"name": "r/india", "url": "https://www.reddit.com/r/india/", "source_type": "reddit"}

7. GOOGLE NEWS SEARCHES (3 sources) — Google News RSS for specific queries
   URL format: https://news.google.com/rss/search?q={query}&hl=en
   Example: {"name": "Google News: Banking Regulation", "url": "https://news.google.com/rss/search?q=banking+regulation&hl=en", "source_type": "google_news"}

CRITICAL RULES:
- ONLY real, currently active URLs that exist in 2024-2026
- YouTube URLs must be channel URLs (youtube.com/@ChannelName or youtube.com/c/ChannelName)
- PDF sources should be pages that LIST PDFs (not individual PDF files)
- Reddit sources should be subreddit URLs
- Google News RSS queries should use the exact URL format shown above with '+' for spaces
- Geographic Focus: MUST BE 100% REGION-SPECIFIC to "${context.geographic_focus?.join(', ') || 'global'}". Do not suggest global news organizations unless no local sources exist.
- Each source MUST have all fields: name, url, source_type, expected_hit_rate, rationale

Return ONLY valid JSON:
{
  "sources": [
    {
      "name": "Source Display Name",
      "url": "https://exact-url.com/path",
      "source_type": "rss|html|browser|pdf|youtube|reddit|google_news",
      "expected_hit_rate": "high|medium|low",
      "rationale": "why this source is relevant (1 sentence)"
    }
  ]
}`;

        const resp = await groqChat(
            [{ role: 'user', content: prompt }],
            { temperature: 0.3, max_tokens: 3000, response_format: { type: 'json_object' } }
        );

        const parsed = JSON.parse(resp.choices[0].message.content);
        return parsed.sources || [];
    } catch (err) {
        log.ai.error('LLM source discovery failed (will use fallback layers)', { error: err.message });
        return []; // graceful — other layers still contribute
    }
}

// ── Smart library lookup — industry-aware, no pollution ────
const INDUSTRY_ALIASES = {
    banking: ['banking', 'bank', 'financial services'],
    finance: ['finance', 'investment', 'capital markets', 'stock', 'fintech'],
    education: ['education', 'university', 'academic', 'higher education', 'school'],
    technology: ['technology', 'tech', 'software', 'ai', 'cybersecurity', 'it'],
    healthcare: ['healthcare', 'health', 'pharma', 'pharmaceutical', 'medical', 'biotech'],
    energy: ['energy', 'oil', 'gas', 'renewable', 'power', 'utilities'],
};

function lookupLibrarySources(context) {
    const hits = new Map();
    const addSrc = (list) => list?.forEach(s => hits.set(s.url, s));

    // Only include global sources if the brief is not strict on a specific local region like Odisha
    const isRegional = context.geographic_focus?.some(g => g.toLowerCase().includes('odisha') || g.toLowerCase().includes('india'));
    if (!isRegional) {
        addSrc(SOURCE_LIBRARY.global);
    }

    // Industry match via aliases
    const industry = (context.industry || '').toLowerCase();
    for (const [category, aliases] of Object.entries(INDUSTRY_ALIASES)) {
        if (aliases.some(a => industry.includes(a))) {
            addSrc(SOURCE_LIBRARY[category]);
        }
    }
    // Direct match fallback
    if (SOURCE_LIBRARY[industry]) addSrc(SOURCE_LIBRARY[industry]);

    // Geographic match — normalize common names
    for (const geo of (context.geographic_focus || [])) {
        const g = geo.toLowerCase().trim();
        if (SOURCE_LIBRARY[g]) addSrc(SOURCE_LIBRARY[g]);
        if (g.includes('odisha') || g.includes('orissa')) addSrc(SOURCE_LIBRARY['odisha']);
        if (g.includes('usa') || g.includes('america') || g.includes('united states') || g === 'us') addSrc(SOURCE_LIBRARY['united states']);
        if (g.includes('uk') || g.includes('britain') || g.includes('united kingdom')) addSrc(SOURCE_LIBRARY['uk']);
        if (g.includes('china') || g.includes('chinese')) addSrc(SOURCE_LIBRARY['china']);
        if (g.includes('pakistan')) addSrc(SOURCE_LIBRARY['pakistan']);
        if (g.includes('india')) addSrc(SOURCE_LIBRARY['india']);
        if (g.includes('middle east') || g.includes('gulf') || g.includes('arab')) addSrc(SOURCE_LIBRARY['middle east']);
    }

    // NOTE: We do NOT loop risk_domains anymore.
    // This prevents FATF/BIS from polluting non-financial briefs.

    return [...hits.values()];
}

// ── Merge and deduplicate sources ──────────────────────────
function mergeAndRankSources(libSources, llmSources) {
    const seen = new Map();

    // Library sources take priority (curated)
    for (const s of libSources) {
        seen.set(normalizeUrl(s.url), { ...s, rationale: s.rationale || 'Curated industry source' });
    }

    // Add LLM sources not already in library
    for (const s of llmSources) {
        const key = normalizeUrl(s.url);
        if (!seen.has(key) && s.name && s.url && s.source_type) {
            seen.set(key, s);
        }
    }

    // Sort: high hit rate first, then by type preference (rss > html > rest)
    const typeOrder = { rss: 0, html: 1, browser: 2, pdf: 3, youtube: 4 };
    const rateOrder = { high: 0, medium: 1, low: 2 };

    return [...seen.values()]
        .sort((a, b) =>
            (rateOrder[a.expected_hit_rate] ?? 1) - (rateOrder[b.expected_hit_rate] ?? 1) ||
            (typeOrder[a.source_type] ?? 2) - (typeOrder[b.source_type] ?? 2)
        )
        .slice(0, 30); // max 30 recommended sources per brief
}

function normalizeUrl(url) {
    try { return new URL(url).hostname + new URL(url).pathname; }
    catch { return url; }
}

// ── URL Validation ─────────────────────────────────────────

/**
 * Validate a source URL is accessible via HTTP GET.
 * Uses dynamic import for http/https (ESM compatible).
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{url, accessible, status_code, content_type}>}
 */
async function validateSourceUrlSafe(url, timeoutMs = 5000) {
    try {
        const { default: https } = await import('https');
        const { default: http } = await import('http');

        const validationPromise = new Promise((resolve) => {
            try {
                const urlObj = new URL(url);
                const lib = urlObj.protocol === 'https:' ? https : http;

                const req = lib.get(url, {
                    timeout: timeoutMs,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RobinBot/1.0; OSINT Monitor)' },
                }, (res) => {
                    resolve({
                        url,
                        accessible: res.statusCode >= 200 && res.statusCode < 400,
                        status_code: res.statusCode,
                        content_type: res.headers['content-type'] ?? 'unknown',
                    });
                    res.destroy();
                });

                req.on('error', () => resolve({ url, accessible: false, status_code: 'error' }));
                req.on('timeout', () => { req.destroy(); resolve({ url, accessible: false, status_code: 'timeout' }); });
            } catch {
                resolve({ url, accessible: false, status_code: 'invalid_url' });
            }
        });

        // Enforce hard timeout (handles DNS resolution hangs that the HTTP timeout doesn't catch)
        return Promise.race([
            validationPromise,
            new Promise((resolve) => setTimeout(() => resolve({
                url, accessible: false, status_code: 'hard_timeout'
            }), timeoutMs + 1000))
        ]);
    } catch {
        return { url, accessible: false, status_code: 'error' };
    }
}

/**
 * Validate all source URLs with concurrency limit.
 */
async function validateSources(sources, concurrency = 5) {
    const results = [];
    for (let i = 0; i < sources.length; i += concurrency) {
        const batch = sources.slice(i, i + concurrency);
        const batchResults = await Promise.all(
            batch.map(s => validateSourceUrlSafe(s.url))
        );
        results.push(...batchResults);
    }
    return results;
}

// ── Public API ─────────────────────────────────────────────

// ── Layer 2: Entity-specific auto-discovery ────────────────
function discoverEntitySources(context) {
    const entitySources = [];
    const entities = context.entities_of_interest || [];

    for (const entity of entities.slice(0, 5)) {
        // Google News RSS for this entity — works great
        entitySources.push({
            name: `Google News: ${entity}`,
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(entity)}&hl=en`,
            source_type: 'google_news',
            expected_hit_rate: 'high',
            rationale: `Automated Google News monitoring for ${entity}`,
        });
        // NOTE: We no longer add youtube.com/results?search_query= URLs here.
        // Those are search result pages, not channel feeds — the YouTube crawler
        // cannot extract reliable video lists from them.
    }

    return entitySources;
}

// ── Layer 5: News API aggregator sources ───────────────────
function discoverNewsApiSources(context) {
    const apiSources = [];
    const topic = context.core_problem || context.industry;

    if (topic) {
        apiSources.push({
            name: `Google News: ${topic.substring(0, 40)}`,
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en`,
            source_type: 'google_news',
            expected_hit_rate: 'high',
            rationale: `Broad topic monitoring via Google News`,
        });
    }

    // Add risk-domain-specific news feeds
    for (const risk of (context.risk_domains || []).slice(0, 3)) {
        apiSources.push({
            name: `Google News: ${risk}`,
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(risk)}&hl=en`,
            source_type: 'google_news',
            expected_hit_rate: 'medium',
            rationale: `Risk-domain monitoring: ${risk}`,
        });
    }

    return apiSources;
}

/**
 * Discover and recommend sources for a client brief context.
 * 5-Layer architecture:
 *   L1: Client-provided (from document upload — handled elsewhere)
 *   L2: Entity-specific auto-discovery
 *   L3: Industry/region curated library
 *   L4: LLM-recommended (30 sources)
 *   L5: News API aggregators (Google News RSS)
 *
 * @param {Object} context - Structured context from keyword-generator's extractBriefContext()
 * @returns {Promise<Array>} Array of recommended source objects with validation status
 */
export async function discoverSourcesForBrief(context) {
    const startTime = Date.now();
    log.ai.info('Source discovery started (5-layer)', { industry: context.industry, geo: context.geographic_focus });

    try {
        // L2: Entity-specific sources (instant)
        const entitySources = discoverEntitySources(context);

        // L3 + L4: Library + LLM (parallel)
        const [libSources, llmSources] = await Promise.all([
            lookupLibrarySources(context),
            discoverSourcesViaLLM(context),
        ]);

        // L5: News API aggregator sources (instant)
        const apiSources = discoverNewsApiSources(context);

        // Merge all layers
        const allSources = [...entitySources, ...libSources, ...llmSources, ...apiSources];
        const merged = mergeAndRankSources(
            [...entitySources, ...libSources, ...apiSources],
            llmSources
        );

        // Validate all source URLs for accessibility
        log.ai.info('Validating source URLs...', { count: merged.length });
        const validationResults = await validateSources(merged);

        const sourcesWithValidation = merged.map((source, i) => ({
            ...source,
            url_validated: validationResults[i].accessible,
            url_status_code: String(validationResults[i].status_code ?? 'unknown'),
            validation_note: validationResults[i].accessible
                ? 'URL accessible'
                : `URL unreachable (${validationResults[i].status_code}) — verify before activating`,
        }));

        const accessible = sourcesWithValidation.filter(s => s.url_validated).length;
        log.ai.info('Source discovery complete (5-layer)', {
            entity: entitySources.length,
            library: libSources.length,
            llm: llmSources.length,
            api: apiSources.length,
            merged: merged.length,
            accessible,
            unreachable: merged.length - accessible,
            ms: Date.now() - startTime,
        });

        return sourcesWithValidation;
    } catch (err) {
        log.ai.error('Source discovery pipeline error — returning fallback sources without validation', { error: err.message });
        // Fall back to library + entity + api (skip validation to ensure sources are returned)
        const entitySources = discoverEntitySources(context);
        const libSources = lookupLibrarySources(context);
        const apiSources = discoverNewsApiSources(context);
        const fallback = mergeAndRankSources([...entitySources, ...libSources, ...apiSources], []);
        // Skip URL validation in fallback — better to have unvalidated sources than none
        try {
            const validationResults = await validateSources(fallback);
            return fallback.map((source, i) => ({
                ...source,
                url_validated: validationResults[i].accessible,
                url_status_code: String(validationResults[i].status_code ?? 'unknown'),
            }));
        } catch (valErr) {
            log.ai.error('URL validation also failed — returning sources without validation', { error: valErr.message });
            return fallback.map(source => ({ ...source, url_validated: null, url_status_code: 'skipped' }));
        }
    }
}

