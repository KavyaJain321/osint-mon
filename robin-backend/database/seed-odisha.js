// ============================================================
// ROBIN OSINT — Odisha Government Feed Setup
// Sets up complete OSINT feed for Government of Odisha
// Run: node database/seed-odisha.js
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

const ODISHA_CLIENT_ID = '7b5390a0-0d5b-419e-84b4-533fd9c44d36';

const log = (msg) => console.log(`[seed-odisha] ${msg}`);

// ── Situation Brief ───────────────────────────────────────────
const BRIEF = {
    title: 'Odisha Government Strategic Intelligence Monitor',
    problem_statement: `1. MANDATE & SCOPE
The Government of Odisha requires continuous real-time intelligence across political, security, economic, social, and environmental domains to support evidence-based governance and proactive crisis management.

2. POLITICAL INTELLIGENCE
Monitor activities of the ruling BJP government, opposition BJD and Congress, Chief Minister Mohan Majhi's office, Odisha Legislative Assembly sessions, Governor Hari Babu Kambhampati's directives, and intra-party developments affecting state governance stability.

3. SECURITY & LAW ENFORCEMENT
Track Naxal/Maoist activity in the red-corridor districts (Malkangiri, Koraput, Rayagada, Kandhamal), IED incidents, CRPF/STF operations, police encounter reports, cybercrime trends, and Odisha Vigilance Bureau actions against corruption.

4. MINING & INDUSTRIAL INTELLIGENCE
Monitor iron ore, coal, and bauxite mining lease developments, NALCO, SAIL Rourkela, Tata Steel Kalinganagar, Vedanta, and Adani operations, Make in Odisha investment pipeline, MSME sector health, and Odisha Industrial Corridor progress.

5. INFRASTRUCTURE & DEVELOPMENT
Track Smart City Bhubaneswar, Paradip/Gopalpur/Dhamra port developments, national highway and railway projects, AIIMS Bhubaneswar, metro rail proposals, and flagship schemes under state and central government.

6. DISASTER & ENVIRONMENT
Monitor Bay of Bengal cyclone formations, flood warnings on Mahanadi/Brahmani/Baitarani rivers, drought conditions, forest fires, heat wave advisories, Mahanadi water-sharing dispute with Chhattisgarh, and industrial pollution incidents.

7. SOCIAL & TRIBAL AFFAIRS
Track PVTG welfare, tribal land rights, bonded labour incidents, child trafficking, women safety, inter-community tensions, KALIA and Biju Swasthya Kalyan scheme implementation, and farmer distress incidents.

8. MEDIA & SENTIMENT MONITORING
Monitor Orissa POST, OTV, Kanak News, Sambad, Dharitri, Pragativadi, ETV Odia, and national media coverage of Odisha. Track social media sentiment, viral narratives, and disinformation targeting the state government.`,
    status: 'active',
};

