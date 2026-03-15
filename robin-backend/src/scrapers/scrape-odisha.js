// Targeted Odisha scraper — only crawls sources assigned to the Odisha client
import '../config.js';
import { supabase } from '../lib/supabase.js';
import { crawlRssSource } from './rss-crawler.js';
import { crawlHtmlSource } from './html-crawler.js';
import { crawlYoutubeSource } from './youtube-crawler.js';
import { scrapeGoogleNews } from './gnews-crawler.js';
import { scrapeReddit } from './reddit-crawler.js';
import { log } from '../lib/logger.js';

const ODISHA_CLIENT_ID = '7b5390a0-0d5b-419e-84b4-533fd9c44d36';

async function getOdishaKeywords() {
    // Get active brief for Odisha
    const { data: brief } = await supabase
        .from('client_briefs')
        .select('id, title')
        .eq('client_id', ODISHA_CLIENT_ID)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

    if (!brief || brief.length === 0) {
        console.error('No active brief found for Odisha client!');
        return [];
    }

    console.log(`Active brief: "${brief[0].title}" (${brief[0].id})`);

    const { data: keywords } = await supabase
        .from('brief_generated_keywords')
        .select('keyword')
        .eq('brief_id', brief[0].id);

    const kws = keywords?.map(k => k.keyword) || [];
    console.log(`Keywords loaded: ${kws.length}`);
    console.log(`Sample: ${kws.slice(0, 15).join(', ')}`);
    return kws;
}

async function scrapeOdisha() {
    console.log('=== Targeted Odisha Scrape ===\n');

    const keywords = await getOdishaKeywords();
    if (keywords.length === 0) {
        console.error('No keywords — aborting');
        process.exit(1);
    }

    // Get all active Odisha sources
    const { data: sources } = await supabase
        .from('sources')
        .select('id, client_id, name, url, source_type, last_scraped_at')
        .eq('client_id', ODISHA_CLIENT_ID)
        .eq('is_active', true);

    console.log(`\nActive Odisha sources: ${sources?.length || 0}`);

    if (!sources || sources.length === 0) {
        console.error('No active sources for Odisha!');
        process.exit(1);
    }

    // Group by type
    const byType = {};
    sources.forEach(s => {
        if (!byType[s.source_type]) byType[s.source_type] = [];
        byType[s.source_type].push(s);
    });
    Object.entries(byType).forEach(([type, srcs]) => {
        console.log(`  ${type}: ${srcs.length} sources`);
    });

    let totalSaved = 0;
    let totalFound = 0;
    let totalErrors = 0;

    // Process RSS sources first (fastest)
    for (const source of (byType.rss || [])) {
        try {
            console.log(`\n[RSS] ${source.name}...`);
            const result = await crawlRssSource(
                { ...source, briefSource: true, topicWords: new Set(keywords.flatMap(k => k.toLowerCase().split(/\s+/))) },
                keywords
            );
            totalFound += result.articlesFound;
            totalSaved += result.articlesSaved;
            totalErrors += result.errors.length;
            console.log(`  Found: ${result.articlesFound} | Saved: ${result.articlesSaved}`);
        } catch (e) {
            console.error(`  Error: ${e.message}`);
            totalErrors++;
        }
    }

    // Process HTML sources
    for (const source of (byType.html || []).slice(0, 30)) {
        try {
            console.log(`\n[HTML] ${source.name}...`);
            const result = await crawlHtmlSource(
                { ...source, briefSource: true, topicWords: new Set(keywords.flatMap(k => k.toLowerCase().split(/\s+/))) },
                keywords
            );
            totalFound += result.articlesFound;
            totalSaved += result.articlesSaved;
            totalErrors += result.errors.length;
            console.log(`  Found: ${result.articlesFound} | Saved: ${result.articlesSaved}`);
        } catch (e) {
            console.error(`  Error: ${e.message}`);
            totalErrors++;
        }
    }

    // Process YouTube sources
    for (const source of (byType.youtube || [])) {
        try {
            console.log(`\n[YT] ${source.name}...`);
            const result = await crawlYoutubeSource(source, keywords);
            totalFound += result.articlesFound;
            totalSaved += result.articlesSaved;
            console.log(`  Found: ${result.articlesFound} | Saved: ${result.articlesSaved}`);
        } catch (e) {
            console.error(`  Error: ${e.message}`);
            totalErrors++;
        }
    }

    // Process Google News
    for (const source of (byType.google_news || [])) {
        try {
            console.log(`\n[GNEWS] ${source.name}...`);
            await scrapeGoogleNews(source, ODISHA_CLIENT_ID, keywords);
        } catch (e) {
            console.error(`  Error: ${e.message}`);
            totalErrors++;
        }
    }

    // Process Reddit
    for (const source of (byType.reddit || [])) {
        try {
            console.log(`\n[REDDIT] ${source.name}...`);
            await scrapeReddit(source, ODISHA_CLIENT_ID, keywords);
        } catch (e) {
            console.error(`  Error: ${e.message}`);
            totalErrors++;
        }
    }

    console.log('\n=== RESULTS ===');
    console.log(`Total found: ${totalFound}`);
    console.log(`Total saved: ${totalSaved}`);
    console.log(`Total errors: ${totalErrors}`);

    // Check final article count
    const { count } = await supabase
        .from('articles')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', ODISHA_CLIENT_ID);
    console.log(`\nOdisha articles in DB: ${count}`);

    process.exit(0);
}

scrapeOdisha().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
