import { supabase } from './src/lib/supabase.js';

async function cleanup() {
    console.log('--- CLEANING UP [FRESH] TEST VIDEOS ---');
    
    // 1. Find all videos with [FRESH-] in title or ?fresh= in URL
    const { data: items } = await supabase
        .from('content_items')
        .select('id, title, url')
        .or('title.ilike.%[FRESH-%,url.ilike.%&fresh=%');

    if (!items || items.length === 0) {
        console.log('No [FRESH] test videos found.');
        return;
    }

    console.log(`Found ${items.length} test videos. Purging from database...`);

    const ids = items.map(i => i.id);

    // 2. Delete from all tables to maintain referential integrity
    // (Starting with dependent tables)
    await supabase.from('video_clips').delete().in('article_id', ids);
    await supabase.from('video_transcripts').delete().in('article_id', ids);
    await supabase.from('articles').delete().in('id', ids);
    await supabase.from('content_items').delete().in('id', ids);

    console.log('✅ Cleanup complete! Your dashboard is now clean.');
}

cleanup();