// ── Keywords (90 across 9 categories) ────────────────────────
const KEYWORDS = [
    // Government & Politics (priority 10)
    { keyword: 'CM Mohan Majhi', priority: 10, category: 'politics' },
    { keyword: 'Naveen Patnaik', priority: 10, category: 'politics' },
    { keyword: 'BJP Odisha', priority: 10, category: 'politics' },
    { keyword: 'BJD Odisha', priority: 10, category: 'politics' },
    { keyword: 'Congress Odisha', priority: 10, category: 'politics' },
    { keyword: 'Odisha cabinet', priority: 10, category: 'politics' },
    { keyword: 'Odisha Legislative Assembly', priority: 10, category: 'politics' },
    { keyword: 'Governor Odisha', priority: 9, category: 'politics' },
    { keyword: 'CMO Odisha', priority: 9, category: 'politics' },
    { keyword: 'political crisis Odisha', priority: 9, category: 'politics' },
    { keyword: 'by-election Odisha', priority: 8, category: 'politics' },
    { keyword: 'MLA Odisha arrested', priority: 9, category: 'politics' },

    // Security & Law & Order (priority 10)
    { keyword: 'Naxal Odisha', priority: 10, category: 'security' },
    { keyword: 'Maoist Odisha', priority: 10, category: 'security' },
    { keyword: 'CRPF Odisha', priority: 10, category: 'security' },
    { keyword: 'STF Odisha', priority: 10, category: 'security' },
    { keyword: 'Odisha police encounter', priority: 10, category: 'security' },
    { keyword: 'IED blast Odisha', priority: 10, category: 'security' },
    { keyword: 'crime Odisha', priority: 9, category: 'security' },
    { keyword: 'cybercrime Odisha', priority: 9, category: 'security' },
    { keyword: 'Odisha Vigilance Bureau', priority: 9, category: 'security' },
    { keyword: 'Malkangiri Maoist', priority: 10, category: 'security' },
    { keyword: 'Koraput Naxal', priority: 10, category: 'security' },
    { keyword: 'communal tension Odisha', priority: 9, category: 'security' },

    // Mining & Industry (priority 9)
    { keyword: 'iron ore Odisha', priority: 9, category: 'mining' },
    { keyword: 'coal mining Odisha', priority: 9, category: 'mining' },
    { keyword: 'NALCO Odisha', priority: 9, category: 'mining' },
    { keyword: 'SAIL Rourkela', priority: 9, category: 'mining' },
    { keyword: 'Vedanta Odisha', priority: 9, category: 'mining' },
    { keyword: 'Adani Odisha', priority: 9, category: 'mining' },
    { keyword: 'Tata Steel Kalinganagar', priority: 9, category: 'mining' },
    { keyword: 'mining lease Odisha', priority: 9, category: 'mining' },
    { keyword: 'Make in Odisha', priority: 8, category: 'mining' },
    { keyword: 'MSME Odisha', priority: 8, category: 'mining' },
    { keyword: 'Odisha industrial corridor', priority: 8, category: 'mining' },
    { keyword: 'POSCO Odisha', priority: 8, category: 'mining' },

    // Infrastructure & Development (priority 9)
    { keyword: 'Smart City Bhubaneswar', priority: 9, category: 'infrastructure' },
    { keyword: 'AIIMS Bhubaneswar', priority: 9, category: 'infrastructure' },
    { keyword: 'Paradip port', priority: 9, category: 'infrastructure' },
    { keyword: 'Gopalpur port', priority: 8, category: 'infrastructure' },
    { keyword: 'Dhamra port', priority: 8, category: 'infrastructure' },
    { keyword: 'national highway Odisha', priority: 8, category: 'infrastructure' },
    { keyword: 'railway Odisha', priority: 8, category: 'infrastructure' },
    { keyword: 'Bhubaneswar airport', priority: 8, category: 'infrastructure' },
    { keyword: 'Odisha PCPIR', priority: 8, category: 'infrastructure' },
    { keyword: 'metro rail Bhubaneswar', priority: 8, category: 'infrastructure' },

    // Disasters & Environment (priority 9)
    { keyword: 'cyclone Odisha', priority: 10, category: 'disaster' },
    { keyword: 'flood Odisha', priority: 10, category: 'disaster' },
    { keyword: 'NDRF Odisha', priority: 9, category: 'disaster' },
    { keyword: 'drought Odisha', priority: 9, category: 'disaster' },
    { keyword: 'heat wave Odisha', priority: 9, category: 'disaster' },
    { keyword: 'forest fire Odisha', priority: 9, category: 'disaster' },
    { keyword: 'Mahanadi river Odisha', priority: 9, category: 'disaster' },
    { keyword: 'pollution Odisha', priority: 8, category: 'disaster' },
    { keyword: 'sand mining Odisha', priority: 8, category: 'disaster' },
    { keyword: 'cyclone landfall Odisha coast', priority: 9, category: 'disaster' },

    // Social & Tribal Affairs (priority 8)
    { keyword: 'tribal Odisha', priority: 9, category: 'social' },
    { keyword: 'PVTG Odisha', priority: 9, category: 'social' },
    { keyword: 'child trafficking Odisha', priority: 9, category: 'social' },
    { keyword: 'women safety Odisha', priority: 9, category: 'social' },
    { keyword: 'farmer protest Odisha', priority: 8, category: 'social' },
    { keyword: 'KALIA scheme', priority: 8, category: 'social' },
    { keyword: 'Biju Swasthya Kalyan', priority: 8, category: 'social' },
    { keyword: 'bonded labour Odisha', priority: 8, category: 'social' },
    { keyword: 'land acquisition Odisha', priority: 8, category: 'social' },
    { keyword: 'displacement Odisha tribal', priority: 8, category: 'social' },

    // Agriculture & Economy (priority 8)
    { keyword: 'paddy procurement Odisha', priority: 8, category: 'agriculture' },
    { keyword: 'crop damage Odisha', priority: 8, category: 'agriculture' },
    { keyword: 'fisheries Odisha', priority: 8, category: 'agriculture' },
    { keyword: 'food security Odisha', priority: 8, category: 'agriculture' },
    { keyword: 'Odisha budget', priority: 8, category: 'economy' },
    { keyword: 'investment Odisha', priority: 8, category: 'economy' },
    { keyword: 'startup Odisha', priority: 7, category: 'economy' },
    { keyword: 'GST revenue Odisha', priority: 7, category: 'economy' },

    // Health & Education (priority 7)
    { keyword: 'malaria Odisha', priority: 8, category: 'health' },
    { keyword: 'dengue Odisha', priority: 8, category: 'health' },
    { keyword: 'health department Odisha', priority: 7, category: 'health' },
    { keyword: 'hospital scam Odisha', priority: 8, category: 'health' },
    { keyword: 'IIT Bhubaneswar', priority: 7, category: 'education' },
    { keyword: 'NIT Rourkela', priority: 7, category: 'education' },
    { keyword: 'school dropout Odisha', priority: 7, category: 'education' },

    // Culture & Media (priority 7)
    { keyword: 'Rath Yatra Puri', priority: 8, category: 'culture' },
    { keyword: 'Konark festival', priority: 7, category: 'culture' },
    { keyword: 'Odisha tourism', priority: 7, category: 'culture' },
    { keyword: 'Chilika lake', priority: 7, category: 'culture' },
    { keyword: 'Odisha government scheme', priority: 8, category: 'governance' },
    { keyword: 'Bhubaneswar smart city', priority: 7, category: 'governance' },
    { keyword: 'Odisha corruption', priority: 9, category: 'governance' },
    { keyword: 'Odisha tender scam', priority: 9, category: 'governance' },
];

