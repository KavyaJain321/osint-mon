// ============================================================
// ROBIN OSINT — Centralized Configuration
// Validates all env vars at startup. Fail-fast on missing values.
// ============================================================

import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[Config] FATAL: Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name, defaultValue) {
  return process.env[name] || defaultValue;
}

export const config = {
  // Supabase
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseAnonKey: optionalEnv('SUPABASE_ANON_KEY', ''),

  // Groq AI (keys managed directly by groq.js via GROQ_API_KEY_1 through _6)
  groqApiKey: optionalEnv('GROQ_API_KEY_1', ''),

  // Server
  port: parseInt(optionalEnv('PORT', '3001'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  frontendUrl: optionalEnv('FRONTEND_URL', 'http://localhost:3000'),

  // Scraper
  scraperIntervalHours: parseInt(optionalEnv('SCRAPER_INTERVAL_HOURS', '1'), 10),

  // Newspaper Intelligence Microservice (optional — feature disabled if not set)
  newspaperIntelUrl: optionalEnv('NEWSPAPER_INTEL_URL', ''),
  newspaperIntelKey: optionalEnv('NEWSPAPER_INTEL_KEY', ''),

  // Computed
  get isProduction() {
    return this.nodeEnv === 'production';
  },
  get hasNewspaperIntel() {
    return !!(this.newspaperIntelUrl && this.newspaperIntelKey);
  },
};
