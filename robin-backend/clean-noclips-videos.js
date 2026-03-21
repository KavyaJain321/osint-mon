import dotenv from 'dotenv';
dotenv.config();
import { supabase } from './src/lib/supabase.js';

async function main() {
    // Find all videos that have 0 clips 
    // Wait, we query content_items of type video, then see if they have clips
    const { data: transcripts, error } = await supabase
        .from('video_transcripts')
        .select('article_id');
        
    if (error) return console.error('Error fetching transcripts:', error);
    
    const { data: clips } = await supabase.from('video_clips').select('article_id');
    const clipArticleIds = new Set(clips.map(c => c.article_id));
    
    const noClipArticleIds = transcripts.filter(t => !clipArticleIds.has(t.article_id)).map(t => t.article_id);
    
    if (noClipArticleIds.length > 0) {
        console.log(`Found ${noClipArticleIds.length} videos with NO PLAYABLE CLIPS (dangling timestamps). Purging them...`);
        await supabase.from('content_items').delete().in('id', noClipArticleIds);
        await supabase.from('articles').delete().in('id', noClipArticleIds);
        console.log('Cleanup complete.');
    } else {
        console.log('No zero-clip videos found. The DB is already clean.');
    }
}

main().then(() => process.exit(0)).catch(console.error);
