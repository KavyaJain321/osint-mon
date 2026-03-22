// ============================================================
// ROBIN OSINT — Auth Routes
// POST /api/auth/login  — exchange email/password for JWT
// POST /api/auth/logout — client-side (token cleared; endpoint for completeness)
// ============================================================

import express from 'express';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { config } from '../config.js';

const router = express.Router();

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        // 1. Authenticate with Supabase Auth
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error || !data?.session) {
            log.auth?.warn?.('Login failed', { email, error: error?.message });
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const { session, user } = data;

        // 2. Fetch the user profile from our users table
        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('id, email, full_name, role, client_id')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return res.status(403).json({ error: 'User profile not found. Contact your administrator.' });
        }

        // 3. Update last_seen_at (fire-and-forget)
        supabase
            .from('users')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('id', profile.id)
            .then(() => { });

        log.auth?.info?.('Login successful', { email, role: profile.role, clientId: profile.client_id });

        // 4. Return token + user info
        return res.json({
            token: session.access_token,
            refresh_token: session.refresh_token,
            user: {
                id: profile.id,
                email: profile.email,
                fullName: profile.full_name,
                role: profile.role,
                clientId: profile.client_id,
            },
        });
    } catch (err) {
        log.auth?.error?.('Login error', { error: err.message });
        return res.status(500).json({ error: 'Authentication failed' });
    }
});

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', (req, res) => {
    return res.json({ message: 'Logged out successfully' });
});

// ── POST /api/auth/reset-password ────────────────────────────
router.post('/reset-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        // Supabase sends the reset email automatically
        // BUG FIX #28: Use config.frontendUrl (validated at startup) instead of
        // process.env.FRONTEND_URL directly, which bypasses startup validation.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${config.frontendUrl}/auth/update-password`,
        });

        if (error) {
            log.auth?.warn?.('Password reset failed', { email, error: error.message });
        }

        // Always return 200 to prevent email enumeration
        return res.json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (err) {
        return res.status(500).json({ error: 'Reset request failed' });
    }
});

// ── POST /api/auth/refresh ───────────────────────────────────
// Exchange a refresh_token for a new access_token (handles 1hr Supabase expiry)
router.post('/refresh', async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
    try {
        const { data, error } = await supabase.auth.refreshSession({ refresh_token });
        if (error || !data?.session) {
            return res.status(401).json({ error: 'Token refresh failed. Please log in again.' });
        }
        return res.json({
            token: data.session.access_token,
            refresh_token: data.session.refresh_token,
        });
    } catch (err) {
        return res.status(500).json({ error: 'Refresh failed' });
    }
});

export default router;
