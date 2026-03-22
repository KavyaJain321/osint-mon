// ============================================================
// ROBIN OSINT — Chat API Route (SSE Streaming)
// The feature that defines the product
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { chatLimiter } from '../middleware/rateLimiter.js';
import { generateChatResponseStream } from '../ai/chat-rag.js';
import { log } from '../lib/logger.js';

const router = Router();
router.use(authenticate);
router.use(chatLimiter);

const ChatSchema = z.object({
    question: z.string().min(5).max(1000),
});

// POST / — Submit question, receive streaming AI response
router.post('/', async (req, res) => {
    try {
        const parsed = ChatSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Question must be 5–1000 characters' });

        // Fetch client name
        const { data: client } = await supabase
            .from('clients')
            .select('name')
            .eq('id', req.user.clientId)
            .single();

        const clientName = client?.name || 'Unknown';

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let aborted = false;
        req.on('close', () => { aborted = true; });

        // Stream response — BUG FIX #4: pass req.user.id so chat history is stored
        // against the actual requesting user, not the first user found for the client.
        const stream = generateChatResponseStream(parsed.data.question, req.user.clientId, clientName, req.user.id);

        for await (const token of stream) {
            if (aborted) break;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }

        if (!aborted) {
            res.write('data: [DONE]\n\n');
        }
        res.end();
    } catch (error) {
        log.chat.error('Chat stream failed', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Chat failed' });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

// GET /history — Past chats for current user
router.get('/history', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('chat_history')
            .select('id, question, answer, created_at')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        const formatted = (data || []).map((chat) => ({
            ...chat,
            answer: chat.answer?.substring(0, 200) + (chat.answer?.length > 200 ? '...' : ''),
        }));

        res.json(formatted);
    } catch (error) {
        log.api.error('GET /chat/history failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

// GET /history/:id — Full chat entry
router.get('/history/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('chat_history')
            .select('*')
            .eq('id', req.params.id)
            .eq('user_id', req.user.id)
            .single();

        if (error || !data) return res.status(404).json({ error: 'Chat not found' });
        res.json(data);
    } catch (error) {
        log.api.error('GET /chat/history/:id failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch chat entry' });
    }
});

export default router;
