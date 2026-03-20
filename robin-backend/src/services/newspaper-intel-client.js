// ============================================================
// ROBIN OSINT — Newspaper Intelligence Service Client
//
// HTTP client for the newspaper-intel-service microservice.
// That service accepts a newspaper PDF URL + keywords, runs OCR
// (PaddleOCR for regional, PyMuPDF for digital), fuzzy-matches
// keywords, crops article images → Supabase Storage, and writes
// matched articles into content_items.
//
// All calls are async (the service returns job_id immediately).
// ROBIN polls /jobs/{job_id} to track progress.
//
// Required env vars:
//   NEWSPAPER_INTEL_URL  — base URL of the deployed service
//   NEWSPAPER_INTEL_KEY  — shared secret for X-Service-Key header
// ============================================================

import { log } from '../lib/logger.js';

// ── Config ────────────────────────────────────────────────────
const BASE_URL = () => {
    const u = process.env.NEWSPAPER_INTEL_URL;
    if (!u) throw new Error('NEWSPAPER_INTEL_URL is not set');
    return u.replace(/\/$/, ''); // strip trailing slash
};
const SERVICE_KEY = () => {
    const k = process.env.NEWSPAPER_INTEL_KEY;
    if (!k) throw new Error('NEWSPAPER_INTEL_KEY is not set');
    return k;
};

const DEFAULT_TIMEOUT_MS  = 30_000;  // per HTTP request
const DEFAULT_POLL_INTERVAL_S = 20;
const DEFAULT_POLL_TIMEOUT_S  = 300;

