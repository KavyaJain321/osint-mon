import dotenv from 'dotenv';
dotenv.config();
import { supabase } from './src/lib/supabase.js';

async function main() {
    // Find clips that explicitly admit they failed to find the keyword or are hallucinating
    const { data: badClips, error } = await supabase
        .from('video_clips')
        .select('article_id')
        .or('ai_summary.ilike.%no mention%,ai_summary.ilike.%jumbled%,ai_summary.ilike.%does not mention%,ai_summary.ilike.%not mentioned%');
        
    if (error) {
        console.error('Error fetching clips:', error);
        return;
    }
        
    if (badClips && badClips.length > 0) {
        const articleIds = [...new Set(badClips.map(c => c.article_id))];
        console.log(`Found ${articleIds.length} videos containing self-aware garbage summaries. Purging them...`);
        
        // Deleting from content_items cascades to video_clips and video_transcripts
        const res1 = await supabase.from('content_items').delete().in('id', articleIds);
        const res2 = await supabase.from('articles').delete().in('id', articleIds);
        
        console.log('Cleanup complete. The frontend dashboard should now be clean of these videos.');
    } else {
        console.log('No garbage clips found. The DB is already clean.');
    }
}

main().then(() => process.exit(0)).catch(console.error);
