// ============================================================
// ROBIN OSINT — Video Processing Pipeline Orchestrator
// Chains: transcription → keyword search → clip generation → AI summaries
// Runs fire-and-forget after video save. Keyword flows through every step.
// ============================================================

import { transcribeVideo } from './transcription-service.js';
import { isNonEnglishLanguage, translateToEnglish } from './translation-service.js';
import { searchMultipleKeywords } from './search-service.js';
import { calculateClipWindows, generateClips } from './clip-generator.js';
import { summarizeFullVideo, summarizeAllClips } from './summary-service.js';
import { VIDEO_CONFIG } from './config.js';
import { supabase } from '../../lib/supabase.js';
import { log } from '../../lib/logger.js';

/**
 * Process a video through the full pipeline.
 * The matched keywords drive every step — clip selection, summary focus, search.
 *
 * Pipeline:
 *   1. Transcribe (Groq Whisper)
 *   2. Search (find all keyword occurrences with timestamps)
 *   3. Generate clips (14s before + 14s after each occurrence, merge overlaps)
 *   4. AI summaries (keyword-focused for full video + each clip)
 *   5. Save results to database
 *
 * @param {string} videoId - YouTube video ID
 * @param {string} articleId - Database article/content ID
 * @param {string[]} matchedKeywords - Keywords that triggered this video fetch
 */
export async function processVideo(videoId, articleId, matchedKeywords) {
    const startTime = Date.now();

    try {
        // Update processing status
        await updateProcessingStatus(articleId, 'processing', 'Starting transcription...');

        // ── Step 1: Transcribe ──────────────────────────────
        log.ai.info('🎙️ [VIDEO PIPELINE] Step 1: Transcribing', { videoId, keywords: matchedKeywords });
        const transcript = await withTimeout(
            transcribeVideo(videoId),
            VIDEO_CONFIG.pipelineTimeoutMs,
            'Transcription timed out'
        );

        if (!transcript || !transcript.text || transcript.text.length < 50) {
            log.ai.warn('Transcript too short or empty, skipping pipeline', { videoId });
            await updateProcessingStatus(articleId, 'skipped', 'Transcript too short');
            await saveTranscript(articleId, transcript, matchedKeywords, []);
            return;
        }

        // ── Step 1b: Translate non-English → English ─────────
        let searchText = transcript.text;
        let originalNativeText = null;

        if (isNonEnglishLanguage(transcript.language)) {
            log.ai.info(`🌐 [VIDEO PIPELINE] Step 1b: ${transcript.language} detected — translating to English`, {
                videoId,
                language: transcript.language,
                chars: transcript.text.length,
            });
            await updateProcessingStatus(articleId, 'processing', `Translating ${transcript.language} transcript to English...`);

            try {
                originalNativeText = transcript.text;
                searchText = await translateToEnglish(transcript.text, transcript.language);
                log.ai.info('Translation complete', {
                    videoId,
                    language: transcript.language,
                    originalChars: originalNativeText.length,
                    translatedChars: searchText.length,
                });
            } catch (translationErr) {
                log.ai.warn('Translation failed — using original text for search', {
                    videoId,
                    language: transcript.language,
                    error: translationErr.message,
                });
                // Continue with original text; keywords may still be found as transliterations
            }
        }

        await updateProcessingStatus(articleId, 'processing', 'Searching keywords...');

        // ── Step 2: Search for keywords ─────────────────────
        log.ai.info('🔍 [VIDEO PIPELINE] Step 2: Searching keywords', {
            videoId,
            keywords: matchedKeywords,
            searchLanguage: originalNativeText ? 'en (translated)' : transcript.language,
        });
        // Search on English text (translated if non-English, original if already English)
        const searchTranscript = originalNativeText
            ? { ...transcript, text: searchText }
            : transcript;
        const keywordOccurrences = searchMultipleKeywords(searchTranscript, matchedKeywords);

        log.ai.info(`Found ${keywordOccurrences.length} keyword occurrences`, {
            videoId,
            occurrences: keywordOccurrences.length,
        });

        await updateProcessingStatus(articleId, 'processing', `Found ${keywordOccurrences.length} keyword hits. Generating clips...`);

        // ── Step 3: Generate clips ──────────────────────────
        let clips = [];
        if (keywordOccurrences.length > 0) {
            log.ai.info('✂️ [VIDEO PIPELINE] Step 3: Generating clips', { videoId });

            const clipWindows = calculateClipWindows(keywordOccurrences, transcript.duration);
            log.ai.info(`${clipWindows.length} clip windows calculated (after merging overlaps)`, { videoId });

            clips = await generateClips(videoId, clipWindows);
            log.ai.info(`${clips.length} clips generated`, { videoId });
        } else {
            log.ai.info('No keyword occurrences found — DELETING irrelevant video', { videoId });
            
            // Delete from database completely so it drops from the frontend
            await supabase.from('content_items').delete().eq('id', articleId);
            await supabase.from('articles').delete().eq('id', articleId);
            
            log.ai.info('Irrelevant video purged from database.', { videoId });
            return; // Stop processing entirely
        }

        await updateProcessingStatus(articleId, 'processing', 'Generating AI summaries...');

        // ── Step 4: AI summaries ────────────────────────────
        log.ai.info('🤖 [VIDEO PIPELINE] Step 4: AI summaries', { videoId });

        // Full video summary — use English text (translated or original)
        const fullSummary = await summarizeFullVideo(searchText, matchedKeywords);

        // Per-clip summaries
        let clipsWithSummaries = [];
        if (clips.length > 0) {
            clipsWithSummaries = await summarizeAllClips(clips, transcript);
        }

        // AI QUALITY GATE & GENERATION FAILURE CHECK
        if (clipsWithSummaries.length === 0) {
            log.ai.info('0 valid clips generated/retained (either generation failed or AI rejected all) — DELETING video', { videoId });
            await supabase.from('content_items').delete().eq('id', articleId);
            await supabase.from('articles').delete().eq('id', articleId);
            return; // Stop processing
        }

        await updateProcessingStatus(articleId, 'processing', 'Saving results...');

        // ── Step 5: Save to database ────────────────────────
        log.ai.info('💾 [VIDEO PIPELINE] Step 5: Saving results', { videoId });
        
        // Strictly filter occurrences to only include those belonging to successfully verified clips
        let validOccurrences = [];
        clipsWithSummaries.forEach(clip => {
            if (clip.occurrences) {
                clip.occurrences.forEach(occ => validOccurrences.push(occ));
            }
        });
        // Deduplicate in case multiple clips captured the same occurrence (rare but possible)
        validOccurrences = validOccurrences.filter((v, i, a) => a.findIndex(t => (t.timestamp === v.timestamp && (t.keyword || t.text) === (v.keyword || v.text))) === i);

        await saveTranscript(articleId, transcript, matchedKeywords, validOccurrences, fullSummary, {
            originalNativeText,
            translatedText: originalNativeText ? searchText : null,
        });
        await saveClips(articleId, clipsWithSummaries, matchedKeywords);

        // Update content with English text (translated if Odia, original otherwise)
        await updateArticleContent(articleId, searchText, fullSummary);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        await updateProcessingStatus(articleId, 'complete', `Done in ${elapsed}s`);

        log.ai.info(`✅ [VIDEO PIPELINE] Complete`, {
            videoId,
            articleId,
            duration: elapsed + 's',
            transcriptWords: transcript.words.length,
            keywordHits: keywordOccurrences.length,
            clipsGenerated: clipsWithSummaries.length,
        });

    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log.ai.error('❌ [VIDEO PIPELINE] Failed', {
            videoId,
            articleId,
            error: error.message,
            duration: elapsed + 's',
        });

        await updateProcessingStatus(articleId, 'failed', error.message?.substring(0, 200));
    }
}