// ── Sources ───────────────────────────────────────────────────
const RSS_SOURCES = [
    { name: 'Orissa POST (English Daily)', url: 'https://www.orissapost.com/feed/', source_type: 'rss' },
    { name: 'OTV News RSS', url: 'https://www.otvnews.com/feed/', source_type: 'rss' },
    { name: 'OdishaTV RSS', url: 'https://odishatv.in/feed/', source_type: 'rss' },
    { name: 'Odisha Bytes', url: 'https://odishabytes.com/feed/', source_type: 'rss' },
    { name: 'Dharitri (Odia)', url: 'https://www.dharitri.com/feed/', source_type: 'rss' },
    { name: 'Pragativadi', url: 'https://www.pragativadi.com/feed/', source_type: 'rss' },
    { name: 'New Indian Express — Odisha', url: 'https://www.newindianexpress.com/states/odisha/rssfeed', source_type: 'rss' },
    { name: 'PIB Bhubaneswar (Govt Press Releases)', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', source_type: 'rss' },
    { name: 'Zee News India', url: 'https://zeenews.india.com/rss/india-national-news.xml', source_type: 'rss' },
    { name: 'The Hindu — National', url: 'https://www.thehindu.com/feeder/default.rss', source_type: 'rss' },
    { name: 'NDTV India RSS', url: 'https://feeds.feedburner.com/ndtvnews-india-news', source_type: 'rss' },
    { name: 'India Today RSS', url: 'https://www.indiatoday.in/rss/1206519', source_type: 'rss' },
];

const HTML_SOURCES = [
    { name: 'Times of India — Bhubaneswar', url: 'https://timesofindia.indiatimes.com/city/bhubaneswar', source_type: 'html' },
    { name: 'The Hindu — Odisha', url: 'https://www.thehindu.com/news/national/odisha/', source_type: 'html' },
    { name: 'Indian Express — Odisha', url: 'https://indianexpress.com/section/india/odisha/', source_type: 'html' },
    { name: 'NDTV — Odisha', url: 'https://www.ndtv.com/odisha-news', source_type: 'html' },
    { name: 'Economic Times — Odisha', url: 'https://economictimes.indiatimes.com/news/politics-and-nation/odisha', source_type: 'html' },
    { name: 'Business Standard — Odisha', url: 'https://www.business-standard.com/topic/odisha', source_type: 'html' },
    { name: 'The Wire — Odisha', url: 'https://thewire.in/tag/odisha', source_type: 'html' },
    { name: 'Scroll — Odisha', url: 'https://scroll.in/topic/odisha', source_type: 'html' },
    { name: 'Hindustan Times — Odisha', url: 'https://www.hindustantimes.com/india-news/odisha', source_type: 'html' },
    { name: 'News18 — Odisha', url: 'https://www.news18.com/odisha/', source_type: 'html' },
    { name: 'CMO Odisha (Official)', url: 'https://cmo.odisha.gov.in/', source_type: 'html' },
    { name: 'Odisha Police (Official)', url: 'https://odishapolice.gov.in/news-updates/', source_type: 'html' },
    { name: 'Odisha Mining Corporation', url: 'https://www.omcltd.in/latest-news', source_type: 'html' },
    { name: 'IDCO Odisha', url: 'https://idco.net/latest-news/', source_type: 'html' },
    { name: 'Bhubaneswar Smart City', url: 'https://smartcitybhubaneswar.gov.in/latest-news/', source_type: 'html' },
];

// Verified YouTube channels (handles confirmed working)
const YOUTUBE_SOURCES = [
    { name: 'OdishaTV News (YouTube)', url: 'https://www.youtube.com/@OdishaTVNews' },
    { name: 'OdishaTV1 (YouTube)', url: 'https://www.youtube.com/@OdishaTV1' },
    { name: 'Kanak News Odia (YouTube)', url: 'https://www.youtube.com/@KanakNewsOdia' },
    { name: 'News18 Odia (YouTube)', url: 'https://www.youtube.com/@News18Odia' },
    { name: 'Zee Odisha (YouTube)', url: 'https://www.youtube.com/@ZeeOdisha' },
    { name: 'ETV Odia (YouTube)', url: 'https://www.youtube.com/@ETVOdia' },
    { name: 'Sambad News (YouTube)', url: 'https://www.youtube.com/@SambadNews' },
    { name: 'NTV Odisha (YouTube)', url: 'https://www.youtube.com/@NTVOdisha' },
    { name: 'Prameya News7 (YouTube)', url: 'https://www.youtube.com/@PrameyaNews7' },
    { name: 'Kalinga TV News (YouTube)', url: 'https://www.youtube.com/@KalingaTVNews' },
];

async function run() {
    log('Starting Odisha Government feed setup...');
    log(`Client ID: ${ODISHA_CLIENT_ID}`);

    // ── Step 1: Ensure Odisha client exists ──────────────────
    log('\n── Step 1: Ensuring Odisha client exists ──');
    const { data: existingClient } = await sb.from('clients').select('id').eq('id', ODISHA_CLIENT_ID).single();
    if (!existingClient) {
        const { error } = await sb.from('clients').insert({
            id: ODISHA_CLIENT_ID,
            name: 'Government of Odisha',
            industry: 'State Government & Public Administration',
        });
        if (error) { log(`FATAL: Client create failed: ${error.message}`); process.exit(1); }
        log('✓ Odisha client created');
    } else {
        // Update name if needed
        await sb.from('clients').update({ name: 'Government of Odisha', industry: 'State Government & Public Administration' }).eq('id', ODISHA_CLIENT_ID);
        log('✓ Odisha client exists — updated');
    }

    // ── Step 2: Remove existing sources ─────────────────────
    log('\n── Step 2: Removing old sources ──');
    const { error: delErr } = await sb.from('sources').delete().eq('client_id', ODISHA_CLIENT_ID);
    if (delErr) log(`⚠ Source delete: ${delErr.message}`);
    else log('✓ Old sources cleared');

    // ── Step 3: Deactivate existing brief ───────────────────
    log('\n── Step 3: Deactivating existing brief ──');
    await sb.from('client_briefs').update({ status: 'archived' })
        .eq('client_id', ODISHA_CLIENT_ID).eq('status', 'active');

    // Delete old keywords
    const { data: oldBriefs } = await sb.from('client_briefs').select('id').eq('client_id', ODISHA_CLIENT_ID);
    for (const b of (oldBriefs || [])) {
        await sb.from('brief_generated_keywords').delete().eq('brief_id', b.id);
    }

    // ── Step 4: Insert new brief ─────────────────────────────
    log('\n── Step 4: Inserting new brief ──');
    const { data: brief, error: briefErr } = await sb.from('client_briefs').insert({
        client_id: ODISHA_CLIENT_ID,
        ...BRIEF,
    }).select('id').single();
    if (briefErr) { log(`FATAL: Brief insert failed: ${briefErr.message}`); process.exit(1); }
    log(`✓ Brief created: ${brief.id}`);

    // ── Step 5: Insert keywords ──────────────────────────────
    log('\n── Step 5: Inserting keywords ──');
    const kwRows = KEYWORDS.map(k => ({ brief_id: brief.id, ...k }));
    const { error: kwErr } = await sb.from('brief_generated_keywords').insert(kwRows);
    if (kwErr) log(`⚠ Keywords: ${kwErr.message}`);
    else log(`✓ ${KEYWORDS.length} keywords inserted`);

    // ── Step 6: Insert sources ───────────────────────────────
    log('\n── Step 6: Inserting sources ──');
    let sourcesAdded = 0;

    const allTextSources = [...RSS_SOURCES, ...HTML_SOURCES];
    for (const s of allTextSources) {
        const { error } = await sb.from('sources').insert({
            client_id: ODISHA_CLIENT_ID,
            name: s.name,
            url: s.url,
            source_type: s.source_type,
            is_active: true,
        });
        if (error) log(`⚠   Skip (${error.message.substring(0, 40)}): ${s.name}`);
        else { log(`✓   Added [${s.source_type.toUpperCase()}] ${s.name}`); sourcesAdded++; }
    }

    // YouTube channels
    for (const yt of YOUTUBE_SOURCES) {
        const { error } = await sb.from('sources').insert({
            client_id: ODISHA_CLIENT_ID,
            name: yt.name,
            url: yt.url,
            source_type: 'youtube',
            is_active: true,
        });
        if (error) log(`⚠   Skip YT (${error.message.substring(0, 40)}): ${yt.name}`);
        else { log(`✓   Added [YOUTUBE] ${yt.name}`); sourcesAdded++; }
    }
    log(`YouTube: ${YOUTUBE_SOURCES.length} channels inserted`);

    // Google News Auto source
    log('\n── Step 7: Ensuring Google News Auto source ──');
    const { data: existingGnews } = await sb.from('sources')
        .select('id').eq('client_id', ODISHA_CLIENT_ID).eq('source_type', 'google_news').single();
    if (!existingGnews) {
        const { error } = await sb.from('sources').insert({
            client_id: ODISHA_CLIENT_ID,
            name: 'Google News (Auto)',
            url: 'auto',
            source_type: 'google_news',
            is_active: true,
        });
        if (error) log(`⚠ GNews: ${error.message}`);
        else { log('✓ Google News Auto source created'); sourcesAdded++; }
    } else {
        log('✓ Google News Auto source already exists');
    }

    // ── Step 8: Update admin user client_id ─────────────────
    log('\n── Step 8: Updating admin user ──');
    const { error: userErr } = await sb.from('users')
        .update({ client_id: ODISHA_CLIENT_ID, full_name: 'Odisha Govt Admin' })
        .eq('email', 'admin@odisha.gov.in');
    if (userErr) log(`⚠ User update: ${userErr.message}`);
    else log('✓ admin@odisha.gov.in linked to Odisha client');

    log('\n════════════════════════════════════════');
    log('Odisha Government feed setup complete.');
    log(`Brief ID: ${brief.id}`);
    log(`Keywords: ${KEYWORDS.length}`);
    log(`Sources added: ${sourcesAdded}`);
    log('════════════════════════════════════════');
    process.exit(0);
}

run().catch(e => { console.error('[seed-odisha] Fatal:', e.message); process.exit(1); });
