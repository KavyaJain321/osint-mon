// ============================================================
// Fix Newspaper RSS URLs: Update major Odisha papers to working RSS feeds
// Run with: node --dns-result-order=ipv4first scripts/fix-newspaper-sources.js
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// Source updates mapping [partial name match] -> new URL
const UPDATES = {
    'Sambad': 'https://www.sambad.in/feed/',
    'Dharitri': 'https://www.dharitri.com/feed/',
    'Samaja': 'https://thesamaja.in/feed/',
    'Pragativadi': 'https://pragativadi.com/feed/',
    'Orissa Post': 'https://www.orissapost.com/feed/',
    'New Indian Express': 'https://www.newindianexpress.com/rss/states/odisha',
    'OTV': 'https://otv.in/feed',
    'Kalinga TV': 'https://kalingatv.com/feed/',
    'Argus News': 'https://argusnews.in/rss/odisha',
    'Odisha Bhaskar': 'https://odishabhaskar.in/feed/'
};

async function main() {
    console.log('Fetching active sources for Odisha papers...');

    const { data: sources, error } = await supabase
        .from('sources')
        .select('id, name, url')
        .eq('is_active', true);

    if (error) {
        console.error('Failed to fetch sources:', error.message);
        process.exit(1);
    }

    console.log(`Total active sources to check: ${sources.length}`);

    let updatedCount = 0;
    for (const source of sources) {
        const matchKey = Object.keys(UPDATES).find(key => source.name.includes(key));
        
        if (matchKey) {
            const newUrl = UPDATES[matchKey];
            if (source.url !== newUrl) {
                console.log(`Updating [${source.name}]: ${source.url} -> ${newUrl}`);
                const { error: updateError } = await supabase
                    .from('sources')
                    .update({ url: newUrl, source_type: 'rss' })
                    .eq('id', source.id);
                
                if (updateError) {
                    console.error(`  Error updating ${source.name}:`, updateError.message);
                } else {
                    updatedCount++;
                }
            } else {
                console.log(`[${source.name}] already has correct URL: ${newUrl}`);
            }
        }
    }

    // Check if any major ones are MISSING and suggest adding them
    const existingNames = sources.map(s => s.name);
    const missing = Object.keys(UPDATES).filter(name => !existingNames.some(en => en.includes(name)));
    
    if (missing.length > 0) {
        console.log(`\nMajor Odisha sources missing in DB: ${missing.join(', ')}`);
    }

    console.log(`\n✅ Done! Updated ${updatedCount} sources.`);
}

main().catch(console.error);
