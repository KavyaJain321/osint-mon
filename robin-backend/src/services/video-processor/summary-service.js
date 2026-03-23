// ============================================================
// ROBIN OSINT — AI Summary Service (Groq Llama 3.3 70B)
// Keyword-aware summaries for full videos and individual clips
// ============================================================

import { groqChat } from '../../lib/groq.js';
import { VIDEO_CONFIG } from './config.js';
import { log } from '../../lib/logger.js';

/**
 * Generate a keyword-focused summary of the full video.
 * The summary emphasizes WHY this video was fetched based on the keyword.
 *
 * @param {string} transcriptText - Full transcript text
 * @param {string[]} keywords - Keywords that triggered this video fetch
 * @returns {Promise<string>} AI-generated summary
 */
export async function summarizeFullVideo(transcriptText, keywords) {
    if (!transcriptText || transcriptText.length < 50) {
        return 'Transcript too short for meaningful summary.';
    }

    const primaryKeyword = keywords[0] || 'the topic';
    const allKeywords = keywords.join(', ');
    const truncatedTranscript = transcriptText.substring(0, 4000);

    const messages = [
        {
            role: 'system',
            content: 'You are an open-source intelligence assistant for the Government of Odisha. Provide neutral, concise, factual summaries focused on how the content relates to specific monitoring keywords. Use civil-service-style language suitable for senior officials.',
        },
        {
            role: 'user',
            content: `Summarize this video transcript with emphasis on content related to "${primaryKeyword}".

Monitoring keywords: ${allKeywords}

Transcript:
"${truncatedTranscript}"

Provide a concise 3-4 sentence summary that:
1. Explains the main topic of the video
2. Highlights how "${primaryKeyword}" is discussed or referenced
3. Notes any significant statements, claims, or developments mentioned
4. Explains WHY this video is relevant to someone monitoring "${primaryKeyword}"

Keep it factual and intelligence-focused. Do not add opinions.`,
        },
    ];

    try {
        const response = await groqChat(messages, {
            temperature: VIDEO_CONFIG.summaryTemperature,
            max_tokens: VIDEO_CONFIG.summaryMaxTokens,
        });

        const summary = response.choices[0]?.message?.content?.trim() || '';
        return summary || 'Summary generation returned empty result.';
    } catch (error) {
        log.ai.warn('Full video summary failed', { error: error.message?.substring(0, 100) });
        // Fallback: simple extraction
        return `Video transcript discussing ${primaryKeyword}. ${transcriptText.substring(0, 200)}...`;
    }
}

/**
 * Generate a summary for a specific clip around a keyword occurrence.
 *
 * @param {string} segmentText - Transcript segment for this clip
 * @param {string} keyword - Keyword that triggered this clip
 * @param {number} timestamp - Timestamp in seconds
 * @returns {Promise<string>} AI-generated clip summary
 */
export async function summarizeClip(segmentText, keyword, timestamp) {
    if (!segmentText || segmentText.length < 20) {
        return `Clip around "${keyword}" at ${formatTime(timestamp)}.`;
    }

    const messages = [
        {
            role: 'system',
            content: 'You are an open-source intelligence assistant for the Government of Odisha. Provide neutral, brief, factual context summaries. Use civil-service-style language.',
        },
        {
            role: 'user',
            content: `Analyze this video transcript segment and explain the context in which "${keyword}" is being discussed.

Transcript segment:
"${segmentText.substring(0, 1500)}"

Provide a concise 2-3 sentence summary that explains:
1. What is being discussed when "${keyword}" is mentioned
2. The main point or context of this segment

IMPORTANT: If the transcript segment appears to be a jumbled, hallucinated mix of words without making sense, OR if it is impossible to determine any coherent context, OR if the keyword is not actually discussed in a meaningful way, you MUST reply with EXACTLY this string: "IRRELEVANT_GARBAGE". Do not explain why, just output "IRRELEVANT_GARBAGE".

Otherwise, be factual and concise.`,
        },
    ];

    try {
        const response = await groqChat(messages, {
            temperature: VIDEO_CONFIG.summaryTemperature,
            max_tokens: VIDEO_CONFIG.clipSummaryMaxTokens,
        });

        return response.choices[0]?.message?.content?.trim() || `Clip discussing "${keyword}".`;
    } catch (error) {
        log.ai.warn('Clip summary failed', { keyword, error: error.message?.substring(0, 80) });
        return `In this segment, "${keyword}" is mentioned at ${formatTime(timestamp)}. Context: ${segmentText.substring(0, 150)}...`;
    }
}

/**
 * Generate summaries for all clips in batch.
 * Processes sequentially to respect Groq rate limits.
 *
 * @param {Array} clips - Clips from clip-generator [{ keywords, occurrences, start, end }]
 * @param {Object} transcript - Full transcript { text, segments, words }
 * @returns {Promise<Array>} Clips with added ai_summary field
 */
export async function summarizeAllClips(clips, transcript) {
    const results = [];

    for (const clip of clips) {
        const keyword = clip.keywords[0] || 'unknown';

        // Get transcript text for this clip's time window
        const segmentText = getTranscriptForWindow(
            transcript.segments || [],
            transcript.words || [],
            clip.start,
            clip.end
        );

        const summary = await summarizeClip(segmentText, keyword, clip.start);

        if (summary === 'IRRELEVANT_GARBAGE' || summary.includes('IRRELEVANT_GARBAGE')) {
            log.ai.info('AI Quality Gate rejected clip', { keyword, start: clip.start });
            continue; // Skip adding this clip
        }

        results.push({
            ...clip,
            transcriptSegment: segmentText,
            aiSummary: summary,
        });

        // Small delay between API calls to respect rate limits
        await new Promise(r => setTimeout(r, 500));
    }

    return results;
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Extract transcript text for a time window.
 */
function getTranscriptForWindow(segments, words, startTime, endTime) {
    // Try segments first (better quality)
    const relevantSegments = segments.filter(
        s => s.end >= startTime && s.start <= endTime
    );
    if (relevantSegments.length > 0) {
        return relevantSegments.map(s => s.text).join(' ').trim();
    }

    // Fallback to words
    const relevantWords = words.filter(
        w => w.end >= startTime && w.start <= endTime
    );
    return relevantWords.map(w => w.word).join(' ').trim();
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
