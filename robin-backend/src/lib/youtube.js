// ============================================================
// ROBIN OSINT — YouTube Data API with Key Rotation
// Automatically cycles through YouTube API keys on quota limit (403)
// ============================================================

import { log } from './logger.js';

const API_KEYS = [];

// Load the primary key first
if (process.env.YOUTUBE_API_KEY) {
    API_KEYS.push(process.env.YOUTUBE_API_KEY);
}

// Load numbered fallback keys
for (let i = 1; i <= 10; i++) {
    const key = process.env[`YOUTUBE_API_KEY_${i}`];
    if (key && !API_KEYS.includes(key)) {
        API_KEYS.push(key);
    }
}

if (API_KEYS.length === 0) {
    log.scraper.warn('[YOUTUBE] No API keys found in environment. Provide YOUTUBE_API_KEY.');
} else {
    log.scraper.info(`[YOUTUBE] Loaded ${API_KEYS.length} API key(s) for rotation`);
}

let currentKeyIndex = 0;

/**
 * Returns the currently active YouTube API Key
 */
export function getYoutubeApiKey() {
    if (API_KEYS.length === 0) return null;
    return API_KEYS[currentKeyIndex % API_KEYS.length];
}

/**
 * Rotates the API key to the next available one.
 * Call this when you encounter a 403 quotaExceeded error.
 */
function rotateYoutubeKey() {
    if (API_KEYS.length <= 1) return; // Cannot rotate if only 1 key exists
    const oldIdx = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    log.scraper.warn(`Rotating YouTube API key ${oldIdx} → ${currentKeyIndex} (Quota Exceeded)`);
}

/**
 * Wrapper for fetching from YouTube Data API v3 with automatic retry & key rotation.
 * 
 * @param {string} baseUrl The API URL without the key parameter
 * @param {Object} queryParams Object containing query parameters (will be appended)
 * @param {AbortController.signal} signal Fetch signal
 * @returns {Promise<any>} The parsed JSON data
 */
export async function fetchWithYoutubeRotation(baseUrl, queryParams = {}, signal) {
    if (API_KEYS.length === 0) throw new Error('YouTube API keys missing');

    const maxAttempts = API_KEYS.length; // Try every key exactly once
    const errors = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const key = getYoutubeApiKey();
        
        // Construct full URL
        const params = new URLSearchParams({ ...queryParams, key });
        const url = `${baseUrl}?${params.toString()}`;

        try {
            const res = await fetch(url, { signal });
            
            // If the response is not OK, we must decide whether to rotate or throw
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                const isQuotaError = 
                    res.status === 403 && 
                    errorData?.error?.errors && 
                    errorData.error.errors[0]?.reason === 'quotaExceeded';

                // 403 quotaExceeded means the key is dead for the day.
                // 429 means we are hitting rate limits too fast
                if (isQuotaError || res.status === 429) {
                    errors.push(`Key ${currentKeyIndex} failed: ${res.status} ${isQuotaError ? 'quotaExceeded' : 'rateLimit'}`);
                    rotateYoutubeKey();
                    // Small local backoff before retrying next key
                    await new Promise(r => setTimeout(r, 500));
                    continue; // Retry with next key!
                } else {
                    // It's a genuine error (bad request, etc), do not rotate, just throw
                    throw new Error(`YouTube API ${res.status}: ${JSON.stringify(errorData).substring(0, 150)}`);
                }
            }

            // Success! Return the perfectly parsed JSON.
            return await res.json();
            
        } catch (fetchError) {
            // Network errors or throw statements from above
            // If it's an AbortError from timeout, just rethrow immediately (don't burn all keys)
            if (fetchError.name === 'AbortError') throw fetchError;
            
            // For other generic fetch errors, we throw because the key is not at fault
            if (!fetchError.message.includes('Key')) {
                throw fetchError;
            }
        }
    }

    // If we exit the loop, ALL keys are exhausted or quota'd out for today
    throw new Error(`All ${maxAttempts} YouTube keys exhausted. Last errors: ${errors.join(', ')}`);
}