// ── Shared fetch helper ───────────────────────────────────────
async function apiFetch(path, options = {}) {
    const url = `${BASE_URL()}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let res;
    try {
        res = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'X-Service-Key': SERVICE_KEY(),
                ...(options.headers || {}),
            },
        });
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`newspaper-intel: request to ${path} timed out after ${DEFAULT_TIMEOUT_MS}ms`);
        }
        throw new Error(`newspaper-intel: network error on ${path}: ${err.message}`);
    } finally {
        clearTimeout(timer);
    }

    return res;
}

// ── 1. triggerExtraction ──────────────────────────────────────
/**
 * Submit a newspaper PDF for extraction.
 *
 * @param {string}   pdf_url          Publicly accessible URL of the newspaper PDF
 * @param {string[]} keywords         Keywords to fuzzy-match against article text
 * @param {string}   source_name      Human-readable newspaper name (e.g. "Samaja")
 * @param {string}   brief_id         ROBIN brief UUID
 * @param {string}   client_id        ROBIN client UUID
 * @param {string}   [source_language="auto"]  ISO language code or "auto"
 * @param {boolean}  [is_flipbook=false]        True for e-paper flipbook PDFs
 * @param {number}   [fuzzy_threshold=75]       RapidFuzz match threshold (0–100)
 * @returns {Promise<string>}  The job_id returned by the service
 */
export async function triggerExtraction(
    pdf_url,
    keywords,
    source_name,
    brief_id,
    client_id,
    source_language = 'auto',
    is_flipbook = false,
    fuzzy_threshold = 75,
) {
    // pdf_url may be empty — the service resolves today's PDF URL internally
    // from source_name when no explicit URL is provided.
    if (!keywords?.length) throw new Error('triggerExtraction: keywords array must not be empty');
    if (!source_name) throw new Error('triggerExtraction: source_name is required');
    if (!brief_id)   throw new Error('triggerExtraction: brief_id is required');
    if (!client_id)  throw new Error('triggerExtraction: client_id is required');

    const body = {
        pdf_url,
        keywords,
        source_name,
        brief_id,
        client_id,
        source_language,
        is_flipbook,
        fuzzy_threshold,
    };

    const res = await apiFetch('/extract', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
            `newspaper-intel: POST /extract failed [HTTP ${res.status}] for "${source_name}": ${text.substring(0, 200)}`
        );
    }

    const data = await res.json();
    const jobId = data.job_id;

    if (!jobId) {
        throw new Error(`newspaper-intel: POST /extract response missing job_id for "${source_name}"`);
    }

    log.system.info('newspaper-intel: job submitted', {
        jobId,
        sourceName: source_name,
        briefId: brief_id,
        pdfUrl: pdf_url.substring(0, 80),
        keywords: keywords.slice(0, 5),
    });

    return jobId;
}

// ── 2. getJobStatus ───────────────────────────────────────────
/**
 * Fetch the current status of an extraction job.
 *
 * @param {string} jobId
 * @returns {Promise<{job_id: string, status: string, result?: object}|null>}
 *          Returns null if the job is not found (404).
 */
export async function getJobStatus(jobId) {
    if (!jobId) throw new Error('getJobStatus: jobId is required');

    const res = await apiFetch(`/jobs/${encodeURIComponent(jobId)}`);

    if (res.status === 404) {
        log.system.warn('newspaper-intel: job not found', { jobId });
        return null;
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
            `newspaper-intel: GET /jobs/${jobId} failed [HTTP ${res.status}]: ${text.substring(0, 200)}`
        );
    }

    return res.json();
}

// ── 3. pollUntilComplete ──────────────────────────────────────
/**
 * Poll a job until it reaches "completed" or "failed" status.
 *
 * @param {string} jobId
 * @param {number} [pollIntervalSeconds=20]
 * @param {number} [timeoutSeconds=300]
 * @returns {Promise<object>}  The final job response dict
 * @throws {TimeoutError}      If the job doesn't complete within timeoutSeconds
 */
export async function pollUntilComplete(
    jobId,
    pollIntervalSeconds = DEFAULT_POLL_INTERVAL_S,
    timeoutSeconds = DEFAULT_POLL_TIMEOUT_S,
) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let attempts = 0;

    log.system.info('newspaper-intel: starting poll', {
        jobId,
        pollIntervalSeconds,
        timeoutSeconds,
    });

    while (Date.now() < deadline) {
        attempts++;
        const statusData = await getJobStatus(jobId);

        if (!statusData) {
            throw new Error(`newspaper-intel: job ${jobId} not found during polling`);
        }

        const { status } = statusData;

        log.system.info('newspaper-intel: poll tick', {
            jobId,
            status,
            attempt: attempts,
            elapsedSeconds: Math.round((Date.now() - (deadline - timeoutSeconds * 1000)) / 1000),
        });

        if (status === 'completed' || status === 'failed') {
            return statusData;
        }

        // Wait for next poll tick (unless we'd overshoot the deadline)
        const wait = Math.min(pollIntervalSeconds * 1000, deadline - Date.now());
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }

    throw new Error(
        `newspaper-intel: pollUntilComplete timed out after ${timeoutSeconds}s for job ${jobId}`
    );
}

// ── 4. triggerAndStore ────────────────────────────────────────
/**
 * Submit an extraction job AND record it in ROBIN's brief_newspaper_jobs table.
 * The row starts with status="pending"; a separate poller updates it later.
 *
 * @param {string}   pdf_url
 * @param {string[]} keywords
 * @param {string}   source_name
 * @param {string}   brief_id
 * @param {string}   client_id
 * @param {object}   supabaseClient   The ROBIN supabase singleton
 * @param {object}   [kwargs]         Extra options forwarded to triggerExtraction
 *                                    (source_language, is_flipbook, fuzzy_threshold)
 * @returns {Promise<string>}  job_id
 */
export async function triggerAndStore(
    pdf_url,
    keywords,
    source_name,
    brief_id,
    client_id,
    supabaseClient,
    {
        source_language = 'auto',
        is_flipbook = false,
        fuzzy_threshold = 75,
    } = {},
) {
    // 1. Submit to the microservice
    const jobId = await triggerExtraction(
        pdf_url,
        keywords,
        source_name,
        brief_id,
        client_id,
        source_language,
        is_flipbook,
        fuzzy_threshold,
    );

    // 2. Record in ROBIN's brief_newspaper_jobs table
    const { error: dbErr } = await supabaseClient
        .from('brief_newspaper_jobs')
        .insert({
            brief_id,
            job_id:      jobId,
            source_name,
            pdf_url,
            status:      'pending',
            match_count: 0,
        });

    if (dbErr) {
        // Log but don't throw — the job is already submitted to the service.
        // A manual resync can recover the DB row later.
        log.system.error('newspaper-intel: failed to store job in brief_newspaper_jobs', {
            jobId,
            briefId: brief_id,
            sourceName: source_name,
            error: dbErr.message,
        });
    } else {
        log.system.info('newspaper-intel: job stored in brief_newspaper_jobs', {
            jobId,
            briefId: brief_id,
            sourceName: source_name,
        });
    }

    return jobId;
}
