// Remove all briefs & keywords EXCEPT the Odisha brief
// Also deactivate non-Odisha clients so they don't trigger scraping
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ODISHA_CLIENT_ID = '7b5390a0-0d5b-419e-84b4-533fd9c44d36';

async function main() {
    // 1. Get all briefs NOT belonging to Odisha
    const { data: otherBriefs } = await supabase
        .from('client_briefs')
        .select('id, title, client_id')
        .neq('client_id', ODISHA_CLIENT_ID);

    console.log(`Found ${otherBriefs.length} non-Odisha brief(s) to remove:`);
    for (const b of otherBriefs) {
        console.log(`  ❌ "${b.title}" (client: ${b.client_id})`);
    }

    if (otherBriefs.length > 0) {
        const briefIds = otherBriefs.map(b => b.id);

        // Delete keywords first (FK)
        const { error: kwErr } = await supabase
            .from('brief_generated_keywords')
            .delete()
            .in('brief_id', briefIds);
        if (kwErr) console.error('  Keyword delete error:', kwErr.message);
        else console.log(`  ✅ Deleted keywords for ${briefIds.length} brief(s)`);

        // Delete the briefs themselves
        const { error: bErr } = await supabase
            .from('client_briefs')
            .delete()
            .in('id', briefIds);
        if (bErr) console.error('  Brief delete error:', bErr.message);
        else console.log(`  ✅ Deleted ${briefIds.length} brief(s)`);
    }

    // 2. Deactivate sources from other clients so scraper doesn't process them
    const { data: otherSources } = await supabase
        .from('sources')
        .select('id, name, client_id')
        .neq('client_id', ODISHA_CLIENT_ID)
        .eq('is_active', true);

    if (otherSources && otherSources.length > 0) {
        console.log(`\nDeactivating ${otherSources.length} non-Odisha source(s)...`);
        const { error: srcErr } = await supabase
            .from('sources')
            .update({ is_active: false })
            .neq('client_id', ODISHA_CLIENT_ID);
        if (srcErr) console.error('  Source deactivate error:', srcErr.message);
        else console.log(`  ✅ Deactivated ${otherSources.length} source(s)`);
    }

    // 3. Verify remaining
    const { data: remaining } = await supabase
        .from('client_briefs')
        .select('id, title, status, client_id');
    console.log(`\n=== REMAINING BRIEFS ===`);
    for (const b of remaining) {
        console.log(`  ✅ "${b.title}" (status: ${b.status})`);
    }

    const { data: activeSources } = await supabase
        .from('sources')
        .select('id')
        .eq('is_active', true);
    console.log(`\nActive sources remaining: ${activeSources.length} (all Odisha)`);
}

main().catch(console.error);
