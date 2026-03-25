// ============================================================
// ROBIN OSINT - AI Summary Service (Groq Llama 3.3 70B)
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
            content: 'You are a senior intelligence analyst for the Government of Odisha. Produce structured intelligence briefings. Be specific - extract exact names, allegations, figures, and locations. Avoid vague or generic summaries. Senior officials will act on this. Do NOT use the em dash (-) character anywhere in your response; use a hyphen (-) or reword instead.',
        },
        {
            role: 'user',
            content: `This video was flagged because it discusses: ${allKeywords}

TRANSCRIPT:
"${truncatedTranscript}"

Write a structured intelligence brief using EXACTLY this format:

HEADLINE: [One sentence - the single most important claim, allegation, or development in this video. Name specific people, places, or figures if present.]

KEY FINDINGS:
• [Specific finding 1 - quote names, amounts, dates, locations if mentioned]
• [Specific finding 2]
• [Specific finding 3 - omit if not applicable]

COVERAGE TYPE: [Choose one: Government Announcement / Corruption Allegation / Political Criticism / Protest or Unrest / Policy Update / Court or Legal Action / General Reporting]

RELEVANCE: [One sentence on why this matters for monitoring "${primaryKeyword}"]

Be precise and factual. If the transcript is too fragmented to analyse, write UNCLEAR TRANSCRIPT under each heading.`,
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
export async function summarizeClip(segmentText, keyword, timestamp, videoContext = '') {
    if (!segmentText || segmentText.length < 20) {
        return `Clip around "${keyword}" at ${formatTime(timestamp)}.`;
    }

    const contextLine = videoContext
        ? `Video context: ${videoContext.substring(0, 200)}\n\n`
        : '';

    const messages = [
        {
            role: 'system',
            content: 'You are a senior intelligence analyst for the Government of Odisha. Extract specific, actionable intelligence from video clips. Name exact people, allegations, places, and figures. Never produce vague summaries. Do NOT use the em dash (-) character anywhere in your response; use a hyphen (-) or reword instead.',
        },
        {
            role: 'user',
            content: `A regional news video was flagged because it mentions "${keyword}". Below is the 28-second transcript segment that triggered this clip.

${contextLine}TRANSCRIPT SEGMENT (at ${formatTime(timestamp)}):
"${segmentText.substring(0, 1500)}"

Write a structured intelligence note using EXACTLY this format:

CLAIM: [What specific statement, allegation, or claim is made involving "${keyword}"? Name people, places, figures if present. If keyword is only incidentally mentioned, say so.]
CONTEXT: [What is the apparent angle - government announcement, corruption allegation, political criticism, protest coverage, court action, or general reporting?]
SIGNIFICANCE: [One sentence on why this 28-second clip matters for someone monitoring "${keyword}".]

IMPORTANT: If the segment is incoherent, hallucinated, or "${keyword}" is not meaningfully discussed, reply with exactly: IRRELEVANT_GARBAGE`,
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

    // Pass first 250 chars of full transcript as context so each clip knows what the video is about
    const videoContext = (transcript.text || '').substring(0, 250);

    for (const clip of clips) {
        const keyword = clip.keywords[0] || 'unknown';

        // Get transcript text for this clip's time window
        const segmentText = getTranscriptForWindow(
            transcript.segments || [],
            transcript.words || [],
            clip.start,
            clip.end
        );

        const summary = await summarizeClip(segmentText, keyword, clip.start, videoContext);

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
