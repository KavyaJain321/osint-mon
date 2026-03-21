// ============================================================
// ROBIN OSINT — Video Tables Setup (via Supabase REST API)
// Creates video_transcripts, video_clips tables + storage bucket
// Run: node database/setup-video-tables.js
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Use Supabase's PostgREST-compatible SQL endpoint
async function execSQL(sql) {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
    });
    return res;
}

async function setupVideoTables() {
    console.log('Setting up video processing tables...\n');

    // ── 1. Check/Create video_transcripts table ──────────────
    console.log('1. Checking video_transcripts table...');
    const { data: vtCheck, error: vtErr } = await supabase
        .from('video_transcripts')
        .select('id')
        .limit(1);

    if (vtErr && vtErr.message.includes('does not exist')) {
        console.log('   Table does not exist — needs manual creation.');
        console.log('   ⚠️  Please run this SQL in your Supabase SQL Editor:\n');
        console.log(`
CREATE TABLE video_transcripts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    article_id UUID NOT NULL UNIQUE,
    full_text TEXT DEFAULT '',
    segments JSONB DEFAULT '[]'::jsonb,
    words JSONB DEFAULT '[]'::jsonb,
    duration_seconds FLOAT DEFAULT 0,
    language TEXT DEFAULT 'en',
    keyword_occurrences JSONB DEFAULT '[]'::jsonb,
    ai_summary TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_vt_article ON video_transcripts(article_id);
        `);
    } else {
        console.log('   ✅ video_transcripts table exists');
    }

    // ── 2. Check/Create video_clips table ────────────────────
    console.log('\n2. Checking video_clips table...');
    const { data: vcCheck, error: vcErr } = await supabase
        .from('video_clips')
        .select('id')
        .limit(1);

    if (vcErr && vcErr.message.includes('does not exist')) {
        console.log('   Table does not exist — needs manual creation.');
        console.log('   ⚠️  Please run this SQL in your Supabase SQL Editor:\n');
        console.log(`
CREATE TABLE video_clips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    article_id UUID NOT NULL,
    keyword TEXT DEFAULT '',
    start_time FLOAT DEFAULT 0,
    end_time FLOAT DEFAULT 0,
    clip_url TEXT DEFAULT '',
    transcript_segment TEXT DEFAULT '',
    ai_summary TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_vc_article ON video_clips(article_id);
        `);
    } else {
        console.log('   ✅ video_clips table exists');
    }

    // ── 3. Create Supabase Storage bucket ───────────────────
    console.log('\n3. Creating video-clips storage bucket...');
    const { error: bucketErr } = await supabase.storage.createBucket('video-clips', {
        public: true,
        fileSizeLimit: 50 * 1024 * 1024,
    });

    if (bucketErr) {
        if (bucketErr.message.includes('already exists')) {
            console.log('   ✅ video-clips bucket already exists');
        } else {
            console.log('   ⚠️  Bucket error:', bucketErr.message);
        }
    } else {
        console.log('   ✅ video-clips bucket created');
    }

    console.log('\n=== Setup complete ===');
}

setupVideoTables().catch(err => {
    console.error('Setup failed:', err.message);
    process.exit(1);
});
