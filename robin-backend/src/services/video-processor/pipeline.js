// ============================================================
// ROBIN OSINT — Video Processing Pipeline Orchestrator
// Steps 1+3 run on TRIJYA-7 (RTX 4090, residential IP, no YouTube bot-block)
// Steps 1b+4+5 run on Render (translation, AI summaries, DB save)
// ============================================================

import { processVideoViaTrijya } from './trijya-video-service.js';
import { isNonEnglishLanguage, translateToEnglish } from './translation-service.js';
import { summarizeFullVideo, summarizeAllClips } from './summary-service.js';
import { VIDEO_CONFIG } from './config.js';
import { supabase } from '../../lib/supabase.js';
import { log } from '../../lib/logger.js';

/**
 * Process a video through the full pipeline.
 *
 * Pipeline:
 *   TRIJYA-7: 1. Download audio (yt-dlp, residential IP — no bot-block)
 *             2. Transcribe (faster-whisper on RTX 4090)
 *             3. Keyword search + clip windows
 *             4. Download video clips (yt-dlp) + upload to Supabase
 *
 *   Render:   5. Translate transcript if non-English (Groq)
 *             6. AI summaries for full video + each clip (Groq)
 *             7. Save all results to database
 */
export async function processVideo(videoId, articleId, matchedKeywords) {
    const startTime = Date.now();

    try {
        await updateProcessingStatus(articleId, 'processing', 'Queuing video on TRIJYA-7...');

        // ── Steps 1–4: TRIJYA-7 (download + transcribe + clips) ───────
        log.ai.info('🎙️ [VIDEO PIPELINE] Steps 1-4: Dispatching to TRIJYA-7', {
            videoId, keywords: matchedKeywords,
        });

        const trijyaResult = await withTimeout(
            processVideoViaTrijya(videoId, matchedKeywords),
            VIDEO_CONFIG.pipelineTimeoutMs,
            'TRIJYA-7 video pipeline timed out'
        );

        const transcript = trijyaResult.transcript;
        let clips = trijyaResult.clips || [];                      // already have Supabase URLs
        const keywordOccurrences = trijyaResult.keywordOccurrences || [];

        log.ai.info('✅ TRIJYA-7 pipeline complete', {
            videoId,
            language: transcript.language,
            words: transcript.words.length,
            duration: transcript.duration,
            clips: clips.length,
            keywordHits: keywordOccurrences.length,
        });

        if (!transcript || !transcript.text || transcript.text.length < 50) {
            log.ai.warn('Transcript too short or empty, skipping summaries', { videoId });
            await updateProcessingStatus(articleId, 'skipped', 'Transcript too short');
            await saveTranscript(articleId, transcript, matchedKeywords, []);
            return;
        }

        // ── Step 5: Translate non-English → English (Render/Groq) ─────
        let searchText = transcript.text;
        let originalNativeText = null;

        if (isNonEnglishLanguage(transcript.language)) {
            log.ai.info(`🌐 [VIDEO PIPELINE] Step 5: ${transcript.language} detected — translating`, {
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
                    originalChars: originalNativeText.length,
                    translatedChars: searchText.length,
                });
            } catch (translationErr) {
                log.ai.warn('Translation failed — using original text', {
                    videoId, error: translationErr.message,
                });
            }
        }

        await updateProcessingStatus(articleId, 'processing', 'Generating AI summaries...');

        // ── Step 6: AI summaries (Render/Groq) ────────────────────────
        log.ai.info('🤖 [VIDEO PIPELINE] Step 6: AI summaries', { videoId });

        const fullSummary = await summarizeFullVideo(searchText, matchedKeywords);

        let clipsWithSummaries = [];
        if (clips.length > 0) {
            clipsWithSummaries = await summarizeAllClips(clips, transcript);
        }

        await updateProcessingStatus(articleId, 'processing', 'Saving results...');

        // ── Step 7: Save to database ───────────────────────────────────
        log.ai.info('💾 [VIDEO PIPELINE] Step 7: Saving results', { videoId });

        // Collect valid occurrences from successfully summarised clips
        let validOccurrences = [];
        clipsWithSummaries.forEach(clip => {
            (clip.occurrences || []).forEach(occ => validOccurrences.push(occ));
        });
        // Deduplicate
        validOccurrences = validOccurrences.filter((v, i, a) =>
            a.findIndex(t => t.timestamp === v.timestamp && (t.keyword || t.text) === (v.keyword || v.text)) === i
        );

        // Fall back to all occurrences if no clips generated
        if (validOccurrences.length === 0 && keywordOccurrences.length > 0) {
            validOccurrences = keywordOccurrences;
        }

        await saveTranscript(articleId, transcript, matchedKeywords, validOccurrences, fullSummary, {
            originalNativeText,
            translatedText: originalNativeText ? searchText : null,
        });
        await saveClips(articleId, clipsWithSummaries, matchedKeywords);
        await updateArticleContent(articleId, searchText, fullSummary);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        await updateProcessingStatus(articleId, 'complete', `Done in ${elapsed}s`);

        log.ai.info('✅ [VIDEO PIPELINE] Complete', {
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

// ── Database helpers ─────────────────────────────────────────

async function saveTranscript(articleId, transcript, keywords, occurrences, summary = '', translation = {}) {
    try {
        const { originalNativeText, translatedText } = translation;
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
        const rows = [];
        clips.forEach(clip => {
            (clip.occurrences || []).forEach(occ => {
                rows.push({
                    article_id: articleId,
                    keyword: occ.keyword || occ.text || clip.keywords?.[0] || keywords[0] || '',
                    start_time: clip.start,
                    end_time: clip.end,
                    clip_url: clip.clipUrl || '',
                    transcript_segment: clip.transcriptSegment || '',
                    ai_summary: clip.aiSummary || '',
                });
            });
        });
        if (rows.length === 0) return;
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
        await supabase.from('articles').update({ content: transcriptText.substring(0, 50000) }).eq('id', articleId);
        await supabase.from('content_items').update({ content: transcriptText.substring(0, 50000) }).eq('id', articleId);
    } catch { /* non-critical */ }
}

async function updateProcessingStatus(articleId, status, message) {
    try {
        const { data } = await supabase.from('content_items').select('type_metadata').eq('id', articleId).single();
        const metadata = data?.type_metadata || {};
        metadata.processing_status = status;
        metadata.processing_message = message;
        metadata.processing_updated_at = new Date().toISOString();
        await supabase.from('content_items').update({ type_metadata: metadata }).eq('id', articleId);
    } catch { /* non-critical */ }
}

function withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
}
