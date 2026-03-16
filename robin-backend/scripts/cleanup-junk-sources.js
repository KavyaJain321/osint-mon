// ============================================================
// One-time cleanup: Remove all non-India/non-Odisha sources
// from the database that were hallucinated by the LLM.
// Run with: node --dns-result-order=ipv4first scripts/cleanup-junk-sources.js
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// These are the ONLY domains we want to KEEP for the Odisha client.
// Everything else gets deleted.
const SAFE_DOMAINS = [
    // Odisha local media
    'sambad.in', 'prameyanews7.com', 'dharitri.com', 'thesamaja.in',
    'pragativadi.com', 'odishabhaskar.in', 'orissapost.com',
    'kalingatv.com', 'otv.in',
    // India national
    'ndtv.com', 'thehindu.com', 'indiatoday.in', 'scroll.in',
    'thewire.in', 'hindustantimes.com', 'timesofindia.indiatimes.com',
    'economictimes.indiatimes.com', 'deccanherald.com', 'ptinews.com',
    'indianexpress.com', 'newindianexpress.com', 'news18.com',
    'telegraphindia.com',
    // India government
    'pib.gov.in', 'rbi.org.in',
    // Google News RSS (India-specific)
    'news.google.com',
    // YouTube (safe channels)
    'youtube.com',
    // Reddit
    'reddit.com',
    // BBC/Reuters (global baseline — minimal)
    'bbc.co.uk', 'bbci.co.uk', 'reuters.com', 'apnews.com',
];

function isSafe(url) {
    try {
        const hostname = new URL(url).hostname.replace('www.', '');
        return SAFE_DOMAINS.some(domain => hostname.includes(domain));
    } catch {
        return false;
    }
}

async function main() {
    console.log('Fetching all active sources...');

    const { data: sources, error } = await supabase
        .from('sources')
        .select('id, name, url, source_type, client_id')
        .eq('is_active', true);

    if (error) {
        console.error('Failed to fetch sources:', error.message);
        process.exit(1);
    }

    console.log(`Total active sources: ${sources.length}`);

    const junkSources = sources.filter(s => !isSafe(s.url));
    const safeSources = sources.filter(s => isSafe(s.url));

    console.log(`\nSafe sources (KEEPING): ${safeSources.length}`);
    safeSources.forEach(s => console.log(`  ✅ ${s.name} → ${s.url}`));

    console.log(`\nJunk sources (DELETING): ${junkSources.length}`);
    junkSources.slice(0, 20).forEach(s => console.log(`  ❌ ${s.name} → ${s.url}`));
    if (junkSources.length > 20) console.log(`  ... and ${junkSources.length - 20} more`);

    if (junkSources.length === 0) {
        console.log('\nNo junk sources found. DB is clean!');
        process.exit(0);
    }

    // Deactivate junk sources (soft delete — set is_active = false)
    const junkIds = junkSources.map(s => s.id);
    const BATCH_SIZE = 50;

    for (let i = 0; i < junkIds.length; i += BATCH_SIZE) {
        const batch = junkIds.slice(i, i + BATCH_SIZE);
        const { error: updateError } = await supabase
            .from('sources')
            .update({ is_active: false })
            .in('id', batch);

        if (updateError) {
            console.error(`Failed to deactivate batch ${i}:`, updateError.message);
        } else {
            console.log(`Deactivated batch ${i + 1}-${Math.min(i + BATCH_SIZE, junkIds.length)}`);
        }
    }

    console.log(`\n✅ Done! Deactivated ${junkSources.length} junk sources. ${safeSources.length} safe sources remain.`);
}

main().catch(console.error);
