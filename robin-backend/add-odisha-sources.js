// ============================================================
// ROBIN OSINT — Seed Odisha Regional News Sources
// Adds Odisha-specific RSS/HTML sources to the database
// for the "Government of Odisha" client.
//
// Run: node add-odisha-sources.js
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

// Odisha-specific regional sources
const ODISHA_SOURCES = [
    // ── Top Odisha English news portals ──────────────────────
    {
        name: 'OdishaTV',
        url: 'https://odishatv.in',
        source_type: 'html',
    },
    {
        name: 'OdishaTV RSS',
        url: 'https://odishatv.in/feed',
        source_type: 'rss',
    },
    {
        name: 'The Odisha Post',
        url: 'https://theodishapost.com',
        source_type: 'html',
    },
    {
        name: 'Orissa POST',
        url: 'https://www.orissapost.com/feed/',
        source_type: 'rss',
    },
    {
        name: 'Pragativadi (English)',
        url: 'https://pragativadi.com/feed',
        source_type: 'rss',
    },
    {
        name: 'Kalinga TV',
        url: 'https://kalingatv.com/feed/',
        source_type: 'rss',
    },
    {
        name: 'Eastern India Herald',
        url: 'https://easternindiaherald.com/feed/',
        source_type: 'rss',
    },
    // ── Govt / PIB ────────────────────────────────────────────
    {
        name: 'PIB Odisha (Press Information Bureau)',
        url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1',
        source_type: 'rss',
    },
    {
        name: 'Odisha Government Official Site',
        url: 'https://odisha.gov.in',
        source_type: 'browser',
    },
    // ── National sources with Odisha tags ────────────────────
    {
        name: 'The Hindu - Odisha',
        url: 'https://www.thehindu.com/news/national/odisha/feeder/default.rss',
        source_type: 'rss',
    },
    {
        name: 'Times of India - Odisha',
        url: 'https://timesofindia.indiatimes.com/rssfeeds/11811490.cms',
        source_type: 'rss',
    },
    {
        name: 'NDTV - Odisha',
        url: 'https://feeds.feedburner.com/ndtvnews-odisha',
        source_type: 'rss',
    },
    {
        name: 'India Today - Odisha',
        url: 'https://www.indiatoday.in/rss/1206578',
        source_type: 'rss',
    },
];

async function seedOdishaSources() {
    console.log('🌏 Seeding Odisha regional news sources...\n');

    // 1. Find the Government of Odisha client
    const { data: clients, error: clientErr } = await supabase
        .from('clients')
        .select('id, name')
        .ilike('name', '%odisha%');

    if (clientErr) {
        console.error('❌ Failed to query clients:', clientErr.message);
        process.exit(1);
    }

    if (!clients || clients.length === 0) {
        console.error('❌ No Odisha client found in the clients table.');
        console.error('   Make sure the client exists first.');
        process.exit(1);
    }

    console.log('👥 Found Odisha client(s):');
    clients.forEach(c => console.log(`   • ${c.name} (${c.id})`));
    console.log('');

    // Use the first Odisha client found
    const client = clients[0];

    // 2. Get existing source URLs for this client
    const { data: existing } = await supabase
        .from('sources')
        .select('url, name')
        .eq('client_id', client.id);

    const existingUrls = new Set(
        (existing || []).map(s => s.url.toLowerCase().replace(/\/+$/, ''))
    );

    console.log(`📋 Existing sources: ${existing?.length || 0}`);
    console.log('');

    // 3. Filter to only new sources
    const newSources = ODISHA_SOURCES
        .filter(s => !existingUrls.has(s.url.toLowerCase().replace(/\/+$/, '')))
        .map(s => ({
            ...s,
            client_id: client.id,
            is_active: true,
        }));

    if (newSources.length === 0) {
        console.log('✅ All Odisha sources already exist — nothing to add.');
        process.exit(0);
    }

    console.log(`➕ Adding ${newSources.length} new sources:`);
    newSources.forEach(s => console.log(`   • [${s.source_type}] ${s.name}`));
    console.log('');

    // 4. Insert in batches
    const BATCH = 20;
    let totalAdded = 0;
    let totalFailed = 0;

    for (let i = 0; i < newSources.length; i += BATCH) {
        const batch = newSources.slice(i, i + BATCH);
        const { data, error } = await supabase.from('sources').insert(batch).select('id, name');
        if (error) {
            console.error(`❌ Batch insert error: ${error.message}`);
            totalFailed += batch.length;
        } else {
            totalAdded += (data || []).length;
        }
    }

    console.log(`\n✅ Done! Added ${totalAdded} source(s), failed ${totalFailed}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Trigger a new scrape from the Odisha dashboard (or wait for hourly cron)');
    console.log('  2. Check Render logs for "HTML crawl complete" / "RSS crawl complete" from the new sources');
    console.log('  3. Query: SELECT count(*) FROM articles WHERE client_id = \'' + client.id + '\';');

    process.exit(0);
}

seedOdishaSources().catch(err => {
    console.error('Unexpected error:', err.message);
    process.exit(1);
});
