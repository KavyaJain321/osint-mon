import '../config.js';
import { supabase } from '../lib/supabase.js';
import { crawlYoutubeSource } from './youtube-crawler.js';
import { runYoutubeKeywordSearch } from './youtube-search-crawler.js';
import { log } from '../lib/logger.js';
import { buildTopicWords } from '../services/keyword-matcher.js';

async function getClientKeywords(clientId) {
    const { data: activeBrief } = await supabase
        .from('client_briefs')
        .select('id')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    if (!activeBrief) return [];
    
    const { data: keywords } = await supabase
        .from('brief_generated_keywords')
        .select('keyword')
        .eq('brief_id', activeBrief.id)
        .limit(300);
    return (keywords || []).map((k) => k.keyword);
}

async function runVideosOnly() {
    log.scraper.info('Starting manual VIDEO ONLY scraper run...');
    
    try {
        const { data: sources } = await supabase
            .from('sources')
            .select('id, client_id, name, url, source_type, last_scraped_at')
            .eq('is_active', true)
            .eq('source_type', 'youtube')
            .limit(100);
            
        const clientIds = [...new Set((sources || []).map(s => s.client_id))];
        const clientKeywordMap = {};
        
        for (const cid of clientIds) {
            const kws = await getClientKeywords(cid);
            if (kws.length > 0) {
                clientKeywordMap[cid] = { keywords: kws, clientId: cid };
            }
        }
        
        // 1. Run Channel sources
        if (sources && sources.length > 0) {
            log.scraper.info(`Processing ${sources.length} YouTube channels...`);
            for (const src of sources) {
                if (clientKeywordMap[src.client_id]) {
                    src.keywords = clientKeywordMap[src.client_id].keywords;
                    await crawlYoutubeSource(src, src.keywords);
                }
            }
        }
        
        // 2. Run Keyword Search
        log.scraper.info('Processing YouTube keyword search...');
        await runYoutubeKeywordSearch(clientKeywordMap);
        
        // Wait for video queue to drain
        log.scraper.info('Waiting 10 seconds for video queue processing to start...');
        await new Promise(r => setTimeout(r, 10000));
        
        log.scraper.info('Video ingestion triggered successfully. Check logs for translation pipeline progress.');
        
    } catch (e) {
        log.scraper.error('Video run failed', { error: e.message });
    }
}

runVideosOnly();
