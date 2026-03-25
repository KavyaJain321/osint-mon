// ============================================================
// ROBIN OSINT — Batch Title Translator
// Finds articles where title_en IS NULL and translates them
// to English using Groq. Runs daily via cron and on-demand
// via POST /api/admin/migrate/translate-titles.
// ============================================================

import { groqChat } from '../lib/groq.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

const BATCH_SIZE = 20;

/**
 * Translate all articles missing title_en.
 * Paginates until every article is covered.
 * English-only titles are copied directly without an API call.
 *
 * @returns {Promise<{ translated: number, copied: number, failed: number }>}
 */
export async function translateMissingTitles() {
    log.ai.info('[TitleTranslator] Starting batch translation of missing titles');

    let offset = 0;
    let translated = 0;
    let copied = 0;
    let failed = 0;

    while (true) {
        const { data: articles, error } = await supabase
            .from('articles')
            .select('id, title')
            .is('title_en', null)
            .not('title', 'is', null)
            .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
            log.ai.error('[TitleTranslator] DB fetch failed', { error: error.message });
            break;
        }
        if (!articles || articles.length === 0) break;

        // Non-Latin script detection (Odia, Devanagari, Gujarati, etc.)
        const NON_LATIN = /[\u0B00-\u0B7F\u0900-\u097F\u0A80-\u0AFF\u0C00-\u0C7F]/;
        const needsTranslation = articles.filter(a => NON_LATIN.test(a.title));
        const alreadyEnglish  = articles.filter(a => !NON_LATIN.test(a.title));

        // Copy English titles directly — no API call
        for (const a of alreadyEnglish) {
            const { error: upErr } = await supabase
                .from('articles').update({ title_en: a.title }).eq('id', a.id);
            if (!upErr) copied++;
        }

        // Batch-translate non-English titles via Groq
        if (needsTranslation.length > 0) {
            try {
                const wordList = needsTranslation.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
                const response = await groqChat([
                    {
                        role: 'system',
                        content: 'You are a professional translator. Translate each numbered news headline to English. Return ONLY a JSON array of strings in the same order. No explanations, no numbering in output.',
                    },
                    {
                        role: 'user',
                        content: `Translate these news article titles to English. If already English, copy as-is.\n\n${wordList}\n\nReturn ONLY: ["english title 1","english title 2",...]`,
                    },
                ], { temperature: 0.1, max_tokens: 1500 });

                const raw = response.choices[0]?.message?.content || '[]';
                const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                const translations = JSON.parse(cleaned);

                for (let i = 0; i < needsTranslation.length; i++) {
                    const en = translations[i];
                    if (en && typeof en === 'string' && en.trim()) {
                        const { error: upErr } = await supabase
                            .from('articles')
                            .update({ title_en: en.trim() })
                            .eq('id', needsTranslation[i].id);
                        if (!upErr) translated++; else failed++;
                    } else {
                        failed++;
                    }
                }
            } catch (groqErr) {
                log.ai.warn('[TitleTranslator] Groq batch failed, skipping batch', {
                    error: groqErr.message?.substring(0, 80),
                    count: needsTranslation.length,
                });
                failed += needsTranslation.length;
            }
        }

        offset += BATCH_SIZE;

        // Small delay to respect Groq rate limits
        await new Promise(r => setTimeout(r, 800));
    }

    log.ai.info('[TitleTranslator] Complete', { translated, copied, failed });
    return { translated, copied, failed };
}
