// ============================================================
// Deactivate dead browser and YouTube sources that always fail
// Run with: node --dns-result-order=ipv4first scripts/cleanup-dead-sources.js
// ============================================================
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// Dead URLs that always error — domains don't exist or block scrapers
const DEAD_URLS = [
    'odishanewsportal.in',       // ERR_NAME_NOT_RESOLVED
    'odishanewsinsight.com',     // dead site
    'chronicle.gm',             // fetch failed
    'gaborearth',               // wrong YouTube channel
    'CNNClimate',               // doesn't exist
    'indiatoday.in',            // blocks headless browsers (30s timeout)
    'freemalaysiatoday.com',    // junk - not India
    'malaysiakini.com',         // junk - not India
    'thefourthestategh.com',    // Ghana - not India
    'premiumtimesng.com',       // Nigeria - not India
    'myjoyonline.com',          // Ghana - not India
    'radioecclesia.org',        // Angola - not India
    'thetyee.ca',               // Canada - not India
    'pacificnews.org',          // Pacific - not India
    'thestar.com.my',           // Malaysia - not India
    'theglobeandmail.com',      // Canada - not India
    'netra.news',               // Bangladesh
    'thedailystar.net',         // Bangladesh
    'en.prothomalo.com',        // Bangladesh
    'nation.com.pk',            // Pakistan
    'scmp.com',                 // Hong Kong
    'thestar.com',              // Canada
    'theguardian.com/au',       // Australia
    'theeastafrican.co.ke',     // East Africa
    'nation.co.ke',             // Kenya
    'thenews.com.pk',           // Pakistan
    'brecorder.com',            // Pakistan
    'dawn.com',                 // Pakistan
    'bbc.com/urdu',             // Urdu - not Odisha
];

async function main() {
    console.log('Fetching all active sources...');
    const { data: sources, error } = await supabase
        .from('sources')
        .select('id, name, url, source_type')
        .eq('is_active', true);

    if (error) { console.error(error.message); process.exit(1); }
    console.log(`Active sources: ${sources.length}`);

    const toDeactivate = sources.filter(s => 
        DEAD_URLS.some(dead => s.url.includes(dead))
    );

    console.log(`Sources to deactivate: ${toDeactivate.length}`);
    toDeactivate.forEach(s => console.log(`  ❌ ${s.name} → ${s.url}`));

    if (toDeactivate.length === 0) {
        console.log('No dead sources found!');
        process.exit(0);
    }

    const ids = toDeactivate.map(s => s.id);
    const { error: updateError } = await supabase
        .from('sources')
        .update({ is_active: false })
        .in('id', ids);

    if (updateError) {
        console.error('Update failed:', updateError.message);
    } else {
        console.log(`\n✅ Deactivated ${toDeactivate.length} dead sources.`);
    }
}

main().catch(console.error);
