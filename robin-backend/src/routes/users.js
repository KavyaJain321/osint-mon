// ============================================================
// ROBIN OSINT — Users Routes
// User management, invitations, profile
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { log } from '../lib/logger.js';

const router = Router();
router.use(authenticate);

// BUG FIX #7: Changed 'ANALYST' → 'USER' to match the roles used by roleCheck.js
// and the rest of the system. 'ANALYST' was not a valid role anywhere else, so
// users invited with that role would fail role checks and be essentially locked out.
const InviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['ADMIN', 'USER']).default('USER'),
});

// GET /me — Current user profile
router.get('/me', (req, res) => {
    res.json(req.user);
});

// GET / — List users for this client (ADMIN/SUPER_ADMIN)
router.get('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        let query = supabase.from('users').select('id, email, full_name, role, client_id, created_at, last_seen_at');

        if (req.user.role !== 'SUPER_ADMIN') {
            query = query.eq('client_id', req.user.clientId);
        }

        const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        log.api.error('GET /users failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// POST /invite — Invite user by email (ADMIN only)
router.post('/invite', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const parsed = InviteSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });

        const clientId = req.user.role === 'SUPER_ADMIN' ? (req.body.clientId || req.user.clientId) : req.user.clientId;

        const { error } = await supabase.auth.admin.inviteUserByEmail(parsed.data.email, {
            data: { client_id: clientId, role: parsed.data.role },
        });

        if (error) throw error;
        res.status(201).json({ message: 'Invitation sent', email: parsed.data.email });
    } catch (error) {
        log.api.error('POST /users/invite failed', { error: error.message });
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

// PATCH /:id/role — Change user role (ADMIN only, cannot change own)
router.patch('/:id/role', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }

        const { role } = req.body;
        // BUG FIX #7: Align role validation with the system's actual role set.
        if (!['ADMIN', 'USER'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be ADMIN or USER.' });
        }

        const { data, error } = await supabase
            .from('users')
            .update({ role })
            .eq('id', req.params.id)
            .eq('client_id', req.user.clientId)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        log.api.error('PATCH /users/:id/role failed', { error: error.message });
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// DELETE /:id — Remove user (ADMIN only)
router.delete('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }

        // BUG FIX #29: SUPER_ADMIN has no clientId (null), so filtering by client_id
        // silently matched 0 rows and returned success without deleting anything.
        let query = supabase.from('users').delete().eq('id', req.params.id);
        if (req.user.role !== 'SUPER_ADMIN') {
            query = query.eq('client_id', req.user.clientId);
        }
        const { error } = await query;
        if (error) throw error;
        res.json({ message: 'User removed' });
    } catch (error) {
        log.api.error('DELETE /users/:id failed', { error: error.message });
        res.status(500).json({ error: 'Failed to remove user' });
    }
});

export default router;
