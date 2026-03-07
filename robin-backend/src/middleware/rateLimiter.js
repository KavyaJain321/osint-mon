// ============================================================
// ROBIN OSINT — Rate Limiters
// ============================================================

import rateLimit from 'express-rate-limit';

// General API: 500 requests per 15 minutes per IP
// Dashboard makes ~8 parallel calls per page, so 100 was too low
export const defaultLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});

// Auth endpoints: 20 requests per 15 minutes
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please wait.' },
});

// Chat endpoint: 60 requests per hour per IP
export const chatLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Chat rate limit reached. Please wait before sending more messages.' },
});
