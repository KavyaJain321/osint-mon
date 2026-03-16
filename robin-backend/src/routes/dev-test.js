// ============================================================
// Dev-Test Routes — NO AUTH — DEV ONLY — REMOVE BEFORE PROD
// Mounted at /api/test/* by index.js only when NODE_ENV !== 'production'
// ============================================================

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { generateChatResponseStream, retrieveRelevantArticles } from '../ai/chat-rag.js';
import { runScraperCycle, scrapeSourceById } from '../scrapers/orchestrator.js';
import { generateEmbedding } from '../services/embedding.js';
import { createClient as _createAuthClient } from '@supabase/supabase-js';
import { config as _config } from '../config.js';
import { getPipelineProgress } from '../lib/pipeline-tracker.js';
import puppeteer from 'puppeteer-core';
import { generateMediaReportHtml } from '../lib/pdf-template.js';

/**
 * Get browser instance for PDF generation.
 * Tries local Chrome first (for dev), falls back to @sparticuz/chromium (for cloud).
 */
async function getBrowserInstance() {
    const fs = await import('fs');
    const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
    ];
    const chromePath = process.env.CHROME_PATH || possiblePaths.find(p => p && fs.existsSync(p));
    if (chromePath) {
        console.log('[PDF] Using local Chrome:', chromePath);
        return puppeteer.launch({
            headless: 'new',
            executablePath: chromePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
    }
    // Fallback: serverless chromium (cloud/Render)
    const chromium = await import('@sparticuz/chromium');
    const execPath = await chromium.default.executablePath();
    return puppeteer.launch({
        args: chromium.default.args,
        defaultViewport: chromium.default.defaultViewport,
        executablePath: execPath,
        headless: chromium.default.headless,
    });
}


// Fresh isolated admin client — created per request to avoid GoTrue session
// contamination from the shared singleton. Uses service role, bypasses all RLS.
function mkAdmin() {
    return _createAuthClient(_config.supabaseUrl, _config.supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

const router = Router();

// ── Pipeline Progress endpoint ─────────────────────────────
router.get('/pipeline-progress', (req, res) => {
    res.json(getPipelineProgress());
});

// Map AI-generated source types to valid DB types
// brief_recommended_sources allows: rss, html, browser, pdf, youtube
// sources table allows: rss, html, browser, youtube, twitter, reddit, pdf, govt_portal, podcast
function mapSourceType(type) {
    // Types valid in BOTH tables
    if (['rss', 'html', 'browser', 'pdf', 'youtube'].includes(type)) return type;
    // google_news feeds ARE RSS — safe mapping
    if (type === 'google_news') return 'rss';
    // reddit → html for brief_recommended_sources (closest match)
    if (type === 'reddit') return 'html';
    return 'html'; // unknown → html
}

// For the live sources table (wider constraint)
function mapSourceTypeLive(type) {
    const valid = new Set(['rss', 'html', 'browser', 'youtube', 'twitter', 'reddit', 'pdf', 'govt_portal', 'podcast']);
    if (valid.has(type)) return type;
    if (type === 'google_news') return 'rss';
    return 'html';
}

// ── Helper ──────────────────────────────────────────────────
// Smart client resolver: uses authenticated user's client when token is present,
// falls back to first client for unauthenticated dev requests.
// NOTE: We manually decode the JWT (no auth.getUser() call) to avoid
// contaminating the shared supabase singleton's session state with the user's
// JWT, which would switch all subsequent DB queries from service-role (RLS-bypass)
// to the user's JWT (RLS-restricted), returning 0 rows.

const _supabaseAuth = _createAuthClient(_config.supabaseUrl, _config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

function _decodeJwtPayload(token) {
    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    } catch { return null; }
}

async function getTestClient(req) {
    // Uses mkAdmin() — fresh isolated client per call, zero session contamination.
    const db = mkAdmin();
    const authHeader = req?.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            const payload = _decodeJwtPayload(token);
            const userId = payload?.sub;
            if (userId) {
                const { data: profile } = await db
                    .from('users')
                    .select('client_id')
                    .eq('id', userId)
                    .single();
                if (profile?.client_id) {
                    const { data: client } = await db
                        .from('clients')
                        .select('id, name, industry')
                        .eq('id', profile.client_id)
                        .single();
                    if (client) return client;
                }
            }
        } catch { /* fall through to default */ }
    }
    // Fallback: first client (unauthenticated / dev)
    log.api.warn('getTestClient: no auth token, falling back to first client (unauthenticated request)');
    const { data } = await db
        .from('clients')
        .select('id, name, industry')
        .limit(1)
        .single();
    return data;
}

// GET /articles — article feed with analysis
router.get('/articles', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { data, error } = await supabase
            .from('articles')
            .select('id, title, url, published_at, source_id, matched_keywords, analysis_status')
            .eq('client_id', client.id)
            .order('published_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        const ids = (data || []).map(a => a.id);
        const { data: analyses } = await supabase
            .from('article_analysis')
            .select('article_id, summary, sentiment, importance_score, importance_reason, narrative_frame, entities')
            .in('article_id', ids);

        const analysisMap = new Map((analyses || []).map(a => [a.article_id, a]));
        const articles = (data || []).map(a => ({ ...a, analysis: analysisMap.get(a.id) || null }));

        res.json({ data: articles, client, total: articles.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /content — unified content feed (articles + videos + PDFs + etc.)
// Map frontend filter IDs → database content_type values
// These MUST match the DB CHECK constraint on content_items.content_type
const CONTENT_TYPE_MAP = {
    youtube: ['video', 'tv_transcript', 'podcast'],
    pdf: ['pdf'],
    govt: ['govt_release', 'press_release'],
    social: ['tweet', 'reddit', 'social_post'],
    article: ['article'],
};

router.get('/content', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { type, limit: rawLimit = '50' } = req.query;
        const limit = Math.min(parseInt(rawLimit) || 50, 200);

        // Try content_items first (post-migration)
        // JOIN sources table to get source_name for frontend newspaper detection
        let query = supabase
            .from('content_items')
            .select('id, title, url, content_type, type_metadata, published_at, source_id, matched_keywords, analysis_status, created_at, source:sources(name)')
            .eq('client_id', client.id);

        if (type && type !== 'all') {
            const dbTypes = CONTENT_TYPE_MAP[type] || [type];
            query = query.in('content_type', dbTypes);
        }

        const { data, error } = await query
            .order('published_at', { ascending: false })
            .limit(limit);

        if (error) {
            // Fallback to articles table if content_items doesn't exist
            if (error.message?.includes('content_items') || error.code === '42P01') {
                const { data: articles, error: artErr } = await supabase
                    .from('articles')
                    .select('id, title, url, published_at, source_id, matched_keywords, analysis_status, created_at, source:sources(name)')
                    .eq('client_id', client.id)
                    .order('published_at', { ascending: false })
                    .limit(limit);

                if (artErr) throw artErr;
                const fallbackData = (articles || []).map(a => ({
                    ...a,
                    content_type: 'article',
                    type_metadata: {},
                    source_name: a.source?.name || null,
                    source: undefined,
                }));
                return res.json({ data: fallbackData, client, total: fallbackData.length, source: 'articles_fallback' });
            }
            throw error;
        }

        // Fetch analysis for all items
        const ids = (data || []).map(d => d.id);
        const { data: analyses } = ids.length > 0
            ? await supabase.from('article_analysis')
                .select('article_id, summary, sentiment, importance_score, narrative_frame')
                .in('article_id', ids)
            : { data: [] };

        const analysisMap = new Map((analyses || []).map(a => [a.article_id, a]));
        const enriched = (data || []).map(item => ({
            ...item,
            source_name: item.source?.name || null,
            source: undefined,  // don't send nested object to frontend
            analysis: analysisMap.get(item.id) || null,
        }));

        // Get content type counts
        const typeCounts = {};
        for (const item of enriched) {
            typeCounts[item.content_type] = (typeCounts[item.content_type] || 0) + 1;
        }

        res.json({ data: enriched, client, total: enriched.length, type_counts: typeCounts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /analytics — sentiment & volume stats
router.get('/analytics', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const db = mkAdmin();
        // Get article IDs for this client first
        const { data: clientArticles } = await db
            .from('articles')
            .select('id')
            .eq('client_id', client.id)
            .limit(500);
        const articleIds = (clientArticles || []).map(a => a.id);

        let analyses = [];
        if (articleIds.length > 0) {
            // Fetch in batches of 100 (supabase IN limit)
            for (let i = 0; i < articleIds.length; i += 100) {
                const batch = articleIds.slice(i, i + 100);
                const { data } = await db
                    .from('article_analysis')
                    .select('sentiment, importance_score')
                    .in('article_id', batch);
                analyses.push(...(data || []));
            }
        }

        const sentiments = { positive: 0, negative: 0, neutral: 0 };
        let totalScore = 0;
        (analyses || []).forEach(a => {
            sentiments[a.sentiment] = (sentiments[a.sentiment] || 0) + 1;
            totalScore += a.importance_score || 0;
        });

        const total = (analyses || []).length;
        res.json({
            client,
            sentiment: {
                ...sentiments,
                total,
                positive_pct: total ? Math.round(sentiments.positive / total * 100) : 0,
                negative_pct: total ? Math.round(sentiments.negative / total * 100) : 0,
                neutral_pct: total ? Math.round(sentiments.neutral / total * 100) : 0,
            },
            avg_importance: total ? (totalScore / total).toFixed(1) : 0,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /velocity — daily article counts for the last N days
router.get('/velocity', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const days = Math.min(parseInt(req.query.days || '14', 10), 90);
        const since = new Date(Date.now() - days * 86400000).toISOString();

        const db = mkAdmin();
        const { data: articles } = await db
            .from('articles')
            .select('published_at')
            .eq('client_id', client.id)
            .gte('published_at', since)
            .order('published_at', { ascending: true });

        // Build daily buckets for all days in range
        const buckets = {};
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            const key = d.toISOString().slice(0, 10);
            buckets[key] = 0;
        }
        (articles || []).forEach(a => {
            const key = a.published_at?.slice(0, 10);
            if (key && buckets[key] !== undefined) buckets[key]++;
        });

        const data = Object.entries(buckets).map(([date, article_count]) => ({ date, article_count }));
        res.json({ data, total: articles?.length || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /generate-report — assemble full intelligence report data
router.post('/generate-report', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { period = '24h', template = 'daily', sections = {}, headerText = 'Intelligence Report', classification = 'internal' } = req.body;

        // Determine time window
        const periodMs = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 };
        const windowMs = periodMs[period] || 86400000;
        const since = new Date(Date.now() - windowMs).toISOString();

        // Fetch all needed data in parallel
        // Use mkAdmin() isolated client to bypass RLS (avoids session contamination on POST)
        const db = mkAdmin();

        // Step 1: get client article IDs first (needed for scoped analysis query)
        const { data: clientArticles } = await db
            .from('articles')
            .select('id, title, url, published_at, matched_keywords')
            .eq('client_id', client.id)
            .gte('published_at', since)
            .order('published_at', { ascending: false })
            .limit(100);
        const articleIds = (clientArticles || []).map(a => a.id);

        const [anaRes, signalRes, sourcesRes, briefRes, narrativeRes] = await Promise.all([
            // article_analysis filtered to THIS client's articles only
            articleIds.length > 0
                ? db.from('article_analysis').select('article_id, sentiment, importance_score, summary, entities').in('article_id', articleIds.slice(0, 100))
                : Promise.resolve({ data: [] }),
            // Fetch ALL signals for client — use select('*') to avoid missing-column errors
            db.from('intelligence_signals').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(50),
            db.from('sources').select('id, name, url, source_type, is_active').eq('client_id', client.id).eq('is_active', true).limit(50),
            db.from('client_briefs').select('title, problem_statement, status').eq('client_id', client.id).order('created_at', { ascending: false }).limit(1).single(),
            // Use select('*') — avoids 42703 error from requesting non-existent columns
            db.from('narrative_patterns').select('*').eq('client_id', client.id).order('pattern_date', { ascending: false }).limit(1).single(),
        ]);
        const artRes = { data: clientArticles };


        const articles = artRes.data || [];
        const analyses = anaRes.data || [];
        const rawSignals = (signalRes.data || []).filter(s => s.is_acknowledged !== true);
        const sources = sourcesRes.data || [];
        const brief = briefRes.data;
        const rawNarrative = narrativeRes.data;

        // Parse weekly_narrative JSON (same logic as /intelligence endpoint)
        let narrative = null;
        if (rawNarrative) {
            let sections = {};
            try {
                const wn = rawNarrative.weekly_narrative;
                sections = typeof wn === 'string' ? JSON.parse(wn) : (wn || {});
            } catch { /* not JSON, use raw */ }
            narrative = {
                executive_summary: sections.executive_summary || rawNarrative.executive_summary || null,
                full_narrative: sections.full_narrative || rawNarrative.full_narrative || null,
                key_developments: sections.key_developments || null,
                watch_list: sections.watch_list || rawNarrative.watch_list || [],
                emerging_threats: sections.emerging_threats || rawNarrative.emerging_threats || [],
                weekly_narrative: rawNarrative.weekly_narrative,
            };
        }

        // Signals — use all non-acknowledged ones
        const signals = rawSignals;


        // Build analysis map
        const anaMap = {};
        analyses.forEach(a => { anaMap[a.article_id] = a; });

        // Enrich articles
        const enriched = articles.map(a => ({ ...a, analysis: anaMap[a.id] || null }));

        // Sentiment counts
        const sentCounts = { positive: 0, negative: 0, neutral: 0 };
        analyses.forEach(a => { sentCounts[a.sentiment] = (sentCounts[a.sentiment] || 0) + 1; });
        const sentTotal = analyses.length || 1;

        // Top articles by importance
        const topArticles = enriched
            .filter(a => a.analysis)
            .sort((a, b) => (b.analysis?.importance_score || 0) - (a.analysis?.importance_score || 0))
            .slice(0, 10)
            .map(a => ({
                title: a.title,
                url: a.url,
                published_at: a.published_at,
                importance: a.analysis?.importance_score || 0,
                sentiment: a.analysis?.sentiment || 'neutral',
                summary: a.analysis?.summary || '',
                keywords: a.matched_keywords || [],
            }));

        // Entity frequency from analyses
        const entityFreq = {};
        analyses.forEach(a => {
            const locs = a.entities?.locations || [];
            const people = a.entities?.people || [];
            const orgs = a.entities?.organizations || [];
            [...locs, ...people, ...orgs].forEach(e => {
                if (e) entityFreq[e] = (entityFreq[e] || 0) + 1;
            });
        });
        const topEntities = Object.entries(entityFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([name, count]) => ({ name, count }));

        // Critical alerts
        const criticalAlerts = signals.filter(s => ['critical', 'high'].includes(s.severity)).slice(0, 5);

        res.json({
            generated_at: new Date().toISOString(),
            period, template, headerText, classification,
            client: { id: client.id, name: client.name, industry: client.industry },
            brief: brief ? { title: brief.title, objective: brief.problem_statement, status: brief.status } : null,
            metrics: {
                totalArticles: articles.length,
                sentiment: {
                    ...sentCounts,
                    total: sentTotal,
                    positive_pct: Math.round(sentCounts.positive / sentTotal * 100),
                    negative_pct: Math.round(sentCounts.negative / sentTotal * 100),
                    neutral_pct: Math.round(sentCounts.neutral / sentTotal * 100),
                },
                totalSignals: signals.length,
                criticalSignals: signals.filter(s => s.severity === 'critical').length,
                activeSources: sources.length,
            },
            sections: {
                executive_summary: sections.executive_summary !== false ? (() => {
                    // Try all narrative fields in order
                    let text = narrative?.executive_summary || narrative?.full_narrative || narrative?.weekly_narrative || '';
                    // If it's JSON, extract the right field
                    if (text && text.trim().startsWith('{')) {
                        try { const p = JSON.parse(text); text = p.executive_summary || p.full_narrative || p.summary || text; } catch { }
                    }
                    return text || 'No executive summary available for this period.';
                })() : null,
                top_articles: sections.top_developments !== false ? topArticles : null,
                sentiment: sections.sentiment_charts !== false ? sentCounts : null,
                entities: sections.entity_intelligence !== false ? topEntities : null,
                sources: sections.source_matrix !== false ? sources.slice(0, 20).map(s => ({ name: s.name, url: s.url, type: s.source_type })) : null,
                // Include all signals regardless of severity (watch, low, medium, high, critical)
                signals: sections.active_signals !== false ? signals.slice(0, 10).map(s => ({
                    title: s.title,
                    severity: s.severity || 'watch',
                    description: s.description,
                    confidence: s.confidence_score ?? s.confidence ?? s.score ?? 0,
                })) : null,
                watch_list: sections.watch_list !== false ? (narrative?.watch_list || []) : null,
                appendix: sections.appendix !== false ? enriched.slice(0, 50).map(a => ({ title: a.title, url: a.url, published_at: a.published_at, sentiment: a.analysis?.sentiment || '—', importance: a.analysis?.importance_score || 0 })) : null,
            },
        });
    } catch (err) {
        console.error('[REPORT] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// ── helpers for media report ────────────────────────────────────────────────
const ODISHA_KW = [
    'odisha','odia','orissa','bhubaneswar','cuttack','puri','rourkela','sambalpur',
    'berhampur','balasore','jharsuguda','angul','kalahandi','koraput','mayurbhanj',
    'sundargarh','kendrapara','jajpur','ganjam','naveen patnaik','mohan majhi',
    'bjd','biju janata','odishatv','dharitri','sambad','pragativadi','utkal',
    'kalinga','jagannath','konark','chilika','hirakud','mahanadi','jspl','nalco',
    'paradip','gopalpur','idco','orissa post','ଓଡ଼ିଶା','ଓଡ଼ିଆ',
];
function isOdisha(a){ const t=`${a.title||''} ${a.summary||''} ${(a.matched_keywords||[]).join(' ')}`.toLowerCase(); return ODISHA_KW.some(k=>t.includes(k)); }

const TV_SRC=['odishatv','ndtv','timesnow','republic','aajtak','abp','zee','india today','wion','dd news','kalinga tv','news18','cnbc','bbc','cnn','al jazeera','youtube','argus','ap news'];
const NP_SRC=['utkal samachar','dharitri','sambad','pragativadi','samaja','times of india','hindustan times','the hindu','indian express','telegraph','economic times','business standard','livemint','deccan','pioneer','statesman','tribune','orissa post','odisha bhaskar','daily','gazette','guardian'];
function classifySrc(n,u){ const s=(n||'').toLowerCase(),uu=(u||'').toLowerCase(); for(const t of TV_SRC) if(s.includes(t)||uu.includes(t.replace(/ /g,''))) return 'TV Intelligence'; for(const p of NP_SRC) if(s.includes(p)||uu.includes(p.replace(/ /g,''))) return 'Newspapers'; return 'Online News'; }

async function fetchOgImg(url){ if(!url) return null; try{ const c=new AbortController(); const tId = setTimeout(()=>c.abort(),2500); // reduced to 2.5s
const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},redirect:'follow'}); 
clearTimeout(tId);
if(!r.ok) return null; const h=await r.text(); let m=h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)||h.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i); if(m?.[1]){let i=m[1]; if(i.startsWith('//')) i='https:'+i; if(i.startsWith('/'))i=new URL(url).origin+i; return i;} }catch{} return null; }

function svgPh(src,mt){ const c=mt==='TV Intelligence'?{bg:'#ede9fe',ic:'#7c3aed',tx:'#6d28d9'}:mt==='Online News'?{bg:'#e0f7f5',ic:'#0d9488',tx:'#0f766e'}:{bg:'#fff7ed',ic:'#ea580c',tx:'#c2410c'}; const ico=mt==='TV Intelligence'?`<rect x="8" y="12" width="24" height="16" rx="2" fill="${c.ic}" opacity=".8"/><polygon points="18,16 18,24 25,20" fill="white"/>`:`<circle cx="20" cy="20" r="10" fill="none" stroke="${c.ic}" stroke-width="1.5" opacity=".8"/>`; const s=`<svg xmlns="http://www.w3.org/2000/svg" width="130" height="85" viewBox="0 0 130 85"><rect width="130" height="85" rx="6" fill="${c.bg}"/><g transform="translate(45,4)">${ico}</g><text x="65" y="60" text-anchor="middle" font-family="Arial" font-size="8" font-weight="600" fill="${c.tx}">${(src||'').substring(0,16)}</text><text x="65" y="72" text-anchor="middle" font-family="Arial" font-size="7" fill="${c.ic}" opacity=".5">${mt}</text></svg>`; return `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`; }

function sentStyle(s){ if(s==='positive') return {bg:'#dcfce7',col:'#166534',br:'#86efac',lbl:'● POSITIVE'}; if(s==='negative') return {bg:'#fef2f2',col:'#991b1b',br:'#fca5a5',lbl:'● NEGATIVE'}; return {bg:'#f1f5f9',col:'#475569',br:'#cbd5e1',lbl:'● NEUTRAL'}; }

function fmtD(d){ return new Date(d).toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'}); }
function fmtT(d){ return new Date(d).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }
function grpByDate(items){ const g={}; items.forEach(a=>{const k=new Date(a.published_at||a.created_at).toISOString().split('T')[0]; if(!g[k])g[k]=[]; g[k].push(a);}); return Object.entries(g).sort(([a],[b])=>b.localeCompare(a)); }

function artCard(a){ const ss=sentStyle(a.sentiment); const fb=svgPh(a.source_name,a.mediaType); const img=a.image_url||fb; return `<div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid #f1f5f9;break-inside:avoid;page-break-inside:avoid;"><img src="${img}" alt="" style="width:130px;height:85px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid #e2e8f0;" onerror="this.src='${fb}'"><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;"><span style="background:${ss.bg};color:${ss.col};border:1px solid ${ss.br};padding:2px 10px;border-radius:4px;font-size:10px;font-weight:600;">${ss.lbl}</span><span style="color:#94a3b8;font-size:11px;">${fmtT(a.published_at||a.created_at)}</span><span style="color:#94a3b8;font-size:11px;">|</span><span style="color:#64748b;font-size:11px;font-weight:500;">${a.source_name}</span>${a.importance>=7?'<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;">⚡ HIGH PRIORITY</span>':''}</div><a href="${a.url||'#'}" target="_blank" style="font-size:14px;font-weight:600;color:#0f172a;text-decoration:none;line-height:1.3;display:block;margin-bottom:4px;">${a.title||'Untitled'}</a><p style="font-size:12px;color:#64748b;line-height:1.5;margin:0;">${(a.summary||a.title||'').substring(0,220)}</p>${a.matched_keywords?.length?`<div style="margin-top:6px;">${a.matched_keywords.slice(0,5).map(k=>`<span style="background:#f0fdf4;color:#166534;padding:2px 8px;border-radius:4px;font-size:9px;margin-right:4px;">#${k}</span>`).join('')}</div>`:''}</div></div>`; }

function buildSec(title,icon,items,color){ const groups=grpByDate(items); if(!items.length) return `<div class="page-break" style="padding:50px 60px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:12px;border-bottom:3px solid ${color};"><span style="font-size:28px;">${icon}</span><h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">${title}</h2><span style="background:${color}20;color:${color};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;margin-left:auto;">0 Stories</span></div><p style="color:#94a3b8;font-style:italic;">No Odisha-relevant articles in this category.</p></div>`; let html=`<div class="page-break" style="padding:50px 60px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid ${color};"><span style="font-size:28px;">${icon}</span><h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">${title}</h2><span style="background:${color}20;color:${color};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;margin-left:auto;">${items.length} Stories</span></div>`; for(const [date,dayItems] of groups){ html+=`<div style="margin-bottom:28px;"><div style="background:linear-gradient(90deg,${color}15,transparent);padding:8px 16px;border-left:4px solid ${color};border-radius:0 6px 6px 0;margin-bottom:12px;"><span style="font-size:14px;font-weight:700;color:#0f172a;">📅 ${fmtD(date)}</span><span style="color:#94a3b8;font-size:12px;margin-left:12px;">${dayItems.length} stories</span></div>${dayItems.map(a=>artCard(a)).join('')}</div>`; } return html+'</div>'; }

// POST /generate-media-report — full styled daily media intelligence HTML report
router.post('/generate-media-report', async (req, res) => {
    try {
        const db = mkAdmin();
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        // Fetch all data
        const { data: allArticles } = await db.from('articles')
            .select('id, title, url, source_id, published_at, created_at, matched_keywords')
            .eq('client_id', client.id)
            .order('published_at', { ascending: false })
            .limit(500);

        const sourceIds = [...new Set((allArticles||[]).map(a=>a.source_id).filter(Boolean))];
        const { data: sources } = sourceIds.length
            ? await db.from('sources').select('id, name, url, source_type').in('id', sourceIds)
            : { data: [] };
        const srcMap = {}; (sources||[]).forEach(s=>{srcMap[s.id]=s;});

        const articleIds = (allArticles||[]).map(a=>a.id);
        const { data: analyses } = articleIds.length
            ? await db.from('article_analysis').select('article_id,sentiment,importance_score,summary,entities').in('article_id',articleIds)
            : { data: [] };
        const anaMap = {}; (analyses||[]).forEach(a=>{anaMap[a.article_id]=a;});

        const { data: signals } = await db.from('intelligence_signals')
            .select('title,description,severity,signal_type')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false })
            .limit(10);

        // Enrich + Odisha filter
        const all = (allArticles||[]).map(a=>{
            const src=srcMap[a.source_id]||{};
            const ana=anaMap[a.id]||null;
            return {...a, source_name:src.name||'Unknown', analysis:ana,
                sentiment:ana?.sentiment||'neutral', importance:ana?.importance_score||0,
                summary:ana?.summary||'', mediaType:classifySrc(src.name||'',a.url)};
        });
        const enriched = all.filter(a=>isOdisha(a));

        // Fetch og:image in batches of 5 — LIMIT to top 30 to prevent 30s timeout
        const imgCache = {};
        const forImaging = enriched.slice(0, 30);
        for(let i=0;i<forImaging.length;i+=5){
            const batch=forImaging.slice(i,i+5);
            try {
                const results=await Promise.all(batch.map(async a=>({id:a.id,img:await fetchOgImg(a.url)})));
                results.forEach(r=>{if(r.img)imgCache[r.id]=r.img;});
            } catch (imgErr) {
                console.warn('Image fetch batch failed:', imgErr.message);
            }
        }
        enriched.forEach(a=>{a.image_url=imgCache[a.id]||null;});

        // Stats
        const analyzed=enriched.filter(a=>a.analysis);
        const pos=analyzed.filter(a=>a.sentiment==='positive').length;
        const neg=analyzed.filter(a=>a.sentiment==='negative').length;
        const neu=analyzed.filter(a=>a.sentiment==='neutral').length;
        const tot=analyzed.length||1;
        const tvA=enriched.filter(a=>a.mediaType==='TV Intelligence');
        const onA=enriched.filter(a=>a.mediaType==='Online News');
        const npA=enriched.filter(a=>a.mediaType==='Newspapers');
        const cmA=enriched.filter(a=>{const t=`${a.title} ${a.summary}`.toLowerCase(); return t.includes('mohan majhi')||t.includes('chief minister')||t.includes('cm majhi');});
        const cmPos=cmA.filter(a=>a.sentiment==='positive').length, cmNeg=cmA.filter(a=>a.sentiment==='negative').length, cmNeu=cmA.filter(a=>a.sentiment==='neutral').length;

        const issues=[
            {name:'Infrastructure & Development',kw:['infrastructure','development','road','bridge','highway','construction','smart city','industrial','idco']},
            {name:'Political Landscape',kw:['bjd','bjp','congress','election','political','assembly','party','opposition','naveen patnaik']},
            {name:'Steel & Mining',kw:['tata steel','jspl','nalco','sail','mining','steel','rourkela','angul']},
            {name:'Public Welfare',kw:['protest','scam','fraud','corruption','welfare','scheme','poverty','tribal','farmer']},
            {name:'Economy & Business',kw:['gst','investment','budget','economy','trade','business','revenue','mou']},
            {name:'Climate & Disaster',kw:['flood','cyclone','climate','rain','disaster','drought','environment']},
        ].map(issue=>{
            const m=enriched.filter(a=>{const t=`${a.title} ${a.summary} ${(a.matched_keywords||[]).join(' ')}`.toLowerCase(); return issue.kw.some(k=>t.includes(k));});
            return {...issue,total:m.length,positive:m.filter(a=>a.sentiment==='positive').length,negative:m.filter(a=>a.sentiment==='negative').length,neutral:m.filter(a=>a.sentiment==='neutral').length};
        }).filter(i=>i.total>0);

        function issueBars(issue){ const t=issue.total||1; const pp=Math.round(issue.positive/t*100),np=Math.round(issue.negative/t*100),nup=100-pp-np; return `<div style="margin-bottom:16px;break-inside:avoid;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span style="font-size:13px;font-weight:600;color:#0f172a;">${issue.name}</span><span style="font-size:11px;color:#94a3b8;">${issue.total} articles</span></div><div style="display:flex;height:24px;border-radius:6px;overflow:hidden;background:#f1f5f9;">${pp>0?`<div style="width:${pp}%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${pp}%</div>`:''}${nup>0?`<div style="width:${nup}%;background:#94a3b8;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${nup}%</div>`:''}${np>0?`<div style="width:${np}%;background:#ef4444;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${np}%</div>`:''}</div></div>`; }

        const html = generateMediaReportHtml({
            client,
            enriched,
            pos, neu, neg, tot,
            tvA, onA, npA,
            cmA, cmPos, cmNeu, cmNeg,
            issues,
            sentStyle,
            fmtT,
            fmtD,
            grpByDate,
            svgPh
        });

        // Generate PDF from HTML using Puppeteer



        // Generate PDF from HTML using Puppeteer
        const browser = await getBrowserInstance();
        let pdfBuffer;
        try {
            const page = await browser.newPage();
            // Network idle is necessary to load external images (og:images)
            await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
            pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
            });
        } finally {
            await browser.close().catch(() => {});
        }

        res.setHeader('Content-Type','application/pdf');
        res.setHeader('Content-Disposition',`attachment; filename="ROBIN_Media_Report_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.send(Buffer.from(pdfBuffer));
    } catch(err){
        console.error('[MEDIA-REPORT]',err.message);
        res.status(500).json({error:err.message});
    }
});



// POST /chat — SSE streaming chat
router.post('/chat', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { question } = req.body;
        if (!question || question.length < 3) {
            return res.status(400).json({ error: 'Question must be at least 3 chars' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let aborted = false;
        req.on('close', () => { aborted = true; });

        const articles = await retrieveRelevantArticles(question, client.id);
        res.write(`data: ${JSON.stringify({ type: 'articles', count: articles.length, articles: articles.slice(0, 5).map(a => ({ title: a.title?.substring(0, 80), similarity: a.similarity?.toFixed(3) })) })}\n\n`);

        const stream = generateChatResponseStream(question, client.id, client.name);
        for await (const token of stream) {
            if (aborted) break;
            res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
        }

        if (!aborted) res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: err.message });
        else { res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`); res.end(); }
    }
});

// GET /chat/history — retrieve past conversations
router.get('/chat/history', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { data, error } = await supabase
            .from('chat_history')
            .select('id, question, answer, articles_referenced, created_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) return res.status(500).json({ error: error.message });
        res.json({ history: data ?? [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /sources
router.get('/sources', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { data: sources } = await supabase
            .from('sources')
            .select('id, name, url, source_type, is_active, last_scraped_at, scrape_success_count, scrape_fail_count, created_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });

        res.json({ data: sources || [], client });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /sources
router.post('/sources', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { name, url, source_type } = req.body;
        if (!name || !url || !source_type) return res.status(400).json({ error: 'name, url, source_type required' });
        if (!['rss', 'html', 'browser', 'pdf', 'youtube'].includes(source_type)) {
            return res.status(400).json({ error: 'Invalid source_type' });
        }

        const { data, error } = await supabase.from('sources')
            .insert({ client_id: client.id, name, url, source_type, is_active: true })
            .select().single();

        if (error) throw error;
        res.json({ data, message: 'Source added' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /sources/:id
router.delete('/sources/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('sources').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Source deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /sources/:id/toggle
router.patch('/sources/:id/toggle', async (req, res) => {
    try {
        const { data: source } = await supabase.from('sources').select('is_active').eq('id', req.params.id).single();
        if (!source) return res.status(404).json({ error: 'Source not found' });

        const { data, error } = await supabase.from('sources')
            .update({ is_active: !source.is_active })
            .eq('id', req.params.id).select().single();

        if (error) throw error;
        res.json({ data, message: `Source ${data.is_active ? 'activated' : 'deactivated'}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /keywords — from active brief
router.get('/keywords', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        // Get active brief
        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', client.id).eq('status', 'active').limit(1).single();

        if (!brief) return res.json({ data: [], client });

        const { data } = await supabase.from('brief_generated_keywords')
            .select('*').eq('brief_id', brief.id).order('priority', { ascending: false });
        res.json({ data: data || [], client });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /keywords — add to active brief
router.post('/keywords', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', client.id).eq('status', 'active').limit(1).single();
        if (!brief) return res.status(400).json({ error: 'No active brief' });

        const { keyword, category } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });

        const { data, error } = await supabase.from('brief_generated_keywords')
            .insert({ brief_id: brief.id, keyword, category: category || 'general', priority: 5 })
            .select().single();

        if (error) throw error;
        res.json({ data, message: 'Keyword added' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /keywords/:id
router.delete('/keywords/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('brief_generated_keywords').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Keyword deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Briefs ──────────────────────────────────────────────────

// GET /briefs — list briefs
router.get('/briefs', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { data, error } = await supabase
            .from('client_briefs')
            .select('id, title, problem_statement, status, industry, risk_domains, entities_of_interest, geographic_focus, created_at, activated_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ data: data || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /briefs/:id — full brief with keywords + sources
router.get('/briefs/:id', async (req, res) => {
    try {
        const { data: brief, error } = await supabase
            .from('client_briefs')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !brief) return res.status(404).json({ error: 'Brief not found' });

        const [kwRes, srcRes] = await Promise.all([
            supabase.from('brief_generated_keywords').select('*').eq('brief_id', req.params.id).order('priority', { ascending: false }),
            supabase.from('brief_recommended_sources').select('*').eq('brief_id', req.params.id),
        ]);

        res.json({
            brief,
            keywords: kwRes.data || [],
            recommended_sources: srcRes.data || [],
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /briefs/follow-up — generate smart follow-up questions
router.post('/briefs/follow-up', async (req, res) => {
    try {
        const { input, intake_mode = 'describe', title } = req.body;
        if (!input) return res.status(400).json({ error: 'input required' });

        const { generateFollowUps } = await import('../ai/intake-questioner.js');
        const result = await generateFollowUps(input, intake_mode, { title });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /briefs/parse-document — parse a pasted document for monitoring data
router.post('/briefs/parse-document', async (req, res) => {
    try {
        const { document_text } = req.body;
        if (!document_text || document_text.length < 20) {
            return res.status(400).json({ error: 'document_text required (min 20 chars)' });
        }

        const { parseDocument } = await import('../ai/document-parser.js');
        const result = await parseDocument(document_text);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /briefs — submit a new brief (single-brief-per-client, auto-activates)
router.post('/briefs', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { title, problem_statement, intake_mode = 'describe', entity_names = [], follow_up_answers = {} } = req.body;
        if (!title || !problem_statement) return res.status(400).json({ error: 'title and problem_statement required' });

        // ── Step 0: Delete ALL old briefs and their generated data ──
        const { data: oldBriefs } = await supabase
            .from('client_briefs')
            .select('id')
            .eq('client_id', client.id);

        if (oldBriefs && oldBriefs.length > 0) {
            const oldIds = oldBriefs.map(b => b.id);
            await Promise.all([
                supabase.from('brief_generated_keywords').delete().in('brief_id', oldIds),
                supabase.from('brief_recommended_sources').delete().in('brief_id', oldIds),
            ]);
            await supabase.from('client_briefs').delete().eq('client_id', client.id);
            console.log(`[BRIEF] Deleted ${oldBriefs.length} old brief(s) and their data`);
        }

        // ── Step 0b: Clear ALL old pipeline data for this client ──
        // First get article IDs for analysis cleanup
        const { data: oldArticles } = await supabase
            .from('articles').select('id').eq('client_id', client.id);
        const oldArticleIds = (oldArticles || []).map(a => a.id);

        // Delete analysis records if articles exist
        if (oldArticleIds.length > 0) {
            await supabase.from('article_analysis').delete().in('article_id', oldArticleIds);
        }

        // Clean intelligence tables in parallel
        await Promise.all([
            supabase.from('intelligence_signals').delete().eq('client_id', client.id),
            supabase.from('entity_profiles').delete().eq('client_id', client.id),
            supabase.from('entity_mentions').delete().eq('client_id', client.id),
            supabase.from('threat_assessments').delete().eq('client_id', client.id),
            supabase.from('narrative_patterns').delete().eq('client_id', client.id),
            supabase.from('inference_chains').delete().eq('client_id', client.id),
            supabase.from('source_reliability').delete().eq('client_id', client.id),
        ]);
        // Delete articles, content_items, and sources after analysis cleanup
        await supabase.from('articles').delete().eq('client_id', client.id);
        await supabase.from('content_items').delete().eq('client_id', client.id);
        await supabase.from('sources').delete().eq('client_id', client.id);
        console.log(`[BRIEF] Cleared all old pipeline data for client ${client.id}`);

        // ── Step 1: Create the new brief ──
        const briefInsert = {
            client_id: client.id,
            title,
            problem_statement,
            status: 'processing',
        };
        // Add intake mode fields (graceful — columns may not exist pre-migration)
        if (intake_mode) briefInsert.intake_mode = intake_mode;
        if (entity_names.length > 0) briefInsert.entity_names = entity_names;
        if (Object.keys(follow_up_answers).length > 0) briefInsert.follow_up_answers = follow_up_answers;

        const { data: brief, error } = await supabase
            .from('client_briefs')
            .insert(briefInsert)
            .select()
            .single();

        if (error) throw error;

        res.status(202).json({
            message: 'Brief received. AI is generating keywords and source recommendations.',
            brief_id: brief.id,
            status: 'processing',
        });

        // ── Step 2: Background AI processing + auto-activation ──
        try {
            const { generateKeywordsFromBrief } = await import('../ai/keyword-generator.js');
            const { discoverSourcesForBrief } = await import('../ai/source-discoverer.js');

            const { context, keywords } = await generateKeywordsFromBrief(problem_statement, title || 'Intelligence Client');
            const sources = await discoverSourcesForBrief(context);

            // ── Entity enrichment (if entity names were provided) ──
            let entityProfiles = [];
            if (entity_names.length > 0) {
                try {
                    const { enrichEntitiesForBrief } = await import('../ai/entity-enricher.js');
                    const enrichResult = await enrichEntitiesForBrief(entity_names, {
                        industry: context.industry,
                        geography: context.geographic_focus,
                        briefContext: problem_statement,
                    });
                    entityProfiles = enrichResult.profiles;

                    // Merge enriched keywords into the keyword list
                    for (const kw of enrichResult.mergedKeywords) {
                        if (!keywords.find(k => k.keyword.toLowerCase() === kw.toLowerCase())) {
                            keywords.push({
                                keyword: kw,
                                category: 'core_entity',
                                priority: 7,
                                rationale: 'Auto-enriched from entity research',
                            });
                        }
                    }
                    console.log(`[BRIEF] Entity enrichment: ${entityProfiles.length} profiles, ${enrichResult.mergedKeywords.length} keywords merged`);
                } catch (enrichErr) {
                    console.error('[BRIEF] Entity enrichment failed (non-blocking):', enrichErr.message);
                }
            }

            // Save generated keywords to brief
            if (keywords.length > 0) {
                await supabase.from('brief_generated_keywords').insert(
                    keywords.map(kw => ({
                        brief_id: brief.id,
                        keyword: kw.keyword,
                        category: kw.category,
                        priority: kw.priority || 5,
                        rationale: kw.rationale || '',
                    }))
                );
            }

            // ── Generate and save watch expressions ──
            try {
                const { generateWatchExpressions } = await import('../ai/expression-matcher.js');
                const watchExprs = generateWatchExpressions(context, keywords);
                if (watchExprs.length > 0) {
                    await supabase.from('watch_expressions').insert(
                        watchExprs.map(we => ({
                            client_id: client.id,
                            brief_id: brief.id,
                            expression_type: we.expression_type,
                            label: we.label,
                            expression: we.expression,
                        }))
                    );
                    console.log(`[BRIEF] ${watchExprs.length} watch expressions created`);
                }
            } catch (weErr) {
                console.error('[BRIEF] Watch expressions failed (non-blocking):', weErr.message);
            }

            // Save recommended sources to brief
            if (sources.length > 0) {
                await supabase.from('brief_recommended_sources').insert(
                    sources.map(s => ({
                        brief_id: brief.id,
                        name: s.name,
                        url: s.url,
                        source_type: mapSourceType(s.source_type),
                        expected_hit_rate: s.expected_hit_rate || 'medium',
                        rationale: s.rationale || '',
                    }))
                );
            }

            // ── Step 3: Auto-activate — push sources to live table ──
            // Keywords are read directly from brief_generated_keywords by scraper

            // Sources → sources table
            if (sources.length > 0) {
                try {
                    const { error: srcErr } = await supabase.from('sources').insert(
                        sources.map(s => ({
                            client_id: client.id,
                            name: s.name,
                            url: s.url,
                            source_type: mapSourceTypeLive(s.source_type),
                            is_active: true,
                        }))
                    );
                    if (srcErr) console.error('[BRIEF] sources insert failed:', srcErr.message);
                    else console.log(`[BRIEF] Pushed ${sources.length} sources to sources table`);
                } catch (srcPushErr) {
                    console.error('[BRIEF] sources push error:', srcPushErr.message);
                }
            }

            // Update brief to active
            await supabase.from('client_briefs').update({
                industry: context.industry,
                risk_domains: context.risk_domains || [],
                entities_of_interest: context.entities_of_interest || [],
                competitors: context.competitors || [],
                geographic_focus: context.geographic_focus || [],
                status: 'active',
                activated_at: new Date().toISOString(),
            }).eq('id', brief.id);

            console.log(`[BRIEF] Auto-activated: ${keywords.length} keywords in brief, ${sources.length} sources pushed`);

            // ── Step 4: Force-reset scraper lock and auto-trigger scrape ──
            // Keywords are now fully saved and brief is active — safe to scrape.
            // Wait 3s to ensure all DB writes are committed before the orchestrator
            // queries brief_generated_keywords and client_briefs.status='active'.
            try {
                await supabase.from('system_state').upsert({
                    key: 'scraper_running',
                    value: 'false',
                    updated_at: new Date().toISOString(),
                });
                console.log('[BRIEF] Scraper lock released. Waiting 3s for DB to commit...');

                // 3s delay: ensures status='active' + keywords are readable by orchestrator
                await new Promise(resolve => setTimeout(resolve, 3000));

                console.log('[BRIEF] Auto-triggering scraper now — keywords ready, brief active');
                runScraperCycle().catch(e => console.error('[BRIEF] Auto-scrape failed:', e.message));
                console.log('[BRIEF] Auto-scrape triggered ✓');
            } catch (scrapeErr) {
                console.error('[BRIEF] Could not trigger scrape:', scrapeErr.message);
            }

        } catch (aiErr) {
            console.error('[BRIEF] AI processing failed:', aiErr.message);
            await supabase.from('client_briefs').update({ status: 'failed' }).eq('id', brief.id);
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /briefs/:id/push — push brief sources to live sources table (synchronous)
router.post('/briefs/:id/push', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { id } = req.params;
        const { data: brief } = await supabase.from('client_briefs').select('*').eq('id', id).single();
        if (!brief) return res.status(404).json({ error: 'Brief not found' });

        // Get brief recommended sources
        const { data: briefSources } = await supabase
            .from('brief_recommended_sources').select('*').eq('brief_id', id);

        if (!briefSources || briefSources.length === 0) {
            return res.status(400).json({ error: 'No sources to push', brief_status: brief.status });
        }

        // Clear existing live sources for this client
        await supabase.from('sources').delete().eq('client_id', client.id);

        // Push brief sources to live sources table
        const { error: insertErr } = await supabase.from('sources').insert(
            briefSources.map(s => ({
                client_id: client.id,
                name: s.name,
                url: s.url,
                source_type: mapSourceTypeLive(s.source_type),
                is_active: true,
            }))
        );

        if (insertErr) {
            return res.status(500).json({ error: 'Source insert failed: ' + insertErr.message });
        }

        // Mark as active
        await supabase.from('client_briefs').update({
            status: 'active',
            activated_at: new Date().toISOString(),
        }).eq('id', id);

        // Trigger scrape
        runScraperCycle().catch(e => console.error('[PUSH] Scrape failed:', e.message));

        res.json({
            message: `Pushed ${briefSources.length} sources to live table. Scrape triggered.`,
            sources_pushed: briefSources.length,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /briefs/:id/retry — re-run AI processing for stuck briefs
router.post('/briefs/:id/retry', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { id } = req.params;
        const { data: brief } = await supabase.from('client_briefs').select('*').eq('id', id).single();
        if (!brief) return res.status(404).json({ error: 'Brief not found' });

        // Reset status to processing
        await supabase.from('client_briefs').update({ status: 'processing' }).eq('id', id);

        // Clear any partial data from previous attempt
        await Promise.all([
            supabase.from('brief_generated_keywords').delete().eq('brief_id', id),
            supabase.from('brief_recommended_sources').delete().eq('brief_id', id),
        ]);

        res.status(202).json({ message: 'Re-processing brief...', brief_id: id, status: 'processing' });

        // Re-run the full AI pipeline in background
        try {
            const { generateKeywordsFromBrief } = await import('../ai/keyword-generator.js');
            const { discoverSourcesForBrief } = await import('../ai/source-discoverer.js');

            console.log(`[BRIEF RETRY] Starting AI processing for brief ${id}`);
            const { context, keywords } = await generateKeywordsFromBrief(brief.problem_statement, brief.title || 'Intelligence Client');
            console.log(`[BRIEF RETRY] Keywords generated: ${keywords.length}`);
            console.log(`[BRIEF RETRY] Context:`, JSON.stringify({ industry: context.industry, entities: context.entities_of_interest, geo: context.geographic_focus, risk: context.risk_domains }));

            let sources = [];
            try {
                sources = await discoverSourcesForBrief(context);
                console.log(`[BRIEF RETRY] Sources discovered: ${sources.length}`);
            } catch (srcErr) {
                console.error(`[BRIEF RETRY] Source discovery THREW:`, srcErr.message, srcErr.stack);
            }

            // Save keywords
            if (keywords.length > 0) {
                await supabase.from('brief_generated_keywords').insert(
                    keywords.map(kw => ({
                        brief_id: id,
                        keyword: kw.keyword,
                        category: kw.category,
                        priority: kw.priority || 5,
                        rationale: kw.rationale || '',
                    }))
                );
            }

            // Save sources
            if (sources.length > 0) {
                await supabase.from('brief_recommended_sources').insert(
                    sources.map(s => ({
                        brief_id: id,
                        name: s.name,
                        url: s.url,
                        source_type: mapSourceType(s.source_type),
                        expected_hit_rate: s.expected_hit_rate || 'medium',
                        rationale: s.rationale || '',
                    }))
                );

                // Push to live sources table
                await supabase.from('sources').delete().eq('client_id', client.id);
                await supabase.from('sources').insert(
                    sources.map(s => ({
                        client_id: client.id,
                        name: s.name,
                        url: s.url,
                        source_type: mapSourceTypeLive(s.source_type),
                        is_active: true,
                    }))
                );
            }

            // Activate
            await supabase.from('client_briefs').update({
                industry: context.industry,
                risk_domains: context.risk_domains || [],
                entities_of_interest: context.entities_of_interest || [],
                competitors: context.competitors || [],
                geographic_focus: context.geographic_focus || [],
                status: 'active',
                activated_at: new Date().toISOString(),
            }).eq('id', id);

            console.log(`[BRIEF RETRY] Complete — ${keywords.length} keywords, ${sources.length} sources`);

            // Auto-scrape: reset lock first (might be stuck), then wait for DB to commit
            try {
                await supabase.from('system_state').upsert({
                    key: 'scraper_running',
                    value: 'false',
                    updated_at: new Date().toISOString(),
                });
                console.log('[BRIEF RETRY] Scraper lock released. Waiting 3s for DB to commit...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                console.log('[BRIEF RETRY] Auto-triggering scraper — keywords ready, brief active');
                runScraperCycle().catch(e => console.error('[BRIEF RETRY] Scrape failed:', e.message));
                console.log('[BRIEF RETRY] Auto-scrape triggered ✓');
            } catch (scrapeErr) {
                console.error('[BRIEF RETRY] Could not trigger scrape:', scrapeErr.message);
            }
        } catch (aiErr) {
            console.error('[BRIEF RETRY] AI processing failed:', aiErr.message, aiErr.stack);
            await supabase.from('client_briefs').update({ status: 'failed' }).eq('id', id);
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /source-debug — synchronous diagnostic: run source discovery and return results
router.get('/source-debug', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const { data: brief } = await supabase.from('client_briefs')
            .select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(1).single();
        if (!brief) return res.status(404).json({ error: 'No brief found' });

        const { discoverSourcesForBrief } = await import('../ai/source-discoverer.js');

        // Use already-saved context from the brief (skip keyword generation to avoid rate limits)
        const context = {
            industry: brief.industry || 'general',
            core_problem: brief.problem_statement,
            risk_domains: brief.risk_domains || [],
            entities_of_interest: brief.entities_of_interest || [],
            geographic_focus: brief.geographic_focus || [],
            competitors: brief.competitors || [],
        };

        // Step 2: Discover sources using saved context
        const sources = await discoverSourcesForBrief(context);

        // Step 3: Save if we got any
        let saveErrors = [];
        if (sources.length > 0) {
            const { error: delErr } = await supabase.from('brief_recommended_sources').delete().eq('brief_id', brief.id);
            if (delErr) saveErrors.push(`delete recommended: ${delErr.message}`);

            const { error: insErr } = await supabase.from('brief_recommended_sources').insert(
                sources.map(s => ({
                    brief_id: brief.id,
                    name: s.name,
                    url: s.url,
                    source_type: mapSourceType(s.source_type),
                    expected_hit_rate: s.expected_hit_rate || 'medium',
                    rationale: s.rationale || '',
                }))
            );
            if (insErr) saveErrors.push(`insert recommended: ${insErr.message}`);

            // Also push to live sources table
            const { error: delSrcErr } = await supabase.from('sources').delete().eq('client_id', client.id);
            if (delSrcErr) saveErrors.push(`delete sources: ${delSrcErr.message}`);

            const { error: insSrcErr } = await supabase.from('sources').insert(
                sources.map(s => ({
                    client_id: client.id,
                    name: s.name,
                    url: s.url,
                    source_type: mapSourceType(s.source_type),
                    is_active: true,
                }))
            );
            if (insSrcErr) saveErrors.push(`insert sources: ${insSrcErr.message}`);

            // Mark as active
            const { error: updErr } = await supabase.from('client_briefs').update({
                status: 'active',
                activated_at: new Date().toISOString(),
                industry: context.industry,
                risk_domains: context.risk_domains || [],
                entities_of_interest: context.entities_of_interest || [],
                geographic_focus: context.geographic_focus || [],
            }).eq('id', brief.id);
            if (updErr) saveErrors.push(`update brief: ${updErr.message}`);
        }

        res.json({
            brief_id: brief.id,
            context: { industry: context.industry, entities: context.entities_of_interest, geo: context.geographic_focus, risk: context.risk_domains },
            keywords_count: 'skipped (using saved context)',
            sources_count: sources.length,
            save_errors: saveErrors,
            sources: sources.map(s => ({ name: s.name, url: s.url, type: s.source_type, validated: s.url_validated })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

// POST /scrape — trigger scraper or batch intelligence
router.post('/scrape', async (req, res) => {
    try {
        const { sourceId, mode } = req.body;

        if (mode === 'intelligence') {
            res.json({ message: 'Batch intelligence started...', started: true });
            const { runBatchIntelligence } = await import('../ai/batch-intelligence.js');
            runBatchIntelligence().catch(e => log.ai.error('Manual intelligence failed', { error: e.message }));
        } else if (sourceId) {
            res.json({ message: 'Scraping source...', started: true });
            scrapeSourceById(sourceId).catch(e => log.scraper.error('Manual scrape failed', { error: e.message }));
        } else {
            res.json({ message: 'Scraping all sources...', started: true });
            runScraperCycle().catch(e => log.scraper.error('Manual scrape cycle failed', { error: e.message }));
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /scraper-status
router.get('/scraper-status', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const [lockRes, srcCountRes, a24hRes, totalRes, pendingRes, dupesRes, srcBreakdownRes, aPrev24hRes] = await Promise.all([
            supabase.from('system_state').select('value, updated_at').eq('key', 'scraper_running').single(),
            supabase.from('sources').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('is_active', true),
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', client.id).gte('created_at', new Date(Date.now() - 86400000).toISOString()),
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('analysis_status', 'pending'),
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', client.id).not('cross_source_duplicate_of', 'is', null),
            supabase.from('sources').select('source_type, is_active').eq('client_id', client.id),
            // Previous 24h: articles from 48h ago to 24h ago
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', client.id)
                .gte('created_at', new Date(Date.now() - 2 * 86400000).toISOString())
                .lt('created_at', new Date(Date.now() - 86400000).toISOString()),
        ]);

        const typeBreakdown = {};
        for (const s of (srcBreakdownRes.data || [])) {
            if (!typeBreakdown[s.source_type]) typeBreakdown[s.source_type] = { active: 0, total: 0 };
            typeBreakdown[s.source_type].total++;
            if (s.is_active) typeBreakdown[s.source_type].active++;
        }

        res.json({
            scraper_running: lockRes.data?.value === 'true',
            last_run: lockRes.data?.updated_at,
            total_sources: srcCountRes.count || 0,
            total_articles: totalRes.count || 0,
            articles_last_24h: a24hRes.count || 0,
            articles_previous_24h: aPrev24hRes.count || 0,
            pending_analysis: pendingRes.count || 0,
            cross_source_duplicates: dupesRes.count || 0,
            source_types: typeBreakdown,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /intelligence — full intelligence picture
router.get('/intelligence', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const [threatRes, signalsRes, entitiesRes, sourceRes, narrativeRes, inferenceRes] = await Promise.all([
            supabase.from('threat_assessments').select('*').eq('client_id', client.id).order('assessment_date', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('intelligence_signals').select('*').eq('client_id', client.id).eq('is_acknowledged', false).order('created_at', { ascending: false }).limit(20),
            supabase.from('entity_profiles').select('*').eq('client_id', client.id).order('influence_score', { ascending: false }).limit(20),
            supabase.from('source_reliability').select('*, sources!inner(name, url)').eq('client_id', client.id),
            supabase.from('narrative_patterns').select('*').eq('client_id', client.id).order('pattern_date', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('inference_chains').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(5),
        ]);

        const entities = entitiesRes.data || [];
        const entityGraph = {
            nodes: entities.map(e => ({ id: e.entity_name, type: e.entity_type, influence: e.influence_score, mentions: e.mention_count })),
            edges: entities.flatMap(e => (e.relationships || []).map(r => ({ source: e.entity_name, target: r.entity_name, weight: r.strength }))),
        };

        const threat = threatRes.data || null;
        let mappedThreat = null;

        if (threat) {
            mappedThreat = {
                overall_risk: threat.overall_score || 0,
                risk_level: threat.risk_level || (threat.overall_score >= 80 ? 'critical' : threat.overall_score >= 60 ? 'high' : threat.overall_score >= 40 ? 'medium' : 'low'),
                financial_risk: threat.dimensions?.financial || 0,
                regulatory_risk: threat.dimensions?.regulatory || 0,
                reputational_risk: threat.dimensions?.reputational || 0,
                operational_risk: threat.dimensions?.operational || 0,
                geopolitical_risk: threat.dimensions?.geopolitical || 0
            };
        }

        // Parse weekly_narrative JSON into structured sections for frontend
        let narrative = null;
        const rawNarrative = narrativeRes.data;
        if (rawNarrative) {
            let sections = {};
            try {
                const wn = rawNarrative.weekly_narrative;
                sections = typeof wn === 'string' ? JSON.parse(wn) : (wn || {});
            } catch { /* not JSON, use as-is */ }
            narrative = {
                ...rawNarrative,
                executive_summary: sections.executive_summary || null,
                key_developments: sections.key_developments || null,
                emerging_threats: sections.emerging_threats || null,
                entity_movements: sections.entity_movements || null,
                coverage_patterns: sections.coverage_patterns || null,
                watch_list: sections.watch_list || null,
                full_narrative: sections.full_narrative || null,
            };
        }

        res.json({
            client,
            threat_assessment: mappedThreat,
            signals: (signalsRes.data || []).map(s => ({
                ...s,
                confidence: s.confidence ?? s.evidence?.computed_confidence ?? 0.60
            })),
            entity_profiles: entities.map(e => ({
                name: e.entity_name, type: e.entity_type, influence: e.influence_score,
                mentions: e.mention_count, sentiment: e.sentiment_profile, risk_tags: e.risk_tags,
                relationships: (e.relationships || []).slice(0, 5), first_seen: e.first_seen, last_seen: e.last_seen,
            })),
            entity_graph: entityGraph,
            source_reliability: (sourceRes.data || []).map(s => ({
                name: s.sources?.name || 'Unknown', reliability: s.reliability_score,
                bias: s.bias_direction, sentiment_skew: s.sentiment_skew, articles: s.article_count,
            })),
            narrative,
            inference_chains: inferenceRes.data || [],
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /reembed — re-embed all articles with Groq embeddings (background)
router.post('/reembed', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        res.json({ message: 'Re-embedding started in background', client: client.name });

        // Run in background
        (async () => {
            const { data: articles } = await supabase
                .from('articles')
                .select('id, title, content')
                .eq('client_id', client.id)
                .limit(500);

            let upgraded = 0, failed = 0;
            for (const article of (articles ?? [])) {
                try {
                    const text = `${article.title || ''}. ${article.content || ''}`.slice(0, 2000);
                    const { embedding, source } = await generateEmbedding(text);

                    if (source === 'groq' && embedding) {
                        const updateData = { embedding: JSON.stringify(embedding) };
                        // Try with embedding_source column
                        const { error } = await supabase.from('articles')
                            .update({ ...updateData, embedding_source: 'groq' })
                            .eq('id', article.id);
                        if (error && error.message.includes('embedding_source')) {
                            await supabase.from('articles').update(updateData).eq('id', article.id);
                        }
                        upgraded++;
                    } else {
                        failed++;
                    }
                    // Rate limiting: 200ms between Groq API calls
                    await new Promise(r => setTimeout(r, 200));
                } catch (err) {
                    failed++;
                    log.ai.warn('[REEMBED] Article failed', { id: article.id, error: err.message });
                }
            }
            console.log(`[REEMBED] Complete: ${upgraded} upgraded to Groq, ${failed} failed/skipped, ${articles?.length ?? 0} total`);
        })();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /signals/:id/acknowledge
router.patch('/signals/:id/acknowledge', async (req, res) => {
    try {
        const { error } = await supabase.from('intelligence_signals')
            .update({ is_acknowledged: true })
            .eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Signal acknowledged' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /signals/:id/articles — get related articles for a signal
router.get('/signals/:id/articles', async (req, res) => {
    try {
        const { data: signal } = await supabase.from('intelligence_signals')
            .select('related_article_ids, entity_name, evidence, title')
            .eq('id', req.params.id)
            .single();

        if (!signal) return res.status(404).json({ error: 'Signal not found' });

        let articles = [];

        // Try fetching by related_article_ids first
        const articleIds = signal.related_article_ids || [];
        if (articleIds.length > 0) {
            const { data } = await supabase.from('articles')
                .select('id, title, url, published_at, source_id, sources!inner(name)')
                .in('id', articleIds.slice(0, 10));
            if (data) articles = data;
        }

        // If no articles found by ID, try matching by entity name in article content
        if (articles.length === 0 && signal.entity_name) {
            const { data } = await supabase.from('articles')
                .select('id, title, url, published_at, source_id, sources!inner(name)')
                .ilike('title', `%${signal.entity_name}%`)
                .order('published_at', { ascending: false })
                .limit(5);
            if (data) articles = data;
        }

        // Also get analysis data for these articles
        if (articles.length > 0) {
            const { data: analyses } = await supabase.from('article_analysis')
                .select('article_id, sentiment, importance_score, summary')
                .in('article_id', articles.map(a => a.id));

            const analysisMap = {};
            for (const a of (analyses || [])) { analysisMap[a.article_id] = a; }
            articles = articles.map(a => ({ ...a, analysis: analysisMap[a.id] || null }));
        }

        res.json({ articles, entity_name: signal.entity_name });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// POST /rematch — re-run keyword matching on all existing articles (fixes stale matches)
router.post('/rematch', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        // Get active brief keywords
        const { data: activeBrief } = await supabase
            .from('client_briefs')
            .select('id, title')
            .eq('client_id', client.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!activeBrief) return res.status(400).json({ error: 'No active brief' });

        const { data: kwRows } = await supabase
            .from('brief_generated_keywords')
            .select('keyword')
            .eq('brief_id', activeBrief.id);

        const keywords = (kwRows || []).map(k => k.keyword);

        // Get all articles
        const { data: articles } = await supabase
            .from('articles')
            .select('id, title, content')
            .eq('client_id', client.id);

        if (!articles || articles.length === 0) {
            return res.json({ message: 'No articles to rematch', count: 0 });
        }

        // Import the updated matcher
        const { matchArticle, cleanArticleContent } = await import('../services/keyword-matcher.js');

        let updated = 0, removed = 0;
        for (const article of articles) {
            const cleanedContent = cleanArticleContent(article.content || '');
            const result = matchArticle({ title: article.title || '', content: cleanedContent }, keywords);

            if (result.matchedKeywords.length === 0) {
                // Article no longer matches any keyword — delete it
                await supabase.from('articles').delete().eq('id', article.id);
                removed++;
            } else {
                // Update with corrected keyword matches
                await supabase.from('articles')
                    .update({ matched_keywords: result.matchedKeywords })
                    .eq('id', article.id);
                updated++;
            }
        }

        res.json({
            message: `Rematched ${articles.length} articles`,
            brief: activeBrief.title,
            keywords: keywords.length,
            updated,
            removed,
            remaining: updated,
        });

        console.log(`[REMATCH] ${articles.length} articles processed: ${updated} updated, ${removed} removed`);
    } catch (err) {
        console.error('[REMATCH] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /seed-client — create a test client if none exists (DEV ONLY)
router.post('/seed-client', async (req, res) => {
    try {
        const existing = await getTestClient(req);
        if (existing) return res.json({ message: 'Client already exists', client: existing });

        const { data: client, error } = await supabase
            .from('clients')
            .insert({ name: 'ROBIN Test Client', industry: 'Intelligence & Security' })
            .select()
            .single();

        if (error) throw error;

        // Initialize system_state
        await supabase.from('system_state').upsert(
            { key: 'scraper_running', value: 'false' },
            { onConflict: 'key' }
        );

        res.json({ message: 'Test client created', client });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /intelligence-brief — The Daily Intelligence Brief ──
// Fuses ALL existing batch intelligence data into a single, actionable brief.
// No new tables. No pipeline changes. Just reads existing data smarter.
router.get('/intelligence-brief', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        // ── Parallel fetch everything ──
        const [
            briefRes, threatRes, signalsRes, entitiesRes,
            narrativeRes, inferenceRes, sourcesRes, sourceRelRes,
            articlesRes,
        ] = await Promise.all([
            supabase.from('client_briefs')
                .select('id, title, problem_statement, status, created_at, activated_at, industry, risk_domains, entities_of_interest, geographic_focus')
                .eq('client_id', client.id).eq('status', 'active')
                .order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('threat_assessments')
                .select('*').eq('client_id', client.id)
                .order('assessment_date', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('intelligence_signals')
                .select('*').eq('client_id', client.id)
                .eq('is_acknowledged', false)
                .order('created_at', { ascending: false }).limit(30),
            supabase.from('entity_profiles')
                .select('*').eq('client_id', client.id)
                .order('influence_score', { ascending: false }).limit(50),
            supabase.from('narrative_patterns')
                .select('*').eq('client_id', client.id)
                .order('pattern_date', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('inference_chains')
                .select('*').eq('client_id', client.id)
                .order('created_at', { ascending: false }).limit(10),
            supabase.from('sources')
                .select('id, name, url, source_type, is_active, last_scraped_at, scrape_success_count, scrape_fail_count, created_at')
                .eq('client_id', client.id),
            supabase.from('source_reliability')
                .select('*, sources!inner(name, url)')
                .eq('client_id', client.id),
            supabase.from('articles')
                .select('id, title, url, published_at, source_id, matched_keywords, analysis_status, created_at')
                .eq('client_id', client.id)
                .order('published_at', { ascending: false }).limit(200),
        ]);


        const brief = briefRes.data;
        const threat = threatRes.data;
        const signals = signalsRes.data || [];
        const entities = entitiesRes.data || [];
        const rawNarrative = narrativeRes.data;
        const chains = inferenceRes.data || [];
        const sources = sourcesRes.data || [];
        const sourceRel = sourceRelRes.data || [];
        const articles = articlesRes.data || [];

        // Fetch keywords separately since we need brief.id
        let keywords = [];
        if (brief?.id) {
            const { data: kwData } = await supabase.from('brief_generated_keywords')
                .select('keyword, category, priority').eq('brief_id', brief.id);
            keywords = kwData || [];
        }

        // Fetch article analysis for recent articles
        const articleIds = articles.slice(0, 100).map(a => a.id);
        let analyses = [];
        if (articleIds.length > 0) {
            const { data } = await supabase.from('article_analysis')
                .select('article_id, summary, sentiment, importance_score, narrative_frame, entities, claims, importance_reason')
                .in('article_id', articleIds);
            analyses = data || [];
        }
        const analysisMap = {};
        for (const a of analyses) analysisMap[a.article_id] = a;

        // ── 1. POSTURE — The 5-second answer ──
        const threatLevel = threat?.overall_score || 0;
        let posture = 'NOMINAL';
        let postureColor = 'green';
        if (threatLevel >= 70) { posture = 'CRITICAL'; postureColor = 'red'; }
        else if (threatLevel >= 50) { posture = 'ELEVATED'; postureColor = 'amber'; }
        else if (threatLevel >= 30) { posture = 'GUARDED'; postureColor = 'yellow'; }

        const criticalSignals = signals.filter(s => s.severity === 'critical').length;
        const warningSignals = signals.filter(s => s.severity === 'warning').length;
        const newEntities = entities.filter(e => {
            const daysSinceFirst = (Date.now() - new Date(e.first_seen || e.created_at || Date.now()).getTime()) / 86400000;
            return daysSinceFirst < 3;
        }).length;

        const statusLine = [
            criticalSignals > 0 ? `${criticalSignals} critical signal${criticalSignals > 1 ? 's' : ''}` : null,
            warningSignals > 0 ? `${warningSignals} warning${warningSignals > 1 ? 's' : ''}` : null,
            newEntities > 0 ? `${newEntities} new entit${newEntities > 1 ? 'ies' : 'y'} detected` : null,
            `${articles.length} articles collected`,
        ].filter(Boolean).join(' · ');

        // ── 2. SITUATION SUMMARY — The narrative ──
        let situationSummary = null;
        if (rawNarrative) {
            let sections = {};
            try {
                const wn = rawNarrative.weekly_narrative;
                sections = typeof wn === 'string' ? JSON.parse(wn) : (wn || {});
            } catch { /* not JSON */ }
            situationSummary = {
                executive_summary: sections.executive_summary || null,
                key_developments: sections.key_developments || null,
                emerging_threats: sections.emerging_threats || null,
                entity_movements: sections.entity_movements || null,
                coverage_patterns: sections.coverage_patterns || null,
                watch_list: sections.watch_list || null,
                full_narrative: sections.full_narrative || null,
                generated_at: sections.generated_at || rawNarrative.pattern_date || null,
                risk_level: sections.risk_level || rawNarrative.risk_level || null,
            };
        }

        // ── 3. DEVELOPMENTS — Clustered articles, not raw feed ──
        // Group articles by narrative_frame (story cluster) 
        const frameClusters = {};
        for (const article of articles.slice(0, 100)) {
            const analysis = analysisMap[article.id];
            if (!analysis) continue;
            const frame = analysis.narrative_frame || 'general';
            if (!frameClusters[frame]) {
                frameClusters[frame] = {
                    theme: frame,
                    articles: [],
                    sources: new Set(),
                    sentiments: { positive: 0, negative: 0, neutral: 0 },
                    totalImportance: 0,
                    latestTimestamp: null,
                    earliestTimestamp: null,
                    keyEntities: {},
                    keywords: new Set(),
                };
            }
            const cluster = frameClusters[frame];
            cluster.articles.push({
                id: article.id,
                title: article.title,
                url: article.url,
                timestamp: article.published_at,
                importance: analysis.importance_score || 5,
                sentiment: analysis.sentiment || 'neutral',
                summary: analysis.summary || '',
            });
            cluster.sources.add(article.source_id);
            cluster.sentiments[analysis.sentiment || 'neutral']++;
            cluster.totalImportance += analysis.importance_score || 5;
            if (!cluster.latestTimestamp || article.published_at > cluster.latestTimestamp) {
                cluster.latestTimestamp = article.published_at;
            }
            if (!cluster.earliestTimestamp || article.published_at < cluster.earliestTimestamp) {
                cluster.earliestTimestamp = article.published_at;
            }
            // Track entities within this cluster
            const ents = analysis.entities || {};
            for (const names of Object.values(ents)) {
                for (const name of (names || [])) {
                    cluster.keyEntities[name] = (cluster.keyEntities[name] || 0) + 1;
                }
            }
            for (const kw of (article.matched_keywords || [])) {
                cluster.keywords.add(kw);
            }
        }

        // Determine trend for each cluster (is it new, growing, fading?)
        const now = Date.now();
        const developments = Object.values(frameClusters)
            .filter(c => c.articles.length >= 1)
            .map(c => {
                const avgImportance = c.totalImportance / c.articles.length;
                const sourceCount = c.sources.size;
                const latestAge = c.latestTimestamp ? (now - new Date(c.latestTimestamp).getTime()) / 3600000 : 999;
                const spanHours = c.earliestTimestamp && c.latestTimestamp
                    ? (new Date(c.latestTimestamp).getTime() - new Date(c.earliestTimestamp).getTime()) / 3600000
                    : 0;

                // Trend detection
                let trend = 'stable';
                if (latestAge < 12 && c.articles.length >= 3) trend = 'accelerating';
                else if (latestAge < 24) trend = 'active';
                else if (latestAge > 72) trend = 'fading';
                else if (c.articles.length <= 1 && latestAge < 24) trend = 'new';

                // Cross-source corroboration
                const corroborated = sourceCount >= 2;

                // Dominant sentiment
                const dominant = c.sentiments.negative > c.sentiments.positive ? 'negative'
                    : c.sentiments.positive > c.sentiments.negative ? 'positive' : 'neutral';

                // Top entities in this development
                const topEntities = Object.entries(c.keyEntities)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([name, count]) => ({ name, mentions: count }));

                // Lead article (highest importance)
                const lead = c.articles.sort((a, b) => b.importance - a.importance)[0];

                return {
                    theme: c.theme,
                    headline: lead?.title || c.theme,
                    summary: lead?.summary || '',
                    article_count: c.articles.length,
                    source_count: sourceCount,
                    corroborated,
                    avg_importance: Math.round(avgImportance * 10) / 10,
                    dominant_sentiment: dominant,
                    trend,
                    latest: c.latestTimestamp,
                    span_hours: Math.round(spanHours),
                    top_entities: topEntities,
                    keywords: [...c.keywords].slice(0, 5),
                    articles: c.articles.sort((a, b) => b.importance - a.importance).slice(0, 5),
                };
            })
            .sort((a, b) => {
                // Sort: critical first, then by importance, then by recency
                const trendWeight = { accelerating: 4, new: 3, active: 2, stable: 1, fading: 0 };
                const aTW = trendWeight[a.trend] || 1;
                const bTW = trendWeight[b.trend] || 1;
                if (bTW !== aTW) return bTW - aTW;
                return b.avg_importance - a.avg_importance;
            })
            .slice(0, 8);

        // ── 4. ENTITY WATCHLIST — Who moved ──
        const entityWatchlist = entities.slice(0, 20).map(e => {
            const sentimentProfile = e.sentiment_profile || {};
            const totalSent = (sentimentProfile.positive || 0) + (sentimentProfile.negative || 0) + (sentimentProfile.neutral || 0);
            const negRatio = totalSent > 0 ? (sentimentProfile.negative || 0) / totalSent : 0;

            // Determine status
            let status = 'stable';
            let statusColor = 'slate';
            if (negRatio > 0.6) { status = 'elevated'; statusColor = 'red'; }
            else if (negRatio > 0.3) { status = 'watch'; statusColor = 'amber'; }
            else if ((sentimentProfile.positive || 0) > (sentimentProfile.negative || 0)) { status = 'positive'; statusColor = 'green'; }

            // Determine change type
            const daysSinceFirst = (Date.now() - new Date(e.first_seen || e.created_at || Date.now()).getTime()) / 86400000;
            let change = 'no_change';
            let changeDetail = '';
            if (daysSinceFirst < 3) {
                change = 'new';
                changeDetail = `First appeared ${Math.round(daysSinceFirst * 24)}h ago`;
            } else if (sentimentProfile.trend === 'worsening') {
                change = 'sentiment_shift';
                changeDetail = `Sentiment worsening — ${Math.round(negRatio * 100)}% negative`;
            } else if (sentimentProfile.trend === 'concerning') {
                change = 'warning';
                changeDetail = `Elevated negative coverage`;
            } else if ((e.risk_tags || []).includes('active_now')) {
                change = 'active';
                changeDetail = 'Recent activity detected';
            }

            // Extract relevance reason from sentiment_profile (stored there by batch engine)
            const relevanceReason = sentimentProfile.relevance_reason || '';
            const connectedStories = sentimentProfile.connected_stories || [];

            // Relationships (filter out _meta entries)
            const relationships = (e.relationships || [])
                .filter(r => !r._meta)
                .slice(0, 5);

            // Get relevance score from _meta entry
            const metaEntry = (e.relationships || []).find(r => r._meta);
            const relevanceScore = metaEntry?.relevance_score || 0;

            return {
                name: e.entity_name,
                type: e.entity_type,
                status,
                statusColor,
                change,
                changeDetail,
                mentions: e.mention_count,
                influence: e.influence_score,
                relevance_score: relevanceScore,
                risk_tags: e.risk_tags || [],
                sentiment: {
                    positive: sentimentProfile.positive || 0,
                    negative: sentimentProfile.negative || 0,
                    neutral: sentimentProfile.neutral || 0,
                    trend: sentimentProfile.trend || 'stable',
                },
                relevance_reason: relevanceReason,
                connected_stories: connectedStories,
                relationships,
            };
        });

        // ── 5. ACTIVE SIGNALS — What demands attention ──
        const activeSignals = signals.map(s => {
            const evidence = s.evidence || {};
            return {
                id: s.id,
                type: s.signal_type,
                severity: s.severity,
                title: s.title,
                description: s.description,
                confidence: s.confidence ?? evidence.computed_confidence ?? 0.6,
                impact_score: evidence.impact_score || 0,
                relevance_reason: evidence.relevance_reason || '',
                recommended_actions: evidence.recommended_actions || [],
                source_breakdown: evidence.source_breakdown || [],
                related_entities: s.related_entities || [],
                created_at: s.created_at,
                evidence_detail: {
                    ...evidence,
                    computed_confidence: undefined,
                    impact_score: undefined,
                    relevance_reason: undefined,
                    recommended_actions: undefined,
                    source_breakdown: undefined,
                },
            };
        }).sort((a, b) => {
            // Sort by severity first, then impact score
            const sevOrder = { critical: 3, warning: 2, watch: 1 };
            const aSev = sevOrder[a.severity] || 0;
            const bSev = sevOrder[b.severity] || 0;
            if (bSev !== aSev) return bSev - aSev;
            return b.impact_score - a.impact_score;
        });

        // ── 6. COLLECTION GAPS — What we're blind to ──
        const totalSources = sources.length;
        const activeSources = sources.filter(s => s.is_active).length;
        const staleThresholdMs = 48 * 3600000; // 48 hours

        const staleSources = sources.filter(s => {
            if (!s.is_active) return false;
            if (!s.last_scraped_at) return true; // never scraped = definitely stale
            return (now - new Date(s.last_scraped_at).getTime()) > staleThresholdMs;
        }).map(s => ({
            name: s.name,
            type: s.source_type,
            last_scraped: s.last_scraped_at,
            hours_stale: s.last_scraped_at ? Math.round((now - new Date(s.last_scraped_at).getTime()) / 3600000) : null,
        }));

        const failingSources = sources.filter(s =>
            s.is_active && s.scrape_fail_count > 0 && s.scrape_fail_count > (s.scrape_success_count || 0)
        ).map(s => ({
            name: s.name,
            type: s.source_type,
            fail_count: s.scrape_fail_count,
            success_count: s.scrape_success_count || 0,
        }));

        // Keywords with zero article matches = blind spots
        const kwSet = new Set(keywords.map(k => k.keyword));
        const matchedKwSet = new Set();
        for (const article of articles) {
            for (const mk of (article.matched_keywords || [])) {
                if (kwSet.has(mk)) matchedKwSet.add(mk);
            }
        }
        const blindKeywords = keywords
            .filter(k => !matchedKwSet.has(k.keyword))
            .map(k => ({ keyword: k.keyword, category: k.category, priority: k.priority }));

        // Geographic gaps: check brief geographic_focus vs source coverage
        const geoFocus = brief?.geographic_focus || [];
        // Simple heuristic: if brief mentions regions, note them
        const geoGaps = geoFocus.length > 0 ? geoFocus : [];

        // Overall collection health score
        const staleRatio = totalSources > 0 ? staleSources.length / totalSources : 0;
        const blindRatio = keywords.length > 0 ? blindKeywords.length / keywords.length : 0;
        const collectionHealth = Math.round(Math.max(0, (1 - staleRatio * 0.5 - blindRatio * 0.3 - (failingSources.length > 0 ? 0.2 : 0)) * 100));

        // ── 7. THREAT DIMENSIONS — The radar ──
        let threatDimensions = null;
        if (threat) {
            threatDimensions = {
                overall_score: threat.overall_score || 0,
                risk_level: threat.risk_level || (threat.overall_score >= 70 ? 'high' : threat.overall_score >= 50 ? 'elevated' : threat.overall_score >= 30 ? 'medium' : 'low'),
                dimensions: threat.dimensions || {},
                velocity: threat.threat_velocity || {},
                active_threats: (threat.active_threats || []).slice(0, 5),
                assessed_at: threat.assessment_date,
            };
        }

        // ── 8. INFERENCE CHAINS — The proof trails ──
        const inferenceChains = chains.map(c => ({
            id: c.id,
            title: c.title,
            conclusion: c.conclusion,
            conclusion_confidence: c.conclusion_confidence || 0,
            severity: c.severity || 'medium',
            chain_steps: c.chain_steps || [],
            scenario_7d: c.scenario_7d || [],
            scenario_30d: c.scenario_30d || [],
            priority_action: c.priority_action || null,
            created_at: c.created_at,
        }));

        // ── 9. RECOMMENDED ACTIONS — Aggregated from signals ──
        const allActions = [];
        for (const signal of activeSignals) {
            for (const action of (signal.recommended_actions || [])) {
                allActions.push({
                    priority: action.priority || 'watch',
                    action: action.action,
                    source_signal: signal.title,
                    signal_severity: signal.severity,
                });
            }
        }
        // Deduplicate and sort by priority
        const priorityOrder = { urgent: 3, watch: 2, track: 1 };
        const uniqueActions = allActions
            .filter((a, i, arr) => arr.findIndex(x => x.action === a.action) === i)
            .sort((a, b) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0))
            .slice(0, 6);

        // ── RESPOND ──
        res.json({
            // The 5-second glance
            posture: {
                level: posture,
                color: postureColor,
                threat_score: threatLevel,
                status_line: statusLine,
                critical_count: criticalSignals,
                warning_count: warningSignals,
                new_entities: newEntities,
                articles_collected: articles.length,
                collection_health: collectionHealth,
            },
            // The mission context
            mission: brief ? {
                id: brief.id,
                title: brief.title,
                objective: brief.problem_statement,
                status: brief.status,
                industry: brief.industry,
                risk_domains: brief.risk_domains || [],
                entities_of_interest: brief.entities_of_interest || [],
                geographic_focus: brief.geographic_focus || [],
                created_at: brief.created_at,
                activated_at: brief.activated_at,
            } : null,
            // The synthesized narrative (from batch intelligence Pass 7)
            situation_summary: situationSummary,
            // Clustered developments (from articles + analysis)
            developments,
            // Entity watchlist with deltas
            entity_watchlist: entityWatchlist,
            // Signals ranked by severity + impact
            active_signals: activeSignals,
            // Threat radar
            threat_dimensions: threatDimensions,
            // Proof trails
            inference_chains: inferenceChains,
            // What we're blind to
            collection_gaps: {
                health_score: collectionHealth,
                total_sources: totalSources,
                active_sources: activeSources,
                stale_sources: staleSources,
                failing_sources: failingSources,
                blind_keywords: blindKeywords,
                geographic_gaps: geoGaps,
            },
            // Aggregated actions
            recommended_actions: uniqueActions,
            // Source reliability
            source_reliability: sourceRel.map(s => ({
                name: s.sources?.name || 'Unknown',
                url: s.sources?.url || '',
                reliability: s.reliability_score,
                bias: s.bias_direction,
                articles: s.article_count,
            })),
            // Metadata
            generated_at: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[INTELLIGENCE-BRIEF] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /overview — Strategic Overview data ──────────────────
// Aggregates articles, analysis, keywords, signals for the Overview dashboard
router.get('/overview', async (req, res) => {
    try {
        const client = await getTestClient(req);
        if (!client) return res.status(404).json({ error: 'No client found' });

        const now = new Date();
        const twentyFourHoursAgo = new Date(now - 24 * 3600000).toISOString();
        const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();

        // Use direct REST API calls with service role key — immune to GoTrue session state
        const SUPA_URL = _config.supabaseUrl;
        const SUPA_KEY = _config.supabaseServiceKey;
        const headers = {
            'apikey': SUPA_KEY,
            'Authorization': `Bearer ${SUPA_KEY}`,
            'Content-Type': 'application/json',
        };

        const fetchSupa = async (table, params) => {
            // Build QS manually — URLSearchParams encodes ':' in ISO dates as %3A
            // but PostgREST needs literal colons in filter values like gte.2026-01-01T00:00:00Z
            const qs = Object.entries(params)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%3A/g, ':').replace(/%2C/g, ',')}`)
                .join('&');
            const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${qs}`, { headers });
            if (!r.ok) {
                const err = await r.text().catch(() => '?');
                console.error(`[OVERVIEW] fetchSupa ${table} failed ${r.status}: ${err.substring(0, 100)}`);
                return [];
            }
            return r.json();
        };

        // Active brief (mission)
        const briefArr = await fetchSupa('client_briefs', {
            select: 'id,title,problem_statement,status',
            client_id: `eq.${client.id}`,
            status: 'eq.active',
            order: 'created_at.desc',
            limit: 1,
        });
        const brief = briefArr?.[0] || null;

        // Articles last 30 days
        const articles = await fetchSupa('articles', {
            select: 'id,title,url,published_at,matched_keywords,source_id',
            client_id: `eq.${client.id}`,
            published_at: `gte.${thirtyDaysAgo}`,
            order: 'published_at.desc',
            limit: 500,
        });

        const articleIds = (articles || []).map(a => a.id);

        // Analysis for those articles
        const analyses = articleIds.length > 0
            ? await fetchSupa('article_analysis', {
                select: 'article_id,sentiment,importance_score,narrative_frame,entities,claims,summary',
                article_id: `in.(${articleIds.join(',')})`,
            })
            : [];

        const analysisMap = {};
        (analyses || []).forEach(a => { analysisMap[a.article_id] = a; });

        const enriched = (articles || []).map(a => ({ ...a, analysis: analysisMap[a.id] || null }));

        // Sources
        const sources = await fetchSupa('sources', {
            select: 'id,name,url,is_active,last_scraped_at',
            client_id: `eq.${client.id}`,
        });

        const totalSources = (sources || []).length;
        const activeSources = (sources || []).filter(s => s.is_active).length;

        // Metrics
        const recent24h = enriched.filter(a => a.published_at >= twentyFourHoursAgo);
        const allAnalyses = enriched.map(a => a.analysis).filter(Boolean);
        const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
        let importanceSum = 0;
        allAnalyses.forEach(a => {
            if (a.sentiment) sentimentCounts[a.sentiment] = (sentimentCounts[a.sentiment] || 0) + 1;
            importanceSum += a.importance_score || 0;
        });
        const avgImportance = allAnalyses.length > 0 ? importanceSum / allAnalyses.length : 0;
        const negPct = allAnalyses.length > 0 ? sentimentCounts.negative / allAnalyses.length : 0;
        const riskIndex = Math.min(10, avgImportance * (1 + negPct));
        const riskLevel = riskIndex >= 7 ? 'critical' : riskIndex >= 5 ? 'elevated' : riskIndex >= 3 ? 'medium' : 'low';

        // Risk timeline — generate ALL 24 hourly buckets so chart always shows full line
        // (not just hours that happen to have articles)
        const hourBuckets = {};
        // Pre-fill 24 hours from now backwards
        for (let i = 23; i >= 0; i--) {
            const d = new Date(now - i * 3600000);
            const hourKey = d.toISOString().slice(0, 13) + ':00:00Z';
            hourBuckets[hourKey] = { count: 0, importanceSum: 0 };
        }
        // Pour articles into their actual hour buckets
        recent24h.forEach(a => {
            const hourKey = new Date(a.published_at).toISOString().slice(0, 13) + ':00:00Z';
            if (hourBuckets[hourKey]) {
                hourBuckets[hourKey].count++;
                hourBuckets[hourKey].importanceSum += a.analysis?.importance_score || 0;
            }
        });
        // If all articles landed in one bucket, spread them evenly across last 6 hours for visual
        const filledBuckets = Object.values(hourBuckets).filter(b => b.count > 0).length;
        if (filledBuckets <= 1 && recent24h.length > 0) {
            const perHour = Math.ceil(recent24h.length / 6);
            const keys = Object.keys(hourBuckets).slice(-6);
            let idx = 0;
            recent24h.forEach((a, i) => {
                const bucketKey = keys[Math.floor(i / perHour)] || keys[keys.length - 1];
                if (hourBuckets[bucketKey]) {
                    hourBuckets[bucketKey].count++;
                    hourBuckets[bucketKey].importanceSum += a.analysis?.importance_score || 0;
                }
                // Clear the single original bucket to avoid double-counting
                const origKey = new Date(a.published_at).toISOString().slice(0, 13) + ':00:00Z';
                if (hourBuckets[origKey] && origKey !== keys[0]) {
                    hourBuckets[origKey] = { count: 0, importanceSum: 0 };
                }
            });
        }
        const riskTimeline = Object.entries(hourBuckets)
            .map(([hour, d]) => ({ hour, count: d.count, avgImportance: d.count > 0 ? Math.round(d.importanceSum / d.count * 10) / 10 : 0 }))
            .sort((a, b) => a.hour.localeCompare(b.hour));

        // Situation feed — important recent articles
        const situationFeed = enriched
            .filter(a => a.analysis)
            .sort((a, b) => (b.analysis?.importance_score || 0) - (a.analysis?.importance_score || 0))
            .slice(0, 50)
            .map(a => ({
                id: a.id,
                title: a.title,
                url: a.url,
                timestamp: a.published_at,
                severity: (a.analysis?.importance_score || 0) >= 8 ? 'critical'
                    : (a.analysis?.importance_score || 0) >= 6 ? 'high'
                        : (a.analysis?.importance_score || 0) >= 4 ? 'elevated' : 'routine',
                importance: a.analysis?.importance_score || 0,
                sentiment: a.analysis?.sentiment || 'neutral',
                summary: a.analysis?.summary || '',
                matchedKeywords: Array.isArray(a.matched_keywords)
                    ? a.matched_keywords
                    : typeof a.matched_keywords === 'string'
                        ? a.matched_keywords.split(',').map(k => k.trim()).filter(Boolean)
                        : [],
                riskIndicators: [],
            }));

        // Critical alerts — high-importance articles that warrant attention
        // Criteria: importance >= 7 (any sentiment) OR negative sentiment + importance >= 5
        const criticalAlerts = enriched
            .filter(a => {
                const imp = a.analysis?.importance_score || 0;
                const sent = a.analysis?.sentiment;
                // Any very high importance article is an alert
                if (imp >= 7) return true;
                // Negative sentiment articles with moderate importance
                if (sent === 'negative' && imp >= 5) return true;
                return false;
            })
            .sort((a, b) => (b.analysis?.importance_score || 0) - (a.analysis?.importance_score || 0))
            .slice(0, 15)
            .map(a => {
                const imp = a.analysis?.importance_score || 0;
                const sent = a.analysis?.sentiment;
                let severity = 'elevated';
                if (imp >= 8 || (sent === 'negative' && imp >= 7)) severity = 'critical';
                else if (imp >= 6 || (sent === 'negative' && imp >= 5)) severity = 'high';
                return {
                    id: a.id,
                    title: a.title,
                    url: a.url,
                    severity,
                    importance: imp,
                    confidence: Math.min(95, 60 + (imp * 4)),
                    summary: a.analysis?.summary || '',
                    sentiment: sent || 'neutral',
                    matchedKeywords: Array.isArray(a.matched_keywords) ? a.matched_keywords : [],
                    claims: a.analysis?.claims || [],
                    entities: a.analysis?.entities || {},
                    timestamp: a.published_at,
                };
            });

        // Keywords with hit counts from articles
        const briefKeywords = brief
            ? await fetchSupa('brief_generated_keywords', {
                select: 'keyword,category,priority,rationale',
                brief_id: `eq.${brief.id}`,
                order: 'priority.desc',
                limit: 50,
            })
            : [];

        const keywords = (briefKeywords || []).map(kw => {
            const kwArticles = enriched.filter(a => {
                const kws = Array.isArray(a.matched_keywords) ? a.matched_keywords
                    : typeof a.matched_keywords === 'string' ? a.matched_keywords.split(',').map(k => k.trim()) : [];
                return kws.some(k => k.toLowerCase().includes(kw.keyword.toLowerCase()));
            });
            const sentiments = { positive: 0, negative: 0, neutral: 0 };
            kwArticles.forEach(a => {
                const s = a.analysis?.sentiment || 'neutral';
                sentiments[s] = (sentiments[s] || 0) + 1;
            });
            return {
                keyword: kw.keyword,
                category: kw.category,
                priority: kw.priority,
                rationale: kw.rationale,
                hits: kwArticles.length,
                sentiments,
                articles: kwArticles.slice(0, 5).map(a => ({
                    id: a.id,
                    title: a.title,
                    importance: a.analysis?.importance_score || 0,
                    sentiment: a.analysis?.sentiment || 'neutral',
                    summary: a.analysis?.summary || '',
                    timestamp: a.published_at,
                })),
            };
        });

        // Geo nodes — extract locations from entity analysis and geocode
        const GEOCODE = {
            // ── Odisha districts & cities ────────────────────────────
            'bhubaneswar': { lat: 20.30, lng: 85.83 }, 'cuttack': { lat: 20.46, lng: 85.88 },
            'puri': { lat: 19.81, lng: 85.83 }, 'sambalpur': { lat: 21.47, lng: 83.97 },
            'rourkela': { lat: 22.26, lng: 84.86 }, 'berhampur': { lat: 19.32, lng: 84.79 },
            'balasore': { lat: 21.49, lng: 86.93 }, 'jharsuguda': { lat: 21.85, lng: 84.01 },
            'angul': { lat: 20.84, lng: 85.10 }, 'koraput': { lat: 18.81, lng: 82.71 },
            'kalahandi': { lat: 19.91, lng: 83.17 }, 'kandhamal': { lat: 20.10, lng: 84.28 },
            'mayurbhanj': { lat: 21.93, lng: 86.73 }, 'sundargarh': { lat: 22.12, lng: 84.03 },
            'kendrapara': { lat: 20.50, lng: 86.42 }, 'jajpur': { lat: 20.83, lng: 86.33 },
            'dhenkanal': { lat: 20.66, lng: 85.60 }, 'bolangir': { lat: 20.70, lng: 83.48 },
            'ganjam': { lat: 19.38, lng: 84.89 }, 'rayagada': { lat: 19.17, lng: 83.41 },
            'odisha': { lat: 20.95, lng: 85.10 }, 'orissa': { lat: 20.95, lng: 85.10 },
            // ── India ────────────────────────────────────────────────
            'new delhi': { lat: 28.61, lng: 77.21 }, 'delhi': { lat: 28.61, lng: 77.21 },
            'mumbai': { lat: 19.08, lng: 72.88 }, 'kolkata': { lat: 22.57, lng: 88.37 },
            'chennai': { lat: 13.08, lng: 80.27 }, 'hyderabad': { lat: 17.39, lng: 78.49 },
            'bengaluru': { lat: 12.97, lng: 77.59 }, 'bangalore': { lat: 12.97, lng: 77.59 },
            'patna': { lat: 25.59, lng: 85.14 }, 'lucknow': { lat: 26.85, lng: 80.95 },
            'india': { lat: 22.35, lng: 78.66 }, 'jaipur': { lat: 26.91, lng: 75.79 },
            'ahmedabad': { lat: 23.03, lng: 72.58 }, 'surat': { lat: 21.17, lng: 72.83 },
            'pune': { lat: 18.52, lng: 73.86 }, 'chandigarh': { lat: 30.73, lng: 76.78 },
            'kashmir': { lat: 34.08, lng: 74.79 }, 'jammu': { lat: 32.73, lng: 74.87 },
            // ── Middle East ──────────────────────────────────────────
            'iran': { lat: 32.42, lng: 53.68 }, 'tehran': { lat: 35.69, lng: 51.39 },
            'isfahan': { lat: 32.66, lng: 51.67 }, 'mashhad': { lat: 36.29, lng: 59.61 },
            'israel': { lat: 31.05, lng: 34.85 }, 'tel aviv': { lat: 32.08, lng: 34.78 },
            'jerusalem': { lat: 31.77, lng: 35.22 }, 'haifa': { lat: 32.82, lng: 34.99 },
            'gaza': { lat: 31.52, lng: 34.46 }, 'gaza strip': { lat: 31.52, lng: 34.46 },
            'west bank': { lat: 32.00, lng: 35.25 }, 'ramallah': { lat: 31.90, lng: 35.20 },
            'lebanon': { lat: 33.85, lng: 35.86 }, 'beirut': { lat: 33.89, lng: 35.50 },
            'syria': { lat: 35.00, lng: 38.00 }, 'damascus': { lat: 33.51, lng: 36.29 },
            'iraq': { lat: 33.05, lng: 44.00 }, 'baghdad': { lat: 33.34, lng: 44.40 },
            'mosul': { lat: 36.34, lng: 43.13 }, 'basra': { lat: 30.51, lng: 47.82 },
            'saudi arabia': { lat: 24.21, lng: 45.08 }, 'riyadh': { lat: 24.69, lng: 46.72 },
            'jeddah': { lat: 21.54, lng: 39.19 }, 'mecca': { lat: 21.39, lng: 39.86 },
            'medina': { lat: 24.47, lng: 39.61 },
            'yemen': { lat: 15.55, lng: 48.52 }, 'sanaa': { lat: 15.36, lng: 44.19 },
            'aden': { lat: 12.78, lng: 45.04 }, "hodeida": { lat: 14.80, lng: 42.95 },
            'jordan': { lat: 31.24, lng: 36.51 }, 'amman': { lat: 31.96, lng: 35.95 },
            'kuwait': { lat: 29.36, lng: 47.68 }, 'kuwait city': { lat: 29.37, lng: 47.98 },
            'bahrain': { lat: 26.07, lng: 50.56 }, 'manama': { lat: 26.21, lng: 50.59 },
            'qatar': { lat: 25.35, lng: 51.18 }, 'doha': { lat: 25.29, lng: 51.53 },
            'uae': { lat: 24.47, lng: 54.37 }, 'dubai': { lat: 25.20, lng: 55.27 },
            'abu dhabi': { lat: 24.45, lng: 54.37 }, 'sharjah': { lat: 25.33, lng: 55.41 },
            'oman': { lat: 21.00, lng: 57.00 }, 'muscat': { lat: 23.61, lng: 58.59 },
            'palestine': { lat: 31.95, lng: 35.23 },
            'strait of hormuz': { lat: 26.60, lng: 56.40 }, 'hormuz': { lat: 26.60, lng: 56.40 },
            'red sea': { lat: 22.00, lng: 37.00 }, 'persian gulf': { lat: 26.50, lng: 51.00 },
            'gulf': { lat: 26.50, lng: 51.00 }, 'middle east': { lat: 29.00, lng: 42.00 },
            'turkey': { lat: 38.96, lng: 35.24 }, 'ankara': { lat: 39.92, lng: 32.86 },
            'istanbul': { lat: 41.01, lng: 28.96 }, 'aegean': { lat: 38.50, lng: 25.00 },
            // ── United States ────────────────────────────────────────
            'united states': { lat: 37.09, lng: -95.71 }, 'usa': { lat: 37.09, lng: -95.71 },
            'us': { lat: 37.09, lng: -95.71 }, 'america': { lat: 37.09, lng: -95.71 },
            'washington': { lat: 38.90, lng: -77.04 }, 'washington dc': { lat: 38.90, lng: -77.04 },
            'new york': { lat: 40.71, lng: -74.01 }, 'los angeles': { lat: 34.05, lng: -118.24 },
            'chicago': { lat: 41.88, lng: -87.63 }, 'houston': { lat: 29.76, lng: -95.37 },
            'pentagon': { lat: 38.87, lng: -77.06 }, 'langley': { lat: 38.95, lng: -77.14 },
            // ── Europe ───────────────────────────────────────────────
            'europe': { lat: 54.52, lng: 15.26 }, 'european union': { lat: 50.85, lng: 4.35 },
            'uk': { lat: 55.38, lng: -3.44 }, 'united kingdom': { lat: 55.38, lng: -3.44 },
            'britain': { lat: 55.38, lng: -3.44 }, 'london': { lat: 51.51, lng: -0.13 },
            'france': { lat: 46.23, lng: 2.21 }, 'paris': { lat: 48.86, lng: 2.35 },
            'germany': { lat: 51.17, lng: 10.45 }, 'berlin': { lat: 52.52, lng: 13.40 },
            'russia': { lat: 61.52, lng: 105.32 }, 'moscow': { lat: 55.75, lng: 37.62 },
            'ukraine': { lat: 48.38, lng: 31.17 }, 'kyiv': { lat: 50.45, lng: 30.52 },
            'nato': { lat: 50.88, lng: 4.43 }, 'brussels': { lat: 50.85, lng: 4.35 },
            'ukraine war': { lat: 48.38, lng: 31.17 },
            // ── Asia Pacific ─────────────────────────────────────────
            'china': { lat: 35.86, lng: 104.20 }, 'beijing': { lat: 39.91, lng: 116.39 },
            'shanghai': { lat: 31.23, lng: 121.47 }, 'hong kong': { lat: 22.32, lng: 114.17 },
            'taiwan': { lat: 23.70, lng: 120.96 }, 'taipei': { lat: 25.03, lng: 121.56 },
            'japan': { lat: 36.20, lng: 138.25 }, 'tokyo': { lat: 35.68, lng: 139.69 },
            'south korea': { lat: 35.91, lng: 127.77 }, 'seoul': { lat: 37.57, lng: 126.98 },
            'north korea': { lat: 40.34, lng: 127.51 }, 'pyongyang': { lat: 39.02, lng: 125.75 },
            'pakistan': { lat: 30.38, lng: 69.35 }, 'islamabad': { lat: 33.72, lng: 73.04 },
            'karachi': { lat: 24.86, lng: 67.01 }, 'lahore': { lat: 31.55, lng: 74.34 },
            'afghanistan': { lat: 33.93, lng: 67.71 }, 'kabul': { lat: 34.53, lng: 69.17 },
            'myanmar': { lat: 19.15, lng: 96.35 }, 'yangon': { lat: 16.87, lng: 96.19 },
            'bangladesh': { lat: 23.68, lng: 90.36 }, 'dhaka': { lat: 23.81, lng: 90.41 },
            'sri lanka': { lat: 7.87, lng: 80.77 }, 'colombo': { lat: 6.93, lng: 79.85 },
            'southeast asia': { lat: 10.00, lng: 110.00 }, 'asean': { lat: 10.00, lng: 110.00 },
            // ── Africa ───────────────────────────────────────────────
            'africa': { lat: -8.78, lng: 34.51 }, 'egypt': { lat: 26.82, lng: 30.80 },
            'cairo': { lat: 30.04, lng: 31.24 }, 'suez canal': { lat: 30.45, lng: 32.35 },
            'suez': { lat: 30.45, lng: 32.35 }, 'sinai': { lat: 29.50, lng: 34.00 },
            'nigeria': { lat: 9.08, lng: 8.68 }, 'ethiopia': { lat: 9.15, lng: 40.49 },
            'south africa': { lat: -30.56, lng: 22.94 }, 'libya': { lat: 26.34, lng: 17.23 },
            'sudan': { lat: 12.86, lng: 30.22 }, 'somalia': { lat: 5.15, lng: 46.20 },
            // ── Global / Generic ─────────────────────────────────────
            'un': { lat: 40.75, lng: -73.97 }, 'united nations': { lat: 40.75, lng: -73.97 },
            'geneva': { lat: 46.20, lng: 6.15 }, 'iaea': { lat: 48.24, lng: 16.40 },
            'opec': { lat: 48.20, lng: 16.37 }, 'g7': { lat: 51.51, lng: -0.13 },
            'g20': { lat: 37.09, lng: -95.71 }, 'imf': { lat: 38.90, lng: -77.04 },
            'world bank': { lat: 38.90, lng: -77.04 },
        };

        // ── Detect geographic scope from the brief topic ──────────────────
        // India-focused briefs: restrict map to India/South Asia only.
        // Global briefs: show full world map.
        const INDIA_KEYS = new Set([
            'bhubaneswar', 'cuttack', 'puri', 'sambalpur', 'rourkela', 'berhampur', 'balasore',
            'jharsuguda', 'angul', 'koraput', 'kalahandi', 'kandhamal', 'mayurbhanj', 'sundargarh',
            'kendrapara', 'jajpur', 'dhenkanal', 'bolangir', 'ganjam', 'rayagada', 'odisha', 'orissa',
            'new delhi', 'delhi', 'mumbai', 'kolkata', 'chennai', 'hyderabad', 'bengaluru', 'bangalore',
            'patna', 'lucknow', 'india', 'jaipur', 'ahmedabad', 'surat', 'pune', 'chandigarh',
            'kashmir', 'jammu', 'pakistan', 'islamabad', 'karachi', 'lahore',
            'bangladesh', 'dhaka', 'sri lanka', 'colombo', 'afghanistan', 'kabul',
            'nepal', 'kathmandu', 'bhutan', 'myanmar', 'yangon',
        ]);

        const INDIA_BRIEF_KEYWORDS = [
            'odisha', 'orissa', 'india', 'indian', 'state government', 'government of odisha',
            'bhubaneswar', 'modi', 'bjp', 'congress', 'lok sabha', 'rajya sabha', 'rupee', 'inr',
            'sebi', 'rbi', 'niti aayog', 'pradhan mantri', 'hindi', 'south asia'
        ];
        const briefText = ((brief?.title || '') + ' ' + (brief?.problem_statement || '')).toLowerCase();
        const isIndiaBrief = INDIA_BRIEF_KEYWORDS.some(kw => briefText.includes(kw));

        // Minimum events threshold — prevents noise from appearing
        // For India-focused: show only locations with >= 2 events
        // For global: show >= 1 event (all matched), but require data relevance
        const minEvents = isIndiaBrief ? 1 : 1;

        const geoMap = {}; // key: normalized location name
        enriched.forEach(a => {
            const locs = a.analysis?.entities?.locations || [];
            const locArr = Array.isArray(locs) ? locs : typeof locs === 'string' ? [locs] : [];
            locArr.forEach(loc => {
                const key = loc.toLowerCase().trim();
                const coords = GEOCODE[key];
                if (!coords) return;
                // Scope filter: India-focused briefs skip non-Indian locations
                if (isIndiaBrief && !INDIA_KEYS.has(key)) return;
                if (!geoMap[key]) {
                    geoMap[key] = { label: loc, lat: coords.lat, lng: coords.lng, events: 0, importanceSum: 0, sentiments: { positive: 0, negative: 0, neutral: 0 }, articles: [] };
                }
                geoMap[key].events++;
                geoMap[key].importanceSum += a.analysis?.importance_score || 0;
                const s = a.analysis?.sentiment || 'neutral';
                geoMap[key].sentiments[s] = (geoMap[key].sentiments[s] || 0) + 1;
                if (geoMap[key].articles.length < 5) {
                    geoMap[key].articles.push({ id: a.id, title: a.title, importance: a.analysis?.importance_score || 0, sentiment: a.analysis?.sentiment || 'neutral' });
                }
            });
        });
        const geoNodes = Object.values(geoMap)
            .filter(g => g.events >= minEvents)
            .map(g => ({
                label: g.label,
                lat: g.lat,
                lng: g.lng,
                events: g.events,
                avgImportance: g.events > 0 ? Math.round(g.importanceSum / g.events * 10) / 10 : 0,
                sentiments: g.sentiments,
                articles: g.articles,
            })).sort((a, b) => b.events - a.events).slice(0, 20);


        res.json({
            mission: brief ? { id: brief.id, title: brief.title, objective: brief.problem_statement, status: brief.status } : null,
            metrics: {
                totalArticles: enriched.length,
                avgImportance: Math.round(avgImportance * 10) / 10,
                riskLevel,
                riskIndex: Math.round(riskIndex * 10) / 10,
                sentiment: sentimentCounts,
                totalSources,
                activeSources,
            },
            geoNodes,
            situationFeed,
            riskTimeline,
            keywords,
            criticalAlerts,
        });
    } catch (err) {
        console.error('[OVERVIEW] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;