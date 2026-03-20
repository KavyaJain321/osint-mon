// ============================================================
// ROBIN OSINT — Unit Tests: newspaper-intel-client.js
//
// Uses Node.js built-in test runner (node:test) + node:assert.
// No extra dependencies required — works on Node 20+.
//
// Run:  npm test
//  or:  node --test tests/newspaper-intel-client.test.js
//
// All HTTP calls are mocked via globalThis.fetch replacement so
// no real network requests are made during tests.
// ============================================================

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Set required env vars before importing the module ────────
process.env.NEWSPAPER_INTEL_URL = 'https://test-intel.example.com';
process.env.NEWSPAPER_INTEL_KEY = 'test-secret-key';

// ── Silence logger output during tests ───────────────────────
// We patch the log module lazily so index.js / logger aren't loaded.
// The client uses log.system.info / log.system.error / log.system.warn.
const mockLog = {
    system: {
        info:  () => {},
        warn:  () => {},
        error: () => {},
    },
};

// Intercept the logger import via a module mock shim
// (Node's mock.module is used for ESM mocking)
import { register } from 'node:module';

// ── Import the module under test ─────────────────────────────
// We do a dynamic import so env vars are set first.
const {
    triggerExtraction,
    getJobStatus,
    pollUntilComplete,
    triggerAndStore,
} = await import('../src/services/newspaper-intel-client.js');

// ── Helper: build a minimal fetch mock ───────────────────────
function makeFetchMock(status, body) {
    return async () => ({
        ok:     status >= 200 && status < 300,
        status,
        text:   async () => JSON.stringify(body),
        json:   async () => body,
    });
}

// ── Capture + restore globalThis.fetch ───────────────────────
let originalFetch;
before(() => { originalFetch = globalThis.fetch; });
after(()  => { globalThis.fetch = originalFetch; });

// ── Shared Supabase mock ──────────────────────────────────────
const makeSupabaseMock = (insertError = null) => ({
    from: () => ({
        insert: async () => ({ error: insertError }),
    }),
});

// ============================================================
// triggerExtraction
// ============================================================
describe('triggerExtraction', () => {

    it('returns job_id on successful 200 response', async () => {
        globalThis.fetch = makeFetchMock(200, { job_id: 'job-abc-123', status: 'queued' });

        const jobId = await triggerExtraction(
            'https://example.com/paper.pdf',
            ['Odisha', 'flood'],
            'Samaja',
            'brief-001',
            'client-001',
        );
        assert.equal(jobId, 'job-abc-123');
    });

    it('throws on HTTP 4xx error', async () => {
        globalThis.fetch = makeFetchMock(401, { detail: 'Unauthorized' });

        await assert.rejects(
            () => triggerExtraction(
                'https://example.com/paper.pdf',
                ['keyword'],
                'Samaja', 'brief-001', 'client-001',
            ),
            /HTTP 401/,
        );
    });

    it('throws on HTTP 500 error', async () => {
        globalThis.fetch = makeFetchMock(500, { detail: 'Internal Server Error' });

        await assert.rejects(
            () => triggerExtraction(
                'https://example.com/paper.pdf',
                ['keyword'],
                'Dharitri', 'brief-001', 'client-001',
            ),
            /HTTP 500/,
        );
    });

    it('throws when job_id is missing from response', async () => {
        globalThis.fetch = makeFetchMock(200, { status: 'queued' }); // no job_id

        await assert.rejects(
            () => triggerExtraction(
                'https://example.com/paper.pdf',
                ['keyword'],
                'Samaja', 'brief-001', 'client-001',
            ),
            /missing job_id/,
        );
    });

    it('throws when pdf_url is empty', async () => {
        await assert.rejects(
            () => triggerExtraction('', ['kw'], 'Samaja', 'b-1', 'c-1'),
            /pdf_url is required/,
        );
    });

    it('throws when keywords array is empty', async () => {
        await assert.rejects(
            () => triggerExtraction('https://x.com/p.pdf', [], 'Samaja', 'b-1', 'c-1'),
            /keywords array must not be empty/,
        );
    });

    it('throws when source_name is missing', async () => {
        await assert.rejects(
            () => triggerExtraction('https://x.com/p.pdf', ['kw'], '', 'b-1', 'c-1'),
            /source_name is required/,
        );
    });

    it('passes is_flipbook and fuzzy_threshold to the request body', async () => {
        let capturedBody;
        globalThis.fetch = async (_url, opts) => {
            capturedBody = JSON.parse(opts.body);
            return { ok: true, status: 200, json: async () => ({ job_id: 'j-999' }) };
        };

        await triggerExtraction(
            'https://example.com/paper.pdf',
            ['flood'],
            'Times of India',
            'brief-002',
            'client-002',
            'en',
            true,   // is_flipbook
            80,     // fuzzy_threshold
        );

        assert.equal(capturedBody.is_flipbook, true);
        assert.equal(capturedBody.fuzzy_threshold, 80);
        assert.equal(capturedBody.source_language, 'en');
    });

    it('sends X-Service-Key header', async () => {
        let capturedHeaders;
        globalThis.fetch = async (_url, opts) => {
            capturedHeaders = opts.headers;
            return { ok: true, status: 200, json: async () => ({ job_id: 'j-hdr' }) };
        };

        await triggerExtraction(
            'https://example.com/paper.pdf',
            ['kw'],
            'The Hindu', 'brief-001', 'client-001',
        );

        assert.equal(capturedHeaders['X-Service-Key'], 'test-secret-key');
    });
});

// ============================================================
// getJobStatus
// ============================================================
describe('getJobStatus', () => {

    it('returns job object on 200', async () => {
        const payload = {
            job_id:  'job-xyz',
            status:  'completed',
            result:  { total_matches: 3, articles: [] },
        };
        globalThis.fetch = makeFetchMock(200, payload);

        const result = await getJobStatus('job-xyz');
        assert.deepEqual(result, payload);
    });

    it('returns null on 404', async () => {
        globalThis.fetch = makeFetchMock(404, { detail: 'Not found' });

        const result = await getJobStatus('job-does-not-exist');
        assert.equal(result, null);
    });

    it('throws on HTTP 500', async () => {
        globalThis.fetch = makeFetchMock(500, { detail: 'Server error' });

        await assert.rejects(
            () => getJobStatus('job-xyz'),
            /HTTP 500/,
        );
    });

    it('throws when jobId is falsy', async () => {
        await assert.rejects(
            () => getJobStatus(''),
            /jobId is required/,
        );
    });

    it('URL-encodes the job ID in the path', async () => {
        let capturedUrl;
        globalThis.fetch = async (url) => {
            capturedUrl = url;
            return { ok: true, status: 200, json: async () => ({ job_id: 'a/b', status: 'completed' }) };
        };

        await getJobStatus('a/b');
        assert.ok(capturedUrl.includes('a%2Fb'), `Expected encoded URL, got: ${capturedUrl}`);
    });
});

// ============================================================
// pollUntilComplete
// ============================================================
describe('pollUntilComplete', () => {

    it('returns immediately when job is already completed', async () => {
        const payload = { job_id: 'j1', status: 'completed', result: { total_matches: 2 } };
        globalThis.fetch = makeFetchMock(200, payload);

        const result = await pollUntilComplete('j1', 1, 30);
        assert.equal(result.status, 'completed');
        assert.equal(result.result.total_matches, 2);
    });

    it('returns when job transitions from queued → completed', async () => {
        let callCount = 0;
        globalThis.fetch = async () => {
            callCount++;
            const status = callCount < 3 ? 'processing' : 'completed';
            return {
                ok: true, status: 200,
                json: async () => ({ job_id: 'j2', status, result: { total_matches: 5 } }),
            };
        };

        const result = await pollUntilComplete('j2', 0.05, 10); // 50ms poll, 10s timeout
        assert.equal(result.status, 'completed');
        assert.ok(callCount >= 3, `Expected at least 3 calls, got ${callCount}`);
    });

    it('returns when job status is "failed"', async () => {
        globalThis.fetch = makeFetchMock(200, { job_id: 'j3', status: 'failed', error: 'OCR crashed' });

        const result = await pollUntilComplete('j3', 0.05, 5);
        assert.equal(result.status, 'failed');
    });

    it('throws TimeoutError when job never completes', async () => {
        globalThis.fetch = makeFetchMock(200, { job_id: 'j4', status: 'processing' });

        await assert.rejects(
            () => pollUntilComplete('j4', 0.05, 0.2), // 200ms timeout, 50ms poll
            /timed out/i,
        );
    });

    it('throws when job is not found during polling', async () => {
        globalThis.fetch = makeFetchMock(404, { detail: 'Not found' });

        await assert.rejects(
            () => pollUntilComplete('j5', 0.05, 5),
            /not found during polling/,
        );
    });
});

// ============================================================
// triggerAndStore
// ============================================================
describe('triggerAndStore', () => {

    it('returns job_id and inserts a row into brief_newspaper_jobs', async () => {
        globalThis.fetch = makeFetchMock(200, { job_id: 'job-store-1', status: 'queued' });
        const supabase = makeSupabaseMock();

        const jobId = await triggerAndStore(
            'https://example.com/paper.pdf',
            ['flood', 'Odisha'],
            'Samaja',
            'brief-001',
            'client-001',
            supabase,
        );

        assert.equal(jobId, 'job-store-1');
    });

    it('still returns job_id even when DB insert fails', async () => {
        globalThis.fetch = makeFetchMock(200, { job_id: 'job-store-2', status: 'queued' });
        const supabase = makeSupabaseMock({ message: 'DB connection refused' });

        // Should NOT throw — DB failure is logged but not fatal
        const jobId = await triggerAndStore(
            'https://example.com/paper.pdf',
            ['keyword'],
            'Dharitri',
            'brief-002',
            'client-002',
            supabase,
        );

        assert.equal(jobId, 'job-store-2');
    });

    it('throws when the microservice call fails', async () => {
        globalThis.fetch = makeFetchMock(503, { detail: 'Service unavailable' });
        const supabase = makeSupabaseMock();

        await assert.rejects(
            () => triggerAndStore(
                'https://example.com/paper.pdf',
                ['keyword'],
                'Samaja', 'brief-001', 'client-001',
                supabase,
            ),
            /HTTP 503/,
        );
    });

    it('forwards kwargs (is_flipbook, fuzzy_threshold) to triggerExtraction', async () => {
        let capturedBody;
        globalThis.fetch = async (_url, opts) => {
            capturedBody = JSON.parse(opts.body);
            return { ok: true, status: 200, json: async () => ({ job_id: 'j-kw' }) };
        };
        const supabase = makeSupabaseMock();

        await triggerAndStore(
            'https://example.com/paper.pdf',
            ['kw'],
            'Times of India', 'brief-003', 'client-003',
            supabase,
            { is_flipbook: true, fuzzy_threshold: 80, source_language: 'en' },
        );

        assert.equal(capturedBody.is_flipbook, true);
        assert.equal(capturedBody.fuzzy_threshold, 80);
    });
});

// ============================================================
// newspaper-sources helpers (imported inline for isolation)
// ============================================================
import {
    SOURCES,
    getSourcesForBrief,
    getSourceNames,
} from '../src/services/newspaper-sources.js';

describe('getSourcesForBrief', () => {

    it('returns all sources when called with empty state list', () => {
        const result = getSourcesForBrief([]);
        assert.equal(result.length, SOURCES.length);
    });

    it('returns national papers + Odisha-specific papers for Odisha', () => {
        const result = getSourcesForBrief(['Odisha']);
        const names = result.map(s => s.name);

        // Odisha-specific
        assert.ok(names.includes('Samaja'),    'Expected Samaja');
        assert.ok(names.includes('Dharitri'),  'Expected Dharitri');
        // National papers (geographic_states: ['all'])
        assert.ok(names.includes('The Hindu'),         'Expected The Hindu');
        assert.ok(names.includes('Times of India'),    'Expected Times of India');
        assert.ok(names.includes('Hindustan Times'),   'Expected Hindustan Times');
    });

    it('filters by language when languages list provided', () => {
        const result = getSourcesForBrief(['Odisha'], ['or']);
        const names = result.map(s => s.name);
        assert.ok(names.includes('Samaja'));
        assert.ok(names.includes('Dharitri'));
        // English papers should be excluded
        assert.ok(!names.includes('The Hindu'));
        assert.ok(!names.includes('Times of India'));
    });

    it('matches on city name as well as state', () => {
        const result = getSourcesForBrief(['Bhubaneswar']);
        const names = result.map(s => s.name);
        assert.ok(names.includes('Samaja'));
        assert.ok(names.includes('Dharitri'));
    });

    it('returns no duplicates', () => {
        const result = getSourcesForBrief(['Odisha', 'Odisha', 'Bhubaneswar']);
        const names = result.map(s => s.name);
        const unique = [...new Set(names)];
        assert.equal(names.length, unique.length);
    });

    it('returns Andhra Pradesh papers for Hyderabad focus', () => {
        const result = getSourcesForBrief(['Telangana']);
        const names = result.map(s => s.name);
        assert.ok(names.includes('Eenadu'));
    });

    it('returns Bengali papers for West Bengal', () => {
        // Anandabazar Patrika uses the full name 'West Bengal'
        // Prabhat Khabar uses the abbreviation 'WB' — search both to cover both
        const result = getSourcesForBrief(['West Bengal', 'WB']);
        const names = result.map(s => s.name);
        assert.ok(names.includes('Anandabazar Patrika'), 'Expected Anandabazar Patrika');
        assert.ok(names.includes('Prabhat Khabar'), 'Expected Prabhat Khabar (registered as WB)');
    });
});

describe('getSourceNames', () => {
    it('returns an array of strings', () => {
        const names = getSourceNames();
        assert.ok(Array.isArray(names));
        assert.ok(names.every(n => typeof n === 'string'));
    });

    it('contains exactly as many entries as SOURCES', () => {
        assert.equal(getSourceNames().length, SOURCES.length);
    });

    it('includes known newspapers', () => {
        const names = getSourceNames();
        for (const expected of ['Samaja', 'Dharitri', 'Times of India', 'The Hindu', 'Eenadu']) {
            assert.ok(names.includes(expected), `Missing: ${expected}`);
        }
    });
});
