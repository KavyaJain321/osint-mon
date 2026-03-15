import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

// Load platform screenshots as base64
function loadScreenshot(name) {
  const filePath = path.join(projectRoot, name);
  try {
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    console.warn(`Screenshot not found: ${filePath}`);
    return null;
  }
}

const platformScreenshots = {
  overview: loadScreenshot('platform_overview.png'),
  intelligence: loadScreenshot('platform_intelligence.png'),
  reports: loadScreenshot('platform_reports.png'),
  activity: loadScreenshot('platform_activity.png'),
  sources: loadScreenshot('platform_sources.png'),
  entities: loadScreenshot('platform_entities.png'),
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── STRICT Odisha relevance filter ─────────────────
const ODISHA_KEYWORDS = [
  'odisha', 'odia', 'orissa', 'bhubaneswar', 'cuttack', 'puri', 'rourkela',
  'sambalpur', 'berhampur', 'balasore', 'jharsuguda', 'angul', 'kalahandi',
  'koraput', 'mayurbhanj', 'sundargarh', 'kendrapara', 'jajpur', 'ganjam',
  'naveen patnaik', 'mohan majhi', 'bjd', 'biju janata', 'odishatv',
  'dharitri', 'sambad', 'pragativadi', 'utkal', 'kalinga', 'jagannath',
  'konark', 'chilika', 'hirakud', 'mahanadi', 'brahmani', 'tata steel',
  'jspl', 'nalco', 'iocl paradip', 'dhamra', 'paradip', 'gopalpur',
  'idco', 'ipicol', 'orissa post', 'odisha govt', 'cm odisha',
  'ଓଡ଼ିଶା', 'ଓଡ଼ିଆ', 'ଭୁବନେଶ୍ୱର',
];

function isOdishaRelevant(article) {
  const text = `${article.title || ''} ${article.summary || ''} ${(article.matched_keywords || []).join(' ')}`.toLowerCase();
  return ODISHA_KEYWORDS.some(kw => text.includes(kw));
}

// ── Source classification ──────────────────────────
const TV_SOURCES = [
  'odishatv', 'ndtv', 'timesnow', 'republic', 'aajtak', 'abp',
  'zee', 'india today', 'wion', 'dd news', 'kalinga tv', 'news18',
  'cnbc', 'bbc', 'cnn', 'al jazeera', 'youtube', 'argus news', 'ap news'
];
const NEWSPAPER_SOURCES = [
  'utkal samachar', 'dharitri', 'sambad', 'pragativadi', 'samaja',
  'times of india', 'hindustan times', 'the hindu', 'indian express',
  'telegraph', 'economic times', 'business standard', 'livemint',
  'financial express', 'deccan', 'pioneer', 'statesman', 'tribune',
  'orissa post', 'odisha bhaskar', 'daily', 'gazette', 'guardian',
];

function classifySource(source, url) {
  const s = (source || '').toLowerCase();
  const u = (url || '').toLowerCase();
  for (const tv of TV_SOURCES) {
    if (s.includes(tv) || u.includes(tv.replace(/ /g, ''))) return 'TV Intelligence';
  }
  for (const np of NEWSPAPER_SOURCES) {
    if (s.includes(np) || u.includes(np.replace(/ /g, ''))) return 'Newspapers';
  }
  return 'Online News';
}

// ── Fetch og:image from a URL ─────────────────────
async function fetchOgImage(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    // Try og:image first
    let match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (!match) match = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    // Try twitter:image
    if (!match) match = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (!match) match = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (match?.[1]) {
      let imgUrl = match[1];
      if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
      if (imgUrl.startsWith('/')) {
        const base = new URL(url);
        imgUrl = base.origin + imgUrl;
      }
      return imgUrl;
    }
  } catch { /* timeout or network error */ }
  return null;
}

