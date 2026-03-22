// ============================================================
// setup-rigior.js — Create RIGIOR client and users
// ============================================================

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

async function setupRigior() {
    console.log('[RIGIOR] Starting setup...');

    // 1. Create client
    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .insert({ name: 'RIGIOR', industry: 'Maritime Intelligence & Strategy' })
        .select().single();

    if (clientErr) {
        console.error('[RIGIOR] Client creation failed:', clientErr.message);
        return;
    }
    console.log(`[RIGIOR] Client Created: ${client.id}`);

    // 2. Generate random passwords
    const adminPass = 'RIGIOR_Admin@' + Math.random().toString(36).slice(-8);
    const analystPass = 'RIGIOR_Analyst@' + Math.random().toString(36).slice(-8);

    const users = [
        { email: 'admin@rigior.com', role: 'SUPER_ADMIN', name: 'RIGIOR Administrator', password: adminPass },
        { email: 'analyst@rigior.com', role: 'ANALYST', name: 'RIGIOR Senior Analyst', password: analystPass }
    ];

    console.log('\n--- Credentials ---');
    for (const u of users) {
        console.log(`Generating user: ${u.email}...`);
        
        // Create in auth.users
        const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
            email: u.email,
            password: u.password,
            email_confirm: true,
            user_metadata: { full_name: u.name, role: u.role, client_id: client.id }
        });

        if (authErr) {
            console.error(`[RIGIOR] Error creating auth user ${u.email}:`, authErr.message);
            continue;
        }

        // Create in public.users (manual insert to be sure)
        const { error: userErr } = await supabase.from('users').upsert({
            id: authUser.user.id,
            email: u.email,
            full_name: u.name,
            role: u.role,
            client_id: client.id
        });

        if (userErr) {
            console.error(`[RIGIOR] Error creating public user ${u.email}:`, userErr.message);
        } else {
            console.log(`[OK] User: ${u.email} | Role: ${u.role}`);
            console.log(`[PASSWORD]: ${u.password}\n`);
        }
    }
    console.log('--- Setup Complete ---');
}

setupRigior()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[RIGIOR] Fatal:', err.message);
        process.exit(1);
    });
