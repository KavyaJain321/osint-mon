// ============================================================
// ROBIN OSINT — Multilingual → English Translation Service
// Translates any non-English transcript to English using Groq Llama
// Handles: Odia, Hindi, Telugu, Bengali, Marathi, and more
// ============================================================

import { groqChat } from '../../lib/groq.js';
import { log } from '../../lib/logger.js';


// ── Language detection ────────────────────────────────────────
const ENGLISH_CODES = new Set(['en', 'eng', 'english']);

/**
 * Returns true if the Whisper language code is NOT English.
 * Covers Odia (or/ori/odia/ory), Hindi (hi), Telugu (te),
 * Bengali (bn), Marathi (mr), Tamil (ta), Kannada (kn), etc.
 */
export function isNonEnglishLanguage(languageCode) {
    const code = (languageCode || '').toLowerCase().trim();
    return code.length > 0 && !ENGLISH_CODES.has(code);
}

/** Backward-compat alias for existing callers */
export const isOdiaLanguage = (code) =>
    new Set(['or', 'ori', 'odia', 'ory']).has((code || '').toLowerCase());

// ── Human-readable language names ────────────────────────────
const LANGUAGE_NAMES = {
    or: 'Odia', ori: 'Odia', odia: 'Odia', ory: 'Odia',
    hi: 'Hindi', hin: 'Hindi',
    te: 'Telugu',
    bn: 'Bengali', ben: 'Bengali',
    mr: 'Marathi',
    ta: 'Tamil',
    kn: 'Kannada',
    ml: 'Malayalam',
    gu: 'Gujarati',
    pa: 'Punjabi',
    ur: 'Urdu',
    sa: 'Sanskrit',
};

function getLanguageName(code) {
    return LANGUAGE_NAMES[(code || '').toLowerCase()] || code?.toUpperCase() || 'Non-English';
}

// Chunk size conservative for LLM context (tokens ≈ chars/4)
const CHUNK_SIZE = 5000;

// ── Translation core ──────────────────────────────────────────

/**
 * Translate text from any language to English using Groq Llama with automatic model fallback.
 */
async function translateChunk(text, languageName) {
    try {
        const response = await groqChat([
            {
                role: 'system',
                content:
                    `You are a professional ${languageName}-to-English translator specializing in news content from India. ` +
                    'Translate the provided text to clear, accurate English. ' +
                    'Preserve all proper nouns exactly: person names, place names (Odisha, Puri, Cuttack, etc.), ' +
                    'party names (BJD, BJP, Congress, AAP), government terms, and numbers. ' +
                    'If a word or phrase is already in English, keep it as-is. ' +
                    'CRITICAL INSTRUCTION: Output ONLY the English translation. Do not add explanations, conversational filler, or notes. ' +
                    'If the source text is short, repetitive, or unintelligible, translate what you can and STOP. Do NOT repeat phrases to fill space.',
            },
            { role: 'user', content: text },
        ], {
            temperature: 0.1,
            max_tokens: 4000
        });

        return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
        log.ai.error('Translation chunk failed after all retries/fallbacks', { 
            error: error.message,
            lang: languageName
        });
        // Return original text if translation fails completely to avoid breaking the pipeline
        return text;
    }
}

/**
 * Translate any non-English transcript to English.
 * Splits long text into chunks; merges results.
 *
 * @param {string} sourceText - Source transcript text (any language)
 * @param {string} languageCode - Whisper-detected language code (e.g. 'or', 'hi', 'te')
 * @returns {Promise<string>} English translation
 */
export async function translateToEnglish(sourceText, languageCode = 'unknown') {
    if (!sourceText || sourceText.trim().length < 10) return sourceText || '';

    const languageName = getLanguageName(languageCode);

    // Split into chunks
    const chunks = [];
    for (let i = 0; i < sourceText.length; i += CHUNK_SIZE) {
        chunks.push(sourceText.slice(i, i + CHUNK_SIZE));
    }

    log.ai.info(`Translating ${languageName} transcript to English`, {
        chunks: chunks.length,
        totalChars: sourceText.length,
        languageCode,
    });

    const translatedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
        try {
            const translated = await translateChunk(chunks[i], languageName);
            translatedChunks.push(translated);
            log.ai.info(`Translation chunk ${i + 1}/${chunks.length} done`, {
                inputChars: chunks[i].length,
                outputChars: translated.length,
            });
        } catch (err) {
            log.ai.warn(`Translation chunk ${i + 1}/${chunks.length} failed — keeping original`, {
                error: err.message?.substring(0, 100),
            });
            translatedChunks.push(chunks[i]); // Keep original so pipeline continues
        }

        // Respect rate limits between chunks
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 600));
        }
    }

    return translatedChunks.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Backward-compatible wrapper for Odia-only callers.
 * @deprecated Use translateToEnglish(text, languageCode) instead.
 */
export async function translateOdiaToEnglish(odiaText) {
    return translateToEnglish(odiaText, 'or');
}
