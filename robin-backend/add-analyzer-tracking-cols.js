// ============================================================
// ROBIN OSINT — Migration: Add analyzer tracking columns
// Adds analyzer_used and model_used to article_analysis table.
// Safe to run multiple times (uses IF NOT EXISTS).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

async function migrate() {
    console.log('🔧 Running migration: add analyzer tracking columns...\n');

    // Supabase JS client doesn't support raw DDL — use rpc('exec_sql', ...) if available,
    // or fall back to inserting a dummy row and checking the error.
    // The cleanest approach is to try upserting with the new fields and check if they exist.

    // Test whether analyzer_used column exists by trying a select
    const { error: testErr } = await supabase
        .from('article_analysis')
        .select('analyzer_used, model_used')
        .limit(1);

    if (!testErr) {
        console.log('✅ Columns analyzer_used and model_used already exist in article_analysis.');
        console.log('   No migration needed.\n');
        process.exit(0);
    }

    if (testErr && !testErr.message.includes('analyzer_used') && !testErr.message.includes('column')) {
        console.error('❌ Unexpected error checking columns:', testErr.message);
        process.exit(1);
    }

    // Columns are missing — provide SQL to run manually
    console.log('⚠️  Columns are missing. Run the following SQL in your Supabase SQL Editor:');
    console.log('');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`ALTER TABLE article_analysis
  ADD COLUMN IF NOT EXISTS analyzer_used TEXT,
  ADD COLUMN IF NOT EXISTS model_used TEXT;`);
    console.log('─────────────────────────────────────────────────────────────');
    console.log('');
    console.log('Steps:');
    console.log('  1. Open Supabase Dashboard → SQL Editor');
    console.log('  2. Paste and run the SQL above');
    console.log('  3. Re-run this script to verify ✅');
    console.log('');

    // Try via rpc if available (some Supabase setups expose exec_sql)
    const sql = `
        ALTER TABLE article_analysis ADD COLUMN IF NOT EXISTS analyzer_used TEXT;
        ALTER TABLE article_analysis ADD COLUMN IF NOT EXISTS model_used TEXT;
    `;
    
    const { error: rpcErr } = await supabase.rpc('exec_sql', { query: sql });
    if (!rpcErr) {
        console.log('✅ Migration applied automatically via RPC!');
    } else {
        console.log('ℹ️  RPC exec_sql not available — please run the SQL manually as shown above.');
    }

    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration error:', err.message);
    process.exit(1);
});
