// ============================================================
// ROBIN OSINT - AI Summary Service (Groq Llama 3.3 70B)
// Keyword-aware summaries for full videos and individual clips
// ============================================================

import { groqChat } from '../../lib/groq.js';
import { VIDEO_CONFIG } from './config.js';
import { log } from '../../lib/logger.js';

/**
 * Build a short language-hint block tailored to the client. For clients
 * that monitor Indian-language regional TV we explicitly list the expected
 * scripts so the model knows to translate. For English-first clients
 * (defence, international, corporate) we use a generic hint so we don't
 * falsely bias the model toward Odia / Hindi output.
 */
function buildLanguageHint(clientName) {
    const nm = (clientName || '').toLowerCase();
    const isIndianRegional = /odisha|bengal|tamil|andhra|telangana|karnataka|kerala|maharashtra|gujarat|punjab|bihar|jharkhand|uttar|assam|madhya|rajasthan|haryana|himachal/.test(nm);

    if (isIndianRegional) {
        return `The transcript may be in Odia, Hindi, Bengali, Telugu, Tamil, Kannada, Gujarati, Punjabi, Assamese, or another Indian language. Translate every quote and finding into English. Your entire response must be in English only — never include non-Latin script characters.`;
    }
    return `If the transcript is not in English, translate everything into English. Your entire response must be in English only and must not include non-Latin script characters.`;
}

/**
 * Generate a keyword-focused summary of the full video.
 * The summary emphasizes WHY this video was fetched based on the keyword.
 *
 * @param {string} transcriptText - Full transcript text
 * @param {string[]} keywords - Keywords that triggered this video fetch
 * @param {string} clientName - Client organisation name (shapes analyst persona)
 * @returns {Promise<string>} AI-generated summary
 */
export async function summarizeFullVideo(transcriptText, keywords, clientName = null) {
    if (!transcriptText || transcriptText.length < 50) {
        return 'Transcript too short for meaningful summary.';
    }

    const primaryKeyword = keywords[0] || 'the topic';
    const allKeywords = keywords.join(', ');
    const truncatedTranscript = transcriptText.substring(0, 4000);
    const clientLabel = clientName || 'the client organisation';
    const langHint = buildLanguageHint(clientName);

    const messages = [
        {
            role: 'system',
            content: `You are a senior open-source intelligence analyst serving ${clientLabel}. You produce short, structured briefings that senior officials can act on.

DISCIPLINE:
- Extract specific facts only: named people, organisations, locations, figures, dates, allegations. Never vague summaries.
- Distinguish claim from fact. If the speaker alleges something, use "alleges" / "claims" / "reports". Do not state allegations as fact.
- If the transcript is fragmentary, contradictory, or unclear, say so plainly rather than guess.
- Neutral, civil-service tone. No adjectives of judgement, no editorialising.

LANGUAGE:
${langHint}

FORMATTING:
- Do not use the em dash character (—). Use a hyphen (-) or reword.
- Plain text only. No markdown headings, no code fences.`,
        },
        {
            role: 'user',
            content: `This video was flagged because it discusses: ${allKeywords}

TRANSCRIPT (first 4000 chars):
"${truncatedTranscript}"

Write a structured intelligence brief using EXACTLY this layout (real newlines between sections):

[One sentence headline. The single most important claim, allegation, or development in the video. Name specific people, places, or figures if present.]

Key findings:
• [Finding 1 — specific names, amounts, dates, locations]
• [Finding 2]
• [Finding 3 — omit this bullet if fewer than 3 distinct findings exist]

Coverage type: [Government Announcement / Corruption Allegation / Political Criticism / Protest or Unrest / Policy Update / Court or Legal Action / Security Incident / Economic / General Reporting]

Why this matters: [One sentence linking the content to monitoring of "${primaryKeyword}" for ${clientLabel}.]

If the transcript is too fragmented, incoherent, or unrelated to ${allKeywords} to analyse, write exactly: "Transcript unclear" in each section.`,
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
 * @param {string} videoContext - Short video-level context
 * @param {string} clientName - Client organisation name
 * @returns {Promise<string>} AI-generated clip summary
 */
export async function summarizeClip(segmentText, keyword, timestamp, videoContext = '', clientName = null) {
    if (!segmentText || segmentText.length < 80) {
        return `Clip around "${keyword}" at ${formatTime(timestamp)}. Transcript segment too short to summarise.`;
    }

    const contextLine = videoContext
        ? `Video-level context: ${videoContext.substring(0, 200)}\n\n`
        : '';
    const clientLabel = clientName || 'the client organisation';
    const langHint = buildLanguageHint(clientName);

    const messages = [
        {
            role: 'system',
            content: `You are a senior open-source intelligence analyst serving ${clientLabel}. You extract short, specific intelligence notes from short video clips.

DISCIPLINE:
- One fact per line, named and specific. Never paraphrase vaguely.
- Distinguish claim from fact ("alleges", "claims", "reports" for unverified statements).
- If the keyword is only mentioned in passing, say so explicitly.

LANGUAGE:
${langHint}

FORMATTING:
- Do not use the em dash character. Use a hyphen (-) or reword.
- Plain text only. No markdown, no code fences.`,
        },
        {
            role: 'user',
            content: `A regional news video was flagged because it mentions "${keyword}". Below is a ~28-second transcript segment at ${formatTime(timestamp)}.

${contextLine}TRANSCRIPT SEGMENT:
"${segmentText.substring(0, 1500)}"

Write a short intelligence note in EXACTLY this layout (real newlines):

What: [One sentence. The specific claim, statement, or event in this segment involving "${keyword}". Name exact people, places, or figures. If "${keyword}" is only incidentally mentioned, say so.]
Context: [One phrase — the angle: corruption allegation / political criticism / government announcement / protest / court action / security incident / economic / general reporting]
Why it matters: [One sentence on why this clip matters to someone monitoring "${keyword}" for ${clientLabel}.]

QUALITY GATE: If the segment is incoherent, too fragmented, unrelated to "${keyword}", or just background noise, respond with exactly: IRRELEVANT_GARBAGE`,
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
 * @param {string} clientName - Client organisation name
 * @returns {Promise<Array>} Clips with added ai_summary field
 */
export async function summarizeAllClips(clips, transcript, clientName = null) {
    const results = [];

    // Pass first 250 chars of full transcript as context so each clip knows what the video is about
    const videoContext = (transcript.text || '').substring(0, 250);

    for (const clip of clips) {
        const keyword = clip.keywords[0] || 'unknown';
        const isFallback = (clip.occurrences || []).some(o => o.level === 'auto-fallback' || o.level === 'title-fallback');

        // Get transcript text for this clip's time window
        const segmentText = getTranscriptForWindow(
            transcript.segments || [],
            transcript.words || [],
            clip.start,
            clip.end
        );

        const summary = await summarizeClip(segmentText, keyword, clip.start, videoContext, clientName);

        // Skip quality gate for fallback clips — always keep them so the user has something to watch
        if (!isFallback && (summary === 'IRRELEVANT_GARBAGE' || summary.includes('IRRELEVANT_GARBAGE'))) {
            log.ai.info('AI Quality Gate rejected clip', { keyword, start: clip.start });
            continue; // Skip adding this clip
        }

        const finalSummary = (summary === 'IRRELEVANT_GARBAGE' || summary.includes('IRRELEVANT_GARBAGE'))
            ? `Opening clip from this video (${clip.start}s - ${clip.end}s).`
            : summary;

        results.push({
            ...clip,
            transcriptSegment: segmentText,
            aiSummary: finalSummary,
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
