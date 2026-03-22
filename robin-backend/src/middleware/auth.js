// ============================================================
// ROBIN OSINT — JWT Auth Middleware
// Verifies Bearer token via Supabase, attaches user to req
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { config } from '../config.js';

// BUG FIX #20: config.supabaseAnonKey defaults to '' (empty string) in config.js,
// which is falsy, so `'' || config.supabaseServiceKey` always resolved to the
// service role key — granting elevated admin permissions to the token-verification
// client unnecessarily. Use the anon key directly; fall back only when explicitly absent.
if (!config.supabaseAnonKey) {
    console.warn('[Auth] WARNING: SUPABASE_ANON_KEY is not set. Token verification will use the service role key as a fallback — consider setting SUPABASE_ANON_KEY for proper key separation.');
}
const supabaseAuth = createClient(
    config.supabaseUrl,
    config.supabaseAnonKey || config.supabaseServiceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function authenticate(req, res, next) {
    try {
        // 1. Extract Bearer token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization token' });
        }

        const token = authHeader.split(' ')[1];

        // 2. Verify token with Supabase Auth (use dedicated auth client)
        const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
        if (authError || !user) {
            // BUG FIX #10: Do NOT leak raw Supabase error messages to callers — they
            // can expose internal service states, rate-limit messages, or network details.
            // Log the full detail internally; send a generic message externally.
            log.auth?.warn?.('Token verification failed', { error: authError?.message || 'No user returned', tokenSnippet: token.substring(0, 10) });
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // 3. Fetch user profile from users table (use shared supabase with service key)
        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('id, email, full_name, role, client_id')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            log.auth.warn('User profile not found', { userId: user.id });
            return res.status(403).json({ error: 'User profile not found. Contact administrator.' });
        }

        // 4. Attach user info to request
        req.user = {
            id: profile.id,
            email: profile.email,
            fullName: profile.full_name,
            role: profile.role,
            clientId: profile.client_id,
            client_id: profile.client_id, // alias for route compatibility
        };

        // 5. Update last_seen_at (fire-and-forget)
        supabase
            .from('users')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('id', profile.id)
            .then(() => { });

        next();
    } catch (error) {
        log.auth.error('Authentication failed', { error: error.message });
        return res.status(500).json({ error: 'Authentication failed' });
    }
}
