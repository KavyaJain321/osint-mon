// Quick cleanup script: remove overly-broad keywords from the active brief
// These single-word generic terms match ANY global news and pull in unrelated articles/videos
// (e.g., Trump/Iran/Pune stories matching "coverup", "crackdown", "collapse" etc.)
//
// Run: node scripts/cleanup-keywords.js

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Keywords that are TOO GENERIC — they match any global news headline
// and cause unrelated articles to appear (Trump, Pune crashes, Iran war, etc.)
const KEYWORDS_TO_REMOVE = [
    // Generic crisis/scandal words — match everything
    'meltdown', 'collapse', 'turmoil', 'outage', 'scandal', 'leak',
    'coverup', 'crackdown', 'probe', 'whistleblower', 'shakeup', 'downturn',
    'default', 'bailout', 'inflation',
    // Overly broad industry terms
    'Banking', 'Finance', 'Network', 'Database', 'Grid', 'Cloud',
    // Overly broad person name
    'Khan',
];

async function main() {
    // Get the active brief
    const { data: clients } = await supabase.from('clients').select('id').limit(1).single();
    if (!clients) { console.error('No client found'); return; }

    const { data: brief } = await supabase
        .from('client_briefs')
        .select('id, title')
        .eq('client_id', clients.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!brief) { console.error('No active brief found'); return; }
    console.log(`Active brief: "${brief.title}" (${brief.id})`);

    // Fetch current keywords
    const { data: keywords } = await supabase
        .from('brief_generated_keywords')
        .select('id, keyword')
        .eq('brief_id', brief.id);

    console.log(`Current keywords: ${keywords.length}`);
    
    const toRemove = keywords.filter(k => 
        KEYWORDS_TO_REMOVE.some(bad => k.keyword.toLowerCase() === bad.toLowerCase())
    );

    if (toRemove.length === 0) {
        console.log('No matching keywords to remove.');
        return;
    }

    console.log(`\nRemoving ${toRemove.length} overly-broad keywords:`);
    toRemove.forEach(k => console.log(`  ❌ "${k.keyword}"`));

    const idsToDelete = toRemove.map(k => k.id);
    const { error } = await supabase
        .from('brief_generated_keywords')
        .delete()
        .in('id', idsToDelete);

    if (error) {
        console.error('Delete failed:', error.message);
    } else {
        console.log(`\n✅ Removed ${toRemove.length} keywords. Remaining: ${keywords.length - toRemove.length}`);
    }

    // Show remaining keywords
    const remaining = keywords.filter(k => !idsToDelete.includes(k.id));
    console.log('\nRemaining keywords:');
    remaining.forEach(k => console.log(`  ✅ "${k.keyword}"`));
}

main().catch(console.error);
