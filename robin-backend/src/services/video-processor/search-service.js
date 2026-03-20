// ============================================================
// ROBIN OSINT — Video Keyword Search Service
// Multi-level search in transcripts: word → segment → text
// Returns all occurrences with timestamps and context
// ============================================================

import { log } from '../../lib/logger.js';

/**
 * Search for a keyword in a transcript using multi-level strategy.
 * The originating keyword flows through as the default search seed.
 *
 * Search levels:
 * 1. Word-level — exact timestamp from Whisper words[]
 * 2. Segment-level — match within segment text, use segment start time
 * 3. Full-text — find position in concatenated text, estimate timestamp
 *
 * @param {Object} transcript - Transcription result { text, segments, words, duration }
 * @param {string} keyword - Keyword to search for
 * @returns {Array} Occurrences: [{ timestamp, word, context, segmentText }]
 */
export function searchKeyword(transcript, keyword) {
    if (!transcript || !keyword) return [];

    const results = [];
    const kw = keyword.toLowerCase().trim();
    const kwWords = kw.split(/\s+/); // Split multi-word keywords

    // Level 1: Word-level search (most precise)
    const wordResults = searchInWords(transcript.words || [], kw, kwWords, transcript.segments);
    if (wordResults.length > 0) {
        log.ai.debug(`Word-level search found ${wordResults.length} hits for "${keyword}"`);
        return wordResults;
    }

    // Level 2: Segment-level search
    const segmentResults = searchInSegments(transcript.segments || [], kw);
    if (segmentResults.length > 0) {
        log.ai.debug(`Segment-level search found ${segmentResults.length} hits for "${keyword}"`);
        return segmentResults;
    }

    // Level 3: Full-text fallback
    const textResults = searchInText(transcript.text || '', kw, transcript.duration || 0);
    log.ai.debug(`Full-text search found ${textResults.length} hits for "${keyword}"`);
    return textResults;
}

/**
 * Level 1: Search in word-level timestamps (most precise).
 * Handles both single-word and multi-word keyword matching.
 */
function searchInWords(words, kw, kwWords, segments) {
    const results = [];

    if (!words || words.length === 0) return results;

    if (kwWords.length === 1) {
        // Single word search
        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            const cleanWord = cleanText(w.word);
            if (cleanWord === kw || cleanWord.includes(kw)) {
                results.push({
                    timestamp: w.start,
                    endTime: w.end,
                    word: w.word,
                    text: kw,
                    context: getWordContext(words, i, 10),
                    segmentText: findContainingSegment(segments, w.start),
                    level: 'word',
                });
            }
        }
    } else {
        // Multi-word search — find consecutive words matching the phrase
        for (let i = 0; i <= words.length - kwWords.length; i++) {
            const windowWords = words.slice(i, i + kwWords.length);
            const windowText = windowWords.map(w => cleanText(w.word)).join(' ');

            if (windowText.includes(kw)) {
                results.push({
                    timestamp: windowWords[0].start,
                    endTime: windowWords[windowWords.length - 1].end,
                    word: windowWords.map(w => w.word).join(' '),
                    text: kw,
                    context: getWordContext(words, i, 10),
                    segmentText: findContainingSegment(segments, windowWords[0].start),
                    level: 'word',
                });
                // Skip ahead to avoid overlap
                i += kwWords.length - 1;
            }
        }
    }

    return results;
}

/**
 * Level 2: Search in segment-level text.
 */
function searchInSegments(segments, kw) {
    const results = [];

    for (const seg of segments) {
        const segText = cleanText(seg.text);
        let pos = segText.indexOf(kw);
        while (pos !== -1) {
            // Estimate timestamp within segment based on position ratio
            const ratio = pos / Math.max(segText.length, 1);
            const estimatedTime = seg.start + (seg.end - seg.start) * ratio;

            results.push({
                timestamp: estimatedTime,
                endTime: estimatedTime + 2, // approximate
                word: kw,
                text: kw,
                context: extractContext(segText, pos, kw.length, 60),
                segmentText: seg.text,
                level: 'segment',
            });
            pos = segText.indexOf(kw, pos + kw.length);
        }
    }

    return results;
}

/**
 * Level 3: Full-text fallback — searches concatenated text.
 * Estimates timestamps based on text position relative to duration.
 */
function searchInText(fullText, kw, duration) {
    const results = [];
    const lower = fullText.toLowerCase();
    let pos = lower.indexOf(kw);

    while (pos !== -1) {
        const ratio = pos / Math.max(lower.length, 1);
        const estimatedTime = duration * ratio;

        results.push({
            timestamp: estimatedTime,
            endTime: estimatedTime + 2,
            word: kw,
            text: kw,
            context: extractContext(lower, pos, kw.length, 60),
            segmentText: '',
            level: 'text',
        });
        pos = lower.indexOf(kw, pos + kw.length);
    }

    return results;
}

// ── Helpers ──────────────────────────────────────────────────

function cleanText(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[.,!?;:'"()\[\]{}]/g, '')
        .trim();
}

function getWordContext(words, index, windowSize) {
    const start = Math.max(0, index - windowSize);
    const end = Math.min(words.length, index + windowSize + 1);
    return words.slice(start, end).map(w => w.word).join(' ');
}

function findContainingSegment(segments, timestamp) {
    if (!segments) return '';
    const seg = segments.find(s => timestamp >= s.start && timestamp <= s.end);
    return seg?.text || '';
}

function extractContext(text, position, kwLength, contextSize) {
    const start = Math.max(0, position - contextSize);
    const end = Math.min(text.length, position + kwLength + contextSize);
    let ctx = text.substring(start, end).trim();
    if (start > 0) ctx = '...' + ctx;
    if (end < text.length) ctx = ctx + '...';
    return ctx;
}

/**
 * Search for multiple keywords and merge results.
 * Used by the pipeline to search all matched keywords at once.
 *
 * @param {Object} transcript
 * @param {string[]} keywords
 * @returns {Array} All occurrences sorted by timestamp
 */
export function searchMultipleKeywords(transcript, keywords) {
    const allResults = [];

    for (const keyword of keywords) {
        const results = searchKeyword(transcript, keyword);
        for (const r of results) {
            allResults.push({ ...r, keyword });
        }
    }

    // Sort by timestamp
    allResults.sort((a, b) => a.timestamp - b.timestamp);
    return allResults;
}

/**
 * Format timestamp as MM:SS for display.
 */
export function formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
