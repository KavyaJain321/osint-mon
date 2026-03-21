import dotenv from 'dotenv';
dotenv.config();

import ffmpegPath from 'ffmpeg-static';
process.env.FFMPEG_PATH = ffmpegPath;

import { supabase } from './src/lib/supabase.js';
import { saveContent } from './src/services/content-saver.js';
import { translateToEnglish } from './src/services/video-processor/translation-service.js';

async function main() {
    console.log('=== ROBIN OSINT AD-HOC YOUTUBE BATCH ===');
    
    // Get the first active brief
    const { data: activeBrief } = await supabase
        .from('client_briefs')
        .select('id, client_id')
        .eq('status', 'active')
        .limit(1)
        .single();
        
    // Fetch keywords
    const { data: keywords } = await supabase
        .from('brief_generated_keywords')
        .select('keyword')
        .eq('brief_id', activeBrief.id);
        
    const kwArray = keywords.map(k => k.keyword);
    console.log(`Keywords to filter by: ${kwArray.join(', ')}`);
    
    // Fetch active youtube sources
    const { data: sources } = await supabase
        .from('sources')
        .select('*')
        .eq('source_type', 'youtube')
        .eq('is_active', true)
        .eq('client_id', activeBrief.client_id);
    
    let totalSaved = 0;
    
    for (const source of sources) {
        console.log(`\nCrawling channel: ${source.name}...`);
        
        // Resolve channel ID roughly
        let channelId = null;
        if (source.url.includes('channel/UC')) {
            channelId = source.url.match(/channel\/(UC[a-zA-Z0-9_-]+)/)[1];
        } else {
            console.log(`Fetching HTML to find channel ID for ${source.url}...`);
            const html = await (await fetch(source.url)).text();
            const m = html.match(/"externalId":"(UC[a-zA-Z0-9_-]+)"/);
            if (m) channelId = m[1];
        }
        
        if (!channelId) {
            console.log('Could not resolve channel ID. Skipping.');
            continue;
        }
        
        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const xml = await (await fetch(feedUrl)).text();
        
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        
        // Collect up to 25 latest entries
        const entries = [];
        while ((match = entryRegex.exec(xml)) !== null && entries.length < 25) { 
            entries.push(match[1]);
        }
        
        console.log(`Fetched ${entries.length} latest videos. Translating & Filtering titles...`);
        
        // Process sequentially to be gentle on API rate limits while translating
        for (const entry of entries) {
            const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1]?.trim();
            const rawTitle = entry.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
            const rawDesc = entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '';
            const pubDateStr = entry.match(/<published>(.*?)<\/published>/)?.[1]?.trim() ?? null;
            
            if (!videoId) continue;
            
            const title = rawTitle.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            
            // Skip livestreams
            if (/🔴|\bLIVE\b/i.test(title)) continue;
            
            // Compress text for translation speed
            const titleAndDesc = `${title} - ${rawDesc.substring(0, 100)}`;
            
            // ── PRE-FILTER LOGIC ───────────────────
            let englishTitleDesc = titleAndDesc;
            try {
                // Translate Odia title to English
                englishTitleDesc = await translateToEnglish(titleAndDesc, 'or');
            } catch (e) {
                // keep original on error
            }
            
            // Check against keywords (case insensitive)
            const textToSearch = `${titleAndDesc} ${englishTitleDesc}`.toLowerCase();
            const matchedKws = kwArray.filter(kw => textToSearch.includes(kw.toLowerCase()));
            
            if (matchedKws.length === 0) {
                continue; // Skip saving!
            }
            
            console.log(`✅ Passed Filter: "${title}" -> matches [${matchedKws.join(', ')}]`);
            // ──────────────────────────────────────────
            
            const thumb = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
            const randomId = Math.floor(Math.random() * 1000000);
            
            const saveRes = await saveContent({
                contentType: 'video',
                title: `[VIDEO] ${title} [FRESH-${randomId}]`,
                content: rawDesc || title,
                url: `https://www.youtube.com/watch?v=${videoId}&fresh=${randomId}`,
                publishedAt: pubDateStr ? new Date(pubDateStr) : new Date(),
                sourceId: source.id,
                clientId: activeBrief.client_id,
                matchedKeywords: matchedKws, // Only pass the explicitly matched keywords!
                typeMetadata: {
                    channel_name: source.name,
                    image_url: thumb,
                    processing_status: 'queued',
                    processing_message: 'Queued for transcription and clip generation',
                }
            });
            
            if (saveRes.saved) {
                totalSaved++;
                // Fire pipeline
                try {
                    const { processVideo } = await import('./src/services/video-processor/pipeline.js');
                    // Pass ENTIRE kwArray to pipeline so it searches the transcript for ALL tracked keywords
                    processVideo(videoId, saveRes.contentId, kwArray).catch(e => console.error(e));
                } catch(e) {}
            }
        }
    }
    
    console.log(`\nAd-Hoc Ingest complete. Saved ${totalSaved} highly-relevant videos out of all checked.`);
    if (totalSaved > 0) {
        console.log('Video pipeline running in background. Giving it 15 minutes to complete processVideo tasks...');
        setTimeout(() => process.exit(0), 15 * 60 * 1000);
    } else {
        process.exit(0);
    }
}

main().catch(console.error);
