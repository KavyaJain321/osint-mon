// ============================================================
// ROBIN OSINT — Multilingual → English Translation Service
// Translates any non-English transcript to English using Groq Llama
// Handles: Odia, Hindi, Telugu, Bengali, Marathi, and more
// ============================================================

import Groq from 'groq-sdk';
import { log } from '../../lib/logger.js';

// ── Key management (same 401-blacklist pattern as transcription-service) ──────
const invalidKeyIndices = new Set();

function getAllKeys() {
    const keys = [];
    for (let i = 1; i <= 20; i++) {
        if (!invalidKeyIndices.has(i)) {
            const key = process.env[`GROQ_API_KEY_${i}`];
            if (key) keys.push({ key, index: i });
        }
    }
    return keys;
}

function getGroqClient() {
    const keys = getAllKeys();
    if (keys.length === 0) throw new Error('No valid GROQ_API_KEY found for translation');
    const idx = Math.floor(Date.now() / 1000) % keys.length;
    return { client: new Groq({ apiKey: keys[idx].key }), keyIndex: keys[idx].index };
}

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
 * Translate text from any language to English using Groq Llama.
 * Retries with key rotation; blacklists keys that return 401.
 */
async function translateChunk(text, languageName) {
    const maxAttempts = Math.max(3, getAllKeys().length);
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { client, keyIndex } = getGroqClient();
        try {
            const response = await client.chat.completions.create({
                model: 'llama-3.1-8b-instant',
                messages: [
                    {
                        role: 'system',
                        content:
                            `You are a professional ${languageName}-to-English translator specializing in news content from Odisha, India. ` +
                            'Translate the provided text to clear, accurate English. ' +
                            'Preserve all proper nouns exactly: person names, place names (Odisha, Bhubaneswar, Puri, Cuttack, etc.), ' +
                            'party names (BJD, BJP, Congress, AAP), government terms, and numbers. ' +
                            'If a word or phrase is already in English, keep it as-is. ' +
                            'Output ONLY the English translation — no explanations, no notes, no language labels.',
                    },
                    { role: 'user', content: text },
                ],
                temperature: 0.1,
                max_tokens: 4000,
            });

            return response.choices[0]?.message?.content?.trim() || '';
        } catch (error) {
            lastError = error;
            const status = error.status || 0;

            if (status === 401) {
                invalidKeyIndices.add(keyIndex);
                log.ai.warn(`Translation key ${keyIndex} invalid (401) — blacklisted`, {
                    remainingKeys: getAllKeys().length,
                });
                if (getAllKeys().length === 0) break;
                continue;
            }

            log.ai.warn(`Translation attempt ${attempt + 1} failed`, {
                keyIndex, status, error: error.message?.substring(0, 80),
            });
            if (attempt < maxAttempts - 1) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }

    throw new Error(`Translation failed after ${maxAttempts} attempts: ${lastError?.message}`);
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
