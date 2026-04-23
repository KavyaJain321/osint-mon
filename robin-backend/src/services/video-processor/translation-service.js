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

// ── B3: Keyword translation for Indic matching ─────────────────
// English keywords like "Women Reservation Bill" will never match a Hindi
// transcript "महिला आरक्षण विधेयक" via transliteration because they are
// semantically translated, not phonetically similar. Fix: translate the
// client's English keywords into the transcript's script (Hindi / Odia / etc.)
// and pass BOTH sets to TRIJYA-7. The existing fuzzy matcher then catches
// the native-script form via direct transliteration.
//
// Only called when sourceLanguage is non-English — single Groq call per video.

/**
 * Translate English keywords into the target native-script language.
 * Returns an array of translated keyword strings (same order, may be shorter
 * if some translations are identical to the English or empty).
 *
 * @param {string[]} keywords - English keyword list
 * @param {string} targetLanguageCode - Whisper/source language code (e.g. 'hi', 'or')
 * @returns {Promise<string[]>} Native-script keywords (deduped against English originals)
 */
export async function translateKeywordsToLanguage(keywords, targetLanguageCode) {
    const code = (targetLanguageCode || '').toLowerCase().trim();
    if (!code || ENGLISH_CODES.has(code) || !keywords || keywords.length === 0) return [];

    const langName = getLanguageName(targetLanguageCode);

    // Cap to 30 keywords to keep token cost low — most specific keywords first
    const kwsToTranslate = keywords.slice(0, 30);

    try {
        const response = await groqChat([
            {
                role: 'system',
                content: `You are translating intelligence monitoring keywords from English to ${langName}. ` +
                    `Output ONLY the translated lines, one per line, in the same order as the input. ` +
                    `Rules: (1) Transliterate proper nouns (person names, place names, party names) into ${langName} script rather than translating them — e.g. "Naveen Patnaik" → "ନବୀନ ପଟ୍ଟନାୟକ" in Odia. ` +
                    `(2) Translate concept keywords (e.g. "Women Reservation Bill" → "${langName} equivalent"). ` +
                    `(3) If a keyword has no meaningful native translation, output it unchanged. ` +
                    `Do NOT add numbering, bullets, or explanations.`,
            },
            {
                role: 'user',
                content: kwsToTranslate.join('\n'),
            },
        ], { temperature: 0, max_tokens: kwsToTranslate.length * 25 });

        const raw = response.choices[0]?.message?.content?.trim() || '';
        const translated = raw.split('\n').map(s => s.trim()).filter(Boolean);

        // Remove translations that are identical to their English original
        // (no value in duplicating keywords that couldn't be translated)
        const englishSet = new Set(kwsToTranslate.map(k => k.toLowerCase()));
        const novel = translated.filter(t => !englishSet.has(t.toLowerCase()));

        log.ai.info('B3: Keywords translated for Indic matching', {
            targetLang: langName,
            input: kwsToTranslate.length,
            novel: novel.length,
            sample: novel.slice(0, 3),
        });

        return novel;
    } catch (err) {
        log.ai.warn('B3: Keyword translation failed — using English keywords only', {
            error: err.message?.substring(0, 100),
            targetLanguageCode,
        });
        return [];
    }
}