// ── Database Save Functions ──────────────────────────────────

async function saveTranscript(articleId, transcript, keywords, occurrences, summary = '', translation = {}) {
    try {
        const { originalNativeText, translatedText } = translation;

        // full_text always stores English (for search / AI)
        // original_text column does not exist in the schema — store native language in ai_summary if needed
        const { error } = await supabase.from('video_transcripts').upsert({
            article_id: articleId,
            full_text: translatedText || transcript?.text || '',
            segments: transcript?.segments || [],
            words: transcript?.words || [],
            duration_seconds: transcript?.duration || 0,
            language: transcript?.language || 'en',
            keyword_occurrences: occurrences.map(o => ({
                keyword: o.keyword || o.text,
                timestamp: o.timestamp,
                context: o.context || '',
                level: o.level || 'word',
            })),
            ai_summary: summary,
        }, { onConflict: 'article_id' });

        if (error) throw error;
        log.ai.info('Transcript saved to DB', { articleId });
    } catch (error) {
        log.ai.error('Failed to save transcript', { articleId, error: error.message });
    }
}

async function saveClips(articleId, clips, keywords) {
    if (!clips || clips.length === 0) return;

    try {
        const rows = clips.map(clip => ({
            article_id: articleId,
            keyword: clip.keywords?.[0] || keywords[0] || '',
            start_time: clip.start,
            end_time: clip.end,
            clip_url: clip.clipUrl || '',
            transcript_segment: clip.transcriptSegment || '',
            ai_summary: clip.aiSummary || '',
        }));

        // Delete existing clips for this article (in case of re-processing)
        await supabase.from('video_clips').delete().eq('article_id', articleId);

        const { error } = await supabase.from('video_clips').insert(rows);
        if (error) throw error;

        log.ai.info(`${rows.length} clips saved to DB`, { articleId });
    } catch (error) {
        log.ai.error('Failed to save clips', { articleId, error: error.message });
    }
}

async function updateArticleContent(articleId, transcriptText, summary) {
    try {
        // Update content in articles table with full transcript
        await supabase
            .from('articles')
            .update({ content: transcriptText.substring(0, 50000) })
            .eq('id', articleId);

        // Also update content_items
        await supabase
            .from('content_items')
            .update({ content: transcriptText.substring(0, 50000) })
            .eq('id', articleId);
    } catch {
        // Non-critical — original content remains
    }
}

async function updateProcessingStatus(articleId, status, message) {
    try {
        // Update type_metadata.processing_status in content_items
        const { data } = await supabase
            .from('content_items')
            .select('type_metadata')
            .eq('id', articleId)
            .single();

        const metadata = data?.type_metadata || {};
        metadata.processing_status = status;
        metadata.processing_message = message;
        metadata.processing_updated_at = new Date().toISOString();

        await supabase
            .from('content_items')
            .update({ type_metadata: metadata })
            .eq('id', articleId);
    } catch {
        // Non-critical
    }
}

// ── Helpers ──────────────────────────────────────────────────

function withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
}
