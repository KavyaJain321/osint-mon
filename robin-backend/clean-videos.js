import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', 'robin-backend', '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
    console.log("Fetching all videos...");
    const { data: vids } = await supabase.from('content_items').select('id').eq('content_type', 'video');
    const { data: legacyVids } = await supabase.from('articles').select('id, url').ilike('url', '%youtube.com%');
    
    // Find all transcripts
    const { data: transcripts } = await supabase.from('video_transcripts').select('article_id');
    const processedIds = new Set((transcripts || []).map(t => t.article_id));
    
    // Find all clips
    const { data: clips } = await supabase.from('video_clips').select('article_id');
    const clipIds = new Set((clips || []).map(c => c.article_id));
    
    let deleted = 0;
    
    if (vids) {
        for (const v of vids) {
            if (processedIds.has(v.id) && !clipIds.has(v.id)) {
                await supabase.from('content_items').delete().eq('id', v.id);
                console.log(`Deleted irrelevant video: ${v.id}`);
                deleted++;
            }
        }
    }
    
    if (legacyVids) {
        for (const v of legacyVids) {
            if (processedIds.has(v.id) && !clipIds.has(v.id)) {
                await supabase.from('articles').delete().eq('id', v.id);
                console.log(`Deleted irrelevant legacy video: ${v.id}`);
                deleted++;
            }
        }
    }
    
    console.log(`Deleted ${deleted} processed videos that had no keyword clips.`);
}

clean().catch(console.error);
