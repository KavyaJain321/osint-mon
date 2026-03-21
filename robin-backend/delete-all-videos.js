import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function deleteAll() {
    console.log("Fetching and deleting ALL videos from the database...");
    
    // 1. Delete all video content_items
    let { data: contentVids } = await supabase.from('content_items').select('id').eq('content_type', 'video');
    if (contentVids && contentVids.length > 0) {
        let count = 0;
        for (let v of contentVids) {
            await supabase.from('content_items').delete().eq('id', v.id);
            count++;
        }
        console.log(`Deleted ${count} videos from content_items.`);
    } else {
        console.log(`No videos found in content_items.`);
    }
    
    // 2. Delete all legacy video articles
    let { data: legacyVids } = await supabase.from('articles').select('id, url').ilike('url', '%youtube.com%');
    if (legacyVids && legacyVids.length > 0) {
        let count = 0;
        for (let v of legacyVids) {
            await supabase.from('articles').delete().eq('id', v.id);
            count++;
        }
        console.log(`Deleted ${count} YouTube videos from legacy articles table.`);
    } else {
        console.log(`No YouTube videos found in legacy articles table.`);
    }
    
    console.log("Database completely scrubbed of all videos! Starting fresh.");
}

deleteAll().catch(console.error);
