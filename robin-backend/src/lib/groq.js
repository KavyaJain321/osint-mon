// ============================================================
// ROBIN OSINT — Groq AI Client with Key Rotation + Fallback
// Rotates through multiple API keys; falls back to local analysis
// ============================================================

import Groq from 'groq-sdk';
import { config } from '../config.js';
import { log } from './logger.js';

// ─── API Keys (loaded from environment variables) ────────────
const API_KEYS = [];
for (let i = 1; i <= 20; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key) API_KEYS.push(key);
}

// ─── Startup validation ─────────────────────────────────────
if (API_KEYS.length === 0) {
    console.error('[GROQ] CRITICAL: No API keys found in environment. Set GROQ_API_KEY_1 through GROQ_API_KEY_6 in .env');
    process.exit(1);
}
console.log(`[GROQ] Loaded ${API_KEYS.length} API key(s) from environment`);

let currentKeyIndex = 0;
let clients = API_KEYS.map(k => new Groq({ apiKey: k }));
const keyCooldowns = new Map(); // Track cooldowns by `${keyIndex}_${model}`

function getClientIndex(model) {
    // Find next available key not in cooldown for this specific model
    const now = Date.now();
    for (let i = 0; i < clients.length; i++) {
        const idx = (currentKeyIndex + i) % clients.length;
        const cooldown = keyCooldowns.get(`${idx}_${model}`) || 0;
        if (now > cooldown) {
            currentKeyIndex = idx;
            return idx;
        }
    }
    // If all are in cooldown for this model, return -1
    return -1;
}

function getClient(model) {
    const idx = getClientIndex(model);
    if (idx === -1) return null;
    return clients[idx];
}

function rotateKey(model, reason, isRateLimited = false) {
    const oldIdx = currentKeyIndex;
    
    // If rate limited, lock ONLY for this specific model for 60 seconds
    if (isRateLimited) {
        keyCooldowns.set(`${oldIdx}_${model}`, Date.now() + 60000);
    }
    
    currentKeyIndex = (currentKeyIndex + 1) % clients.length;
    log.ai.debug(`Rotating Groq key ${oldIdx} → ${currentKeyIndex} (${reason})`);
}

// ─── Models (ordered by preference) ─────────────────────────
const MODELS = [
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.1-8b-instant',
];

export const ANALYSIS_MODEL = MODELS[0];

/**
 * Groq chat with automatic key rotation and model fallback.
 * Tries each key, and if all keys fail for a model, tries the next model.
 */
export async function groqChat(messages, options = {}) {
    const errors = [];

    for (const model of MODELS) {
        // Try each key for this model
        for (let attempt = 0; attempt < clients.length; attempt++) {
            const client = getClient(model);
            if (!client) {
                // All keys are currently in cooldown FOR THIS MODEL
                errors.push(`[all_keys_cooldown] Skipping model ${model} temporarily`);
                break; // Break the attempt loop to skip to the next model
            }

            try {
                const response = await client.chat.completions.create({
                    model,
                    temperature: 0.1,
                    max_tokens: 1500,
                    ...options,
                    messages,
                });
                return response;
            } catch (error) {
                const status = error.status || error.statusCode || 0;
                const msg = error.message || '';
                errors.push(`[key${currentKeyIndex}/${model}] ${status}: ${msg.substring(0, 80)}`);

                // Rotate key on rate limit (429), auth (401), or payload size (413) 
                if (status === 429 || status === 401 || status === 413 || status >= 500) {
                    rotateKey(model, `${status} on ${model}`, true);
                } else if (msg.includes('model_not_found') || msg.includes('does not exist')) {
                    // Skip to next model entirely
                    break;
                } else {
                    rotateKey(model, msg.substring(0, 40));
                }

                // Small backoff
                await new Promise(r => setTimeout(r, 300 + attempt * 200));
            }
        }
    }

    // All keys and models exhausted
    const errSummary = errors.slice(-3).join(' | ');
    throw new Error(`All Groq keys/models exhausted. Last errors: ${errSummary}`);
}

/**
 * Generate embeddings via Groq (if available) — fails gracefully.
 */
export async function groqEmbed(text) {
    const embedModel = 'nomic-embed-text';
    for (let attempt = 0; attempt < clients.length; attempt++) {
        const client = getClient(embedModel);
        if (!client) break; // All in cooldown
        
        try {
            const response = await client.embeddings.create({
                model: embedModel,
                input: text,
            });
            return response.data[0].embedding;
        } catch (error) {
            rotateKey(embedModel, 'embed-' + (error.status || 'err'), true);
            if (attempt === clients.length - 1) {
                log.ai.warn('Embedding unavailable, skipping');
                return null; // Don't block analysis if embeddings fail
            }
        }
    }
    return null;
}

/**
 * Get the current Groq client for streaming (with rotation support).
 */
export function getStreamClient(model = ANALYSIS_MODEL) {
    return getClient(model);
}

export { MODELS };
