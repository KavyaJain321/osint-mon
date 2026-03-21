import dotenv from 'dotenv';
dotenv.config();

import { supabase } from './src/lib/supabase.js';
import { runYoutubeKeywordSearch } from './src/scrapers/youtube-search-crawler.js';

async function main() {
    console.log('=== ROBIN OSINT LOCAL YOUTUBE BATCH ===');
    console.log('Fetching active brief...');
    
    // Get the first active brief
    const { data: activeBrief } = await supabase
        .from('client_briefs')
        .select('id, client_id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
    if (!activeBrief) {
        console.log('No active brief found.');
        process.exit(0);
    }
    
    console.log(`Found Active Brief ID: ${activeBrief.id} (Client: ${activeBrief.client_id})`);
    
    // Fetch keywords
    const { data: keywords } = await supabase
        .from('brief_generated_keywords')
        .select('keyword')
        .eq('brief_id', activeBrief.id)
        .limit(20);
        
    const kwArray = keywords.map(k => k.keyword);
    console.log(`Using ${kwArray.length} keywords for discovery.`);
    
    const clientKeywordMap = {
        [activeBrief.client_id]: {
            clientId: activeBrief.client_id,
            keywords: kwArray
        }
    };
    
    console.log('\nStarting YouTube Data API Search...');
    const result = await runYoutubeKeywordSearch(clientKeywordMap);
    
    console.log(`\nSearch Complete. Found ${result.totalFound} videos, saved ${result.totalSaved} new videos.`);
    
    if (result.totalSaved > 0) {
        console.log('Video pipeline (yt-dlp + whisper) is now processing these videos in the background.');
        console.log('Leaving process open for 10 minutes to allow pipeline to finish...');
        
        // Wait 10 minutes for background processVideo promises to finish
        setTimeout(() => {
            console.log('Timeout reached. Exiting.');
            process.exit(0);
        }, 10 * 60 * 1000);
    } else {
        console.log('No new videos saved. Exiting immediately.');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
