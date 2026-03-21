// Migration via Supabase session pooler (IPv4-compatible)
// Uses the new "postgres.[project-ref]" username format which accepts
// the service role JWT as password on port 6543 (Supabase session pooler).

const { Client } = require('pg');
require('dotenv').config();

const url = process.env.SUPABASE_URL || '';
const projectRef = url.replace('https://', '').split('.')[0];
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('Project ref:', projectRef);

const client = new Client({
    // Session pooler: supavisor on port 6543 (accepts service role key as password)
    host: `aws-0-ap-south-1.pooler.supabase.com`,
    port: 6543,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: serviceKey,
    ssl: { rejectUnauthorized: false },
});

async function migrate() {
    console.log('\n🔧 Connecting via Supabase Session Pooler...');
    
    try {
        await client.connect();
        console.log('✅ Connected!\n');
        
        console.log('Running: ALTER TABLE article_analysis ADD COLUMN IF NOT EXISTS ...');
        await client.query(`
            ALTER TABLE article_analysis 
            ADD COLUMN IF NOT EXISTS analyzer_used TEXT,
            ADD COLUMN IF NOT EXISTS model_used TEXT;
        `);
        console.log('✅ Columns added!\n');

        // Verify
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'article_analysis' 
            AND column_name IN ('analyzer_used', 'model_used')
            ORDER BY column_name;
        `);
        if (res.rows.length === 0) {
            console.log('⚠️  Columns not found after migration — may already be rolled back');
        } else {
            console.log('Verified columns:');
            res.rows.forEach(r => console.log(`  ✓ ${r.column_name} (${r.data_type})`));
        }
    } catch (err) {
        console.error('❌ Connection/query error:', err.message);

        // Try eu/us pooler as fallback
        if (err.message.includes('connect') || err.message.includes('ECONNREFUSED')) {
            console.log('\nℹ️  Try changing the host in run-migration-v2.cjs to:');
            console.log('    aws-0-us-east-1.pooler.supabase.com');
            console.log('    aws-0-eu-central-1.pooler.supabase.com');
        }
        process.exit(1);
    } finally {
        try { await client.end(); } catch {}
    }
}

migrate();