// ── Sentiment helpers ─────────────────────────────
function sentimentStyle(s) {
  if (s === 'positive') return { bg: '#dcfce7', color: '#166534', border: '#86efac', label: '● POSITIVE' };
  if (s === 'negative') return { bg: '#fef2f2', color: '#991b1b', border: '#fca5a5', label: '● NEGATIVE' };
  return { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', label: '● NEUTRAL' };
}

// ── SVG placeholder (fallback only) ───────────────
function placeholderSvg(sourceName, mediaType) {
  const colors = {
    'TV Intelligence': { bg: '#ede9fe', icon: '#7c3aed', text: '#6d28d9' },
    'Online News': { bg: '#e0f7f5', icon: '#0d9488', text: '#0f766e' },
    'Newspapers': { bg: '#fff7ed', icon: '#ea580c', text: '#c2410c' },
  };
  const c = colors[mediaType] || colors['Online News'];
  const icons = {
    'TV Intelligence': '<rect x="8" y="12" width="24" height="16" rx="2" fill="' + c.icon + '" opacity="0.8"/><polygon points="18,16 18,24 25,20" fill="white"/>',
    'Online News': '<circle cx="20" cy="20" r="10" fill="none" stroke="' + c.icon + '" stroke-width="1.5" opacity="0.8"/><ellipse cx="20" cy="20" rx="4" ry="10" fill="none" stroke="' + c.icon + '" stroke-width="1.2" opacity="0.6"/>',
    'Newspapers': '<rect x="10" y="10" width="20" height="22" rx="1" fill="' + c.icon + '" opacity="0.15" stroke="' + c.icon + '" stroke-width="1"/><line x1="13" y1="15" x2="27" y2="15" stroke="' + c.icon + '" stroke-width="2" opacity="0.8"/><line x1="13" y1="19" x2="27" y2="19" stroke="' + c.icon + '" stroke-width="1" opacity="0.4"/><line x1="13" y1="22" x2="27" y2="22" stroke="' + c.icon + '" stroke-width="1" opacity="0.4"/>',
  };
  const short = (sourceName || 'News').substring(0, 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" rx="6" fill="${c.bg}"/><g transform="translate(40,4)">${icons[mediaType] || icons['Online News']}</g><text x="60" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="600" fill="${c.text}">${short}</text><text x="60" y="70" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" fill="${c.icon}" opacity="0.5">${mediaType}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ── Main ───────────────────────────────────────────
async function generateReport() {
  console.log('Fetching Odisha client...');
  const { data: clients } = await supabase.from('clients').select('id, name').ilike('name', '%odisha%').limit(1);
  if (!clients?.length) { console.error('No Odisha client found'); process.exit(1); }
  const client = clients[0];
  console.log(`Client: ${client.name} (${client.id})`);

  // Fetch all articles
  console.log('Fetching articles...');
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, title, url, source_id, published_at, created_at, content, matched_keywords')
    .eq('client_id', client.id)
    .order('published_at', { ascending: false })
    .limit(500);
  if (error) { console.error('Error:', error.message); process.exit(1); }
  console.log(`Found ${articles.length} total articles`);

  // Fetch sources
  const sourceIds = [...new Set(articles.map(a => a.source_id).filter(Boolean))];
  const { data: sources } = await supabase.from('sources').select('id, name, url, source_type')
    .in('id', sourceIds.length > 0 ? sourceIds : ['00000000-0000-0000-0000-000000000000']);
  const sourceMap = {};
  (sources || []).forEach(s => { sourceMap[s.id] = s; });

  // Fetch analyses
  const articleIds = articles.map(a => a.id);
  const { data: analyses } = await supabase.from('article_analysis')
    .select('article_id, sentiment, importance_score, summary, entities, claims')
    .in('article_id', articleIds);
  const analysisMap = {};
  (analyses || []).forEach(a => { analysisMap[a.article_id] = a; });
  console.log(`Found ${analyses?.length || 0} analyses`);

  // Fetch signals
  const { data: signals } = await supabase.from('intelligence_signals')
    .select('title, description, severity, signal_type')
    .eq('client_id', client.id).order('created_at', { ascending: false }).limit(10);

  // Enrich articles
  const allEnriched = articles.map(a => {
    const src = sourceMap[a.source_id] || {};
    return {
      ...a,
      source_name: src.name || 'Unknown',
      source_type: src.source_type || 'rss',
      analysis: analysisMap[a.id] || null,
      sentiment: analysisMap[a.id]?.sentiment || 'neutral',
      importance: analysisMap[a.id]?.importance_score || 0,
      summary: analysisMap[a.id]?.summary || '',
      mediaType: classifySource(src.name || '', a.url),
    };
  });

  // ── STRICT ODISHA FILTER ────────────────────────
  const enriched = allEnriched.filter(a => isOdishaRelevant(a));
  console.log(`After Odisha filter: ${enriched.length} articles (removed ${allEnriched.length - enriched.length} non-Odisha)`);

  // ── Fetch real images for filtered articles ─────
  console.log('Fetching article images (og:image)...');
  const imageCache = {};
  const batchSize = 5;
  for (let i = 0; i < enriched.length; i += batchSize) {
    const batch = enriched.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async a => {
      const img = await fetchOgImage(a.url);
      return { id: a.id, img };
    }));
    results.forEach(r => { if (r.img) imageCache[r.id] = r.img; });
    const done = Math.min(i + batchSize, enriched.length);
    process.stdout.write(`\r  Images: ${Object.keys(imageCache).length} found / ${done} checked`);
  }
  console.log(`\n  Total images fetched: ${Object.keys(imageCache).length}/${enriched.length}`);

  // Assign images
  enriched.forEach(a => { a.image_url = imageCache[a.id] || null; });

  // ── Stats ───────────────────────────────────────
  const analyzed = enriched.filter(a => a.analysis);
  const posCount = analyzed.filter(a => a.sentiment === 'positive').length;
  const negCount = analyzed.filter(a => a.sentiment === 'negative').length;
  const neuCount = analyzed.filter(a => a.sentiment === 'neutral').length;
  const total = analyzed.length || 1;

  // CM perception
  const cmArticles = enriched.filter(a => {
    const text = `${a.title} ${a.summary} ${a.content || ''}`.toLowerCase();
    return text.includes('mohan majhi') || text.includes('chief minister') || text.includes('cm majhi') || text.includes('cm odisha');
  });
  const cmPos = cmArticles.filter(a => a.sentiment === 'positive').length;
  const cmNeg = cmArticles.filter(a => a.sentiment === 'negative').length;
  const cmNeu = cmArticles.filter(a => a.sentiment === 'neutral').length;

  // Group by media type
  const tvArticles = enriched.filter(a => a.mediaType === 'TV Intelligence');
  const onlineArticles = enriched.filter(a => a.mediaType === 'Online News');
  const newspaperArticles = enriched.filter(a => a.mediaType === 'Newspapers');

  // Issue-wise sentiment
  const issues = [
    { name: 'Infrastructure & Development', keywords: ['infrastructure', 'development', 'road', 'bridge', 'highway', 'construction', 'smart city', 'industrial corridor', 'IDCO'] },
    { name: 'Political Landscape', keywords: ['bjd', 'bjp', 'congress', 'election', 'political', 'assembly', 'party', 'opposition', 'naveen patnaik'] },
    { name: 'Steel & Mining Industry', keywords: ['tata steel', 'jspl', 'nalco', 'sail', 'mining', 'steel', 'rourkela', 'angul', 'jharsuguda'] },
    { name: 'Public Welfare & Social Issues', keywords: ['protest', 'scam', 'fraud', 'corruption', 'welfare', 'scheme', 'poverty', 'tribal', 'relief', 'farmer'] },
    { name: 'Economy & Business', keywords: ['gst', 'investment', 'budget', 'economy', 'trade', 'business', 'revenue', 'mou'] },
    { name: 'Climate & Disaster', keywords: ['flood', 'cyclone', 'climate', 'rain', 'disaster', 'drought', 'environment'] },
  ];
  const issueAnalysis = issues.map(issue => {
    const matched = enriched.filter(a => {
      const txt = `${a.title} ${a.summary} ${(a.matched_keywords || []).join(' ')}`.toLowerCase();
      return issue.keywords.some(k => txt.includes(k));
    });
    return { ...issue, total: matched.length, positive: matched.filter(a => a.sentiment === 'positive').length, negative: matched.filter(a => a.sentiment === 'negative').length, neutral: matched.filter(a => a.sentiment === 'neutral').length };
  }).filter(i => i.total > 0);

  // Helpers
  function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
  function fmtTime(d) { return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  function groupByDate(items) {
    const g = {};
    items.forEach(a => { const k = new Date(a.published_at || a.created_at).toISOString().split('T')[0]; if (!g[k]) g[k] = []; g[k].push(a); });
    return Object.entries(g).sort(([a],[b]) => b.localeCompare(a));
  }

  // ── Article card HTML ───────────────────────────
  function articleCard(a) {
    const ss = sentimentStyle(a.sentiment);
    const fallback = placeholderSvg(a.source_name, a.mediaType);
    const imgSrc = a.image_url || fallback;
    return `
      <div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid #f1f5f9;break-inside:avoid;">
        <img src="${imgSrc}" alt="" style="width:130px;height:85px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid #e2e8f0;" onerror="this.src='${fallback}'">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="background:${ss.bg};color:${ss.color};border:1px solid ${ss.border};padding:2px 10px;border-radius:4px;font-size:10px;font-weight:600;">${ss.label}</span>
            <span style="color:#94a3b8;font-size:11px;">${fmtTime(a.published_at || a.created_at)}</span>
            <span style="color:#94a3b8;font-size:11px;">|</span>
            <span style="color:#64748b;font-size:11px;font-weight:500;">${a.source_name}</span>
            ${a.importance >= 7 ? '<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;">⚡ HIGH PRIORITY</span>' : ''}
          </div>
          <a href="${a.url || '#'}" target="_blank" style="font-size:14px;font-weight:600;color:#0f172a;text-decoration:none;line-height:1.3;display:block;margin-bottom:4px;">${a.title || 'Untitled'}</a>
          <p style="font-size:12px;color:#64748b;line-height:1.5;margin:0;">${(a.summary || a.title || '').substring(0, 220)}${(a.summary || '').length > 220 ? '...' : ''}</p>
          ${a.matched_keywords?.length ? `<div style="margin-top:6px;">${a.matched_keywords.slice(0,5).map(k => `<span style="background:#f0fdf4;color:#166534;padding:2px 8px;border-radius:4px;font-size:9px;margin-right:4px;">#${k}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  // ── Section builder ─────────────────────────────
  function buildSection(title, icon, items, color) {
    const groups = groupByDate(items);
    if (!items.length) return `<div class="page-break" style="padding:50px 60px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:12px;border-bottom:3px solid ${color};"><span style="font-size:28px;">${icon}</span><h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">${title}</h2><span style="background:${color}20;color:${color};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;margin-left:auto;">0 Stories</span></div><p style="color:#94a3b8;font-style:italic;">No Odisha-relevant articles found in this category.</p></div>`;
    let html = `<div class="page-break" style="padding:50px 60px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid ${color};"><span style="font-size:28px;">${icon}</span><h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">${title}</h2><span style="background:${color}20;color:${color};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;margin-left:auto;">${items.length} Stories</span></div>`;
    for (const [date, dayItems] of groups) {
      html += `<div style="margin-bottom:28px;"><div style="background:linear-gradient(90deg,${color}15,transparent);padding:8px 16px;border-left:4px solid ${color};border-radius:0 6px 6px 0;margin-bottom:12px;"><span style="font-size:14px;font-weight:700;color:#0f172a;">📅 ${fmtDate(date)}</span><span style="color:#94a3b8;font-size:12px;margin-left:12px;">${dayItems.length} ${dayItems.length === 1 ? 'story' : 'stories'}</span></div>${dayItems.map(a => articleCard(a)).join('')}</div>`;
    }
    return html + '</div>';
  }

  function issueBar(issue) {
    const t = issue.total || 1;
    const pPct = Math.round((issue.positive / t) * 100);
    const nPct = Math.round((issue.negative / t) * 100);
    const neuPct = 100 - pPct - nPct;
    return `<div style="margin-bottom:16px;break-inside:avoid;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span style="font-size:13px;font-weight:600;color:#0f172a;">${issue.name}</span><span style="font-size:11px;color:#94a3b8;">${issue.total} articles</span></div><div style="display:flex;height:24px;border-radius:6px;overflow:hidden;background:#f1f5f9;">${pPct > 0 ? `<div style="width:${pPct}%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${pPct}%</div>` : ''}${neuPct > 0 ? `<div style="width:${neuPct}%;background:#94a3b8;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${neuPct}%</div>` : ''}${nPct > 0 ? `<div style="width:${nPct}%;background:#ef4444;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${nPct}%</div>` : ''}</div></div>`;
  }

  // ── Assemble report ─────────────────────────────
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ROBIN — Odisha Media Intelligence Report — ${today}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  @page { margin: 0; size: A4; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',-apple-system,sans-serif; color:#1e293b; line-height:1.6; font-size:13px; background:white; }
  @media print {
    body { font-size:10px; }
    .page-break { page-break-before:always; break-before:page; }
    div[style*="break-inside:avoid"] { break-inside:avoid; page-break-inside:avoid; }
  }
  a { color:#0d9488; }
</style>
</head>
<body>

<!-- COVER -->
<div style="min-height:100vh;background:linear-gradient(135deg,#0a0c12 0%,#0f172a 40%,#1e293b 100%);display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;text-align:center;padding:60px 40px;">
  <div style="width:70px;height:70px;border-radius:16px;background:linear-gradient(135deg,#0d9488,#0f766e);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;box-shadow:0 20px 60px rgba(13,148,136,0.3);margin-bottom:30px;">R</div>
  <h1 style="font-size:42px;font-weight:800;letter-spacing:-1px;margin-bottom:8px;">Odisha Media Intelligence Report</h1>
  <p style="font-size:18px;color:rgba(255,255,255,0.5);margin-bottom:40px;">Daily OSINT Monitoring — Government of Odisha</p>
  <div style="width:80px;height:3px;background:linear-gradient(90deg,#0d9488,#f59e0b);border-radius:2px;margin-bottom:40px;"></div>
  <h3 style="font-size:22px;font-weight:600;color:#0d9488;margin-bottom:8px;">Government of Odisha</h3>
  <p style="color:rgba(255,255,255,0.4);font-size:14px;">Infrastructure & Governance Media Monitoring</p>
  <p style="color:rgba(255,255,255,0.3);font-size:13px;margin-top:20px;">Report Date: ${today}</p>
  <p style="color:rgba(255,255,255,0.3);font-size:13px;">Classification: <strong style="color:#f59e0b;">CONFIDENTIAL — Client Only</strong></p>
  <div style="margin-top:50px;display:flex;gap:40px;">
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#0d9488;">${enriched.length}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Odisha Stories</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#22c55e;">${posCount}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Positive</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#94a3b8;">${neuCount}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Neutral</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#ef4444;">${negCount}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Negative</div></div>
  </div>
</div>

<!-- EXECUTIVE SUMMARY -->
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid #0d9488;">
    <span style="font-size:28px;">📊</span>
    <h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">Executive Analysis Summary</h2>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px;">
    <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #86efac;border-radius:10px;padding:20px;text-align:center;">
      <div style="font-size:36px;font-weight:800;color:#16a34a;">${Math.round((posCount/total)*100)}%</div>
      <div style="font-size:12px;font-weight:600;color:#166534;">POSITIVE COVERAGE</div>
      <div style="font-size:11px;color:#4ade80;margin-top:4px;">${posCount} articles</div>
    </div>
    <div style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #cbd5e1;border-radius:10px;padding:20px;text-align:center;">
      <div style="font-size:36px;font-weight:800;color:#475569;">${Math.round((neuCount/total)*100)}%</div>
      <div style="font-size:12px;font-weight:600;color:#475569;">NEUTRAL COVERAGE</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${neuCount} articles</div>
    </div>
    <div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border:1px solid #fca5a5;border-radius:10px;padding:20px;text-align:center;">
      <div style="font-size:36px;font-weight:800;color:#dc2626;">${Math.round((negCount/total)*100)}%</div>
      <div style="font-size:12px;font-weight:600;color:#991b1b;">NEGATIVE COVERAGE</div>
      <div style="font-size:11px;color:#f87171;margin-top:4px;">${negCount} articles</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px;">
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;"><div style="font-size:24px;margin-bottom:4px;">📺</div><div style="font-size:20px;font-weight:800;color:#7c3aed;">${tvArticles.length}</div><div style="font-size:11px;color:#64748b;">TV Intelligence</div></div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;"><div style="font-size:24px;margin-bottom:4px;">🌐</div><div style="font-size:20px;font-weight:800;color:#0d9488;">${onlineArticles.length}</div><div style="font-size:11px;color:#64748b;">Online News</div></div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;"><div style="font-size:24px;margin-bottom:4px;">📰</div><div style="font-size:20px;font-weight:800;color:#ea580c;">${newspaperArticles.length}</div><div style="font-size:11px;color:#64748b;">Newspapers</div></div>
  </div>
  <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:16px;">Positive / Negative Sentiment by Issue</h3>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px;">
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <span style="display:flex;align-items:center;gap:4px;font-size:10px;color:#64748b;"><span style="width:10px;height:10px;background:#22c55e;border-radius:2px;display:inline-block;"></span> Positive</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:10px;color:#64748b;"><span style="width:10px;height:10px;background:#94a3b8;border-radius:2px;display:inline-block;"></span> Neutral</span>
      <span style="display:flex;align-items:center;gap:4px;font-size:10px;color:#64748b;"><span style="width:10px;height:10px;background:#ef4444;border-radius:2px;display:inline-block;"></span> Negative</span>
    </div>
    ${issueAnalysis.map(i => issueBar(i)).join('')}
  </div>
  ${signals?.length ? `<h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">Key Intelligence Signals</h3><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">${signals.slice(0,5).map(s => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:flex-start;gap:10px;"><span style="background:${s.severity==='critical'?'#fef2f2':s.severity==='high'?'#fff7ed':'#f0fdf4'};color:${s.severity==='critical'?'#dc2626':s.severity==='high'?'#ea580c':'#16a34a'};padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;flex-shrink:0;">${s.severity||'info'}</span><div><div style="font-size:12px;font-weight:600;color:#0f172a;">${s.title}</div><div style="font-size:11px;color:#64748b;">${(s.description||'').substring(0,150)}</div></div></div>`).join('')}</div>` : ''}
</div>

<!-- PLATFORM OVERVIEW -->
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid #0d9488;">
    <span style="font-size:28px;">🖥️</span>
    <h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">ROBIN Platform — How We Create This Data</h2>
  </div>
  <p style="font-size:13px;color:#64748b;margin-bottom:24px;line-height:1.6;">The ROBIN Intelligence Platform is an AI-powered OSINT (Open Source Intelligence) system that continuously monitors, collects, analyzes, and categorizes media coverage across 154+ sources. Below are live screenshots from the platform showing how data flows from collection to analysis.</p>

  ${platformScreenshots.overview ? `<div style="margin-bottom:32px;break-inside:avoid;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">1. Command Center — Real-time Overview</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">The main dashboard shows live operational targets tracking keywords like <strong>Odisha (37 mentions)</strong>, <strong>Bhubaneswar, infrastructure, BJD</strong>. It features a geographic intelligence map, a live situation room with critical alerts, and a 24-hour risk pulse chart. All data updates in real-time.</p>
    <img src="${platformScreenshots.overview}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  </div>` : ''}

  ${platformScreenshots.intelligence ? `<div style="margin-bottom:32px;break-inside:avoid;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">2. AI Intelligence Brief — Automated Analysis</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">Our AI generates a comprehensive situation summary analyzing all collected articles. It identifies <strong>key developments</strong> (cabinet appointments, Paradip Port Trust, Odisha Mining Corporation), maintains a <strong>7-day watch list</strong>, and tracks <strong>active developments</strong> with sentiment scores. Each entity is automatically tracked.</p>
    <img src="${platformScreenshots.intelligence}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  </div>` : ''}

  ${platformScreenshots.reports ? `<div style="margin-bottom:32px;break-inside:avoid;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">3. Reports & Analytics — Sentiment Tracking</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">Visual analytics showing daily article collection volumes, sentiment distribution over time, trending keywords, and top-performing sources. These charts help track media narrative shifts around key Odisha issues.</p>
    <img src="${platformScreenshots.reports}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  </div>` : ''}

  ${platformScreenshots.activity ? `<div style="margin-bottom:32px;break-inside:avoid;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">4. Activity Feed — Individual Article Details</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">Every collected article is displayed with its AI-generated sentiment analysis, importance score (1-10), matched keywords, and original source link. Analysts can filter by sentiment, date, and source to find specific stories.</p>
    <img src="${platformScreenshots.activity}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  </div>` : ''}

  ${platformScreenshots.sources ? `<div style="margin-bottom:32px;break-inside:avoid;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">5. Source Management — 154+ Monitored Sources</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">The platform monitors 154 news sources including RSS feeds, web crawlers, and YouTube channels. Sources span Odisha-specific outlets (OdishaTV, Utkal Samachar, Kalinga TV) as well as national/international media (NDTV, BBC, Indian Express). Each source is auto-scraped on schedule.</p>
    <img src="${platformScreenshots.sources}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  </div>` : ''}

  ${platformScreenshots.entities ? `<div style="margin-bottom:32px;break-inside:avoid;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">6. Entity Intelligence — Automated Tracking</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">The AI automatically identifies and tracks entities (people, organizations, locations) mentioned across all articles. For Odisha, it tracks entities like <strong>BJD, Odisha Government, Naveen Patnaik, Mohan Majhi,</strong> and key organizations with mention frequency and sentiment history.</p>
    <img src="${platformScreenshots.entities}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  </div>` : ''}
</div>

<!-- CM PERCEPTION -->
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid #1e40af;">
    <span style="font-size:28px;">🏛️</span>
    <h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">Chief Minister Perception Analysis</h2>
  </div>
  <p style="font-size:13px;color:#64748b;margin-bottom:20px;">Analysis of media coverage mentioning Chief Minister Mohan Majhi across all Odisha-relevant sources.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:12px;padding:24px;color:white;text-align:center;">
      <div style="font-size:48px;font-weight:800;color:#0d9488;">${cmArticles.length}</div>
      <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Total CM Mentions</div>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
      <h4 style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:12px;">Sentiment Breakdown</h4>
      <div style="display:flex;height:28px;border-radius:6px;overflow:hidden;margin-bottom:8px;background:#f1f5f9;">
        ${cmPos > 0 ? `<div style="width:${Math.round((cmPos/Math.max(cmArticles.length,1))*100)}%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${cmPos} Pos</div>` : ''}
        ${cmNeu > 0 ? `<div style="width:${Math.round((cmNeu/Math.max(cmArticles.length,1))*100)}%;background:#94a3b8;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${cmNeu} Neutral</div>` : ''}
        ${cmNeg > 0 ? `<div style="width:${Math.round((cmNeg/Math.max(cmArticles.length,1))*100)}%;background:#ef4444;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${cmNeg} Neg</div>` : ''}
      </div>
      <div style="font-size:11px;color:#64748b;">Overall perception: <strong style="color:${cmNeg > cmPos ? '#dc2626' : cmPos > cmNeu ? '#16a34a' : '#475569'};">${cmNeg > cmPos ? 'Needs Attention' : cmPos > cmNeu ? 'Largely Favorable' : 'Predominantly Neutral'}</strong></div>
    </div>
  </div>
  ${cmArticles.length > 0 ? `<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:12px;">Stories Mentioning Chief Minister</h3><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">${cmArticles.slice(0,10).map(a => { const ss = sentimentStyle(a.sentiment); return `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;break-inside:avoid;display:flex;gap:12px;">${a.image_url ? `<img src="${a.image_url}" style="width:80px;height:55px;object-fit:cover;border-radius:6px;flex-shrink:0;">` : ''}<div><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="background:${ss.bg};color:${ss.color};padding:2px 8px;border-radius:4px;font-size:9px;font-weight:600;">${ss.label}</span><span style="font-size:10px;color:#94a3b8;">${a.source_name} • ${fmtTime(a.published_at || a.created_at)}</span></div><a href="${a.url||'#'}" style="font-size:12px;font-weight:600;color:#0f172a;text-decoration:none;">${a.title}</a><p style="font-size:11px;color:#64748b;margin-top:2px;">${(a.summary||'').substring(0,150)}</p></div></div>`; }).join('')}</div>` : '<p style="color:#94a3b8;font-style:italic;">No articles directly mentioning the Chief Minister were found in this reporting period.</p>'}
</div>

<!-- TV INTELLIGENCE -->
${buildSection('TV Intelligence', '📺', tvArticles, '#7c3aed')}

<!-- ONLINE NEWS -->
${buildSection('Online News', '🌐', onlineArticles, '#0d9488')}

<!-- NEWSPAPERS -->
${buildSection('Newspapers', '📰', newspaperArticles, '#ea580c')}

<!-- BACK COVER -->
<div class="page-break" style="min-height:100vh;background:linear-gradient(135deg,#0a0c12,#0f172a,#1e293b);display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;text-align:center;padding:60px;">
  <div style="width:50px;height:50px;border-radius:12px;background:linear-gradient(135deg,#0d9488,#0f766e);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;margin-bottom:24px;">R</div>
  <h2 style="font-size:28px;font-weight:700;margin-bottom:8px;">ROBIN Intelligence Platform</h2>
  <p style="color:rgba(255,255,255,0.4);font-size:13px;margin-bottom:30px;">AI-Powered Media Monitoring & Analysis</p>
  <div style="width:60px;height:2px;background:linear-gradient(90deg,#0d9488,#f59e0b);margin-bottom:30px;"></div>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;">This report was automatically generated by the ROBIN Intelligence Platform.</p>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;">Only Odisha-relevant articles from ${enriched.length} monitored stories are included.</p>
  <p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:30px;">© 2026 ROBIN Intelligence. Confidential — Government of Odisha.</p>
</div>
</body></html>`;

  const outPath = 'ROBIN_Daily_Media_Report_Odisha.html';
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`\n✅ Report: ${outPath}`);
  console.log(`   Odisha articles: ${enriched.length} (filtered from ${allEnriched.length})`);
  console.log(`   TV: ${tvArticles.length} | Online: ${onlineArticles.length} | Newspapers: ${newspaperArticles.length}`);
  console.log(`   Positive: ${posCount} | Neutral: ${neuCount} | Negative: ${negCount}`);
  console.log(`   CM mentions: ${cmArticles.length}`);
  console.log(`   Images found: ${Object.keys(imageCache).length}`);
}

generateReport().catch(err => { console.error(err); process.exit(1); });
