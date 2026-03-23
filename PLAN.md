# ROBIN OSINT — Master Execution Plan
> Last Updated: 2026-03-23
> Status: Phase 1 starting
> Read this at the START of every session before touching any code.

---

## SYSTEM OVERVIEW (Current State)

| Layer | Where | Status |
|-------|-------|--------|
| Frontend | Vercel (robin-frontend) | ✅ Live |
| Backend API | Render Free Tier (robin-backend) | ✅ Live — 512MB RAM |
| Database | Supabase (PostgreSQL + pgvector) | ✅ Live |
| AI Provider | Groq API (6 keys rotating) | ⚠️ 429 errors constant |
| GPU Server | TRIJYA-7 (RTX 4090, Tailscale: 100.92.126.27) | ⏳ Not connected yet |
| Video Pipeline | Broken on Render (OOM) | ❌ Not working |

**Core Problem:** All AI work (article analysis, embeddings, chat, batch intel, video) goes to Groq. 6 keys rotate but still hit rate limits constantly. TRIJYA-7 with RTX 4090 exists but is not connected.

**Core Solution:** Route all AI jobs through Supabase queue → TRIJYA-7 picks up and processes locally (llama3.1:70b via Ollama) → Groq only as fallback when TRIJYA-7 is offline.

---

## KEY FILES REFERENCE

```
robin-backend/src/
├── ai/
│   ├── analysis-worker.js      ← Analyzes articles (calls Groq per article)
│   ├── batch-intelligence.js   ← 7-pass intelligence (6-8 Groq calls per client)
│   └── chat-rag.js             ← RAG chat (Groq streaming)
├── scrapers/
│   ├── orchestrator.js         ← Master scraper (manages all crawlers)
│   ├── rss-crawler.js
│   ├── html-crawler.js
│   └── [other crawlers]
├── services/
│   ├── embedding.js            ← Generates pgvector embeddings (Groq)
│   ├── local-analyzer.js       ← Rule-based fallback when Groq fails
│   └── video-processor/        ← Video pipeline (broken on Render)
├── scheduler/
│   └── cron.js                 ← Scraper every N hours, batch intel at 2AM UTC
├── lib/
│   └── supabase.js             ← Supabase client
└── config.js                   ← All env vars

Environment variables (Render):
  GROQ_API_KEY_1 through _6     ← 6 Groq keys rotating
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  RENDER_SKIP_BROWSER=true      ← Saves RAM on free tier
```

---

## GIT WORKFLOW RULE
> **Do NOT push to GitHub after individual changes.**
> Commit locally after each change (`git commit`), but only push when the user explicitly says "push to GitHub".
> This keeps the live Render/Vercel deployment stable while changes accumulate locally.

---

## EXECUTION PHASES

| Phase | What | Sessions | Status |
|-------|------|----------|--------|
| 1 | Database indexes + Source health | 1-2 | ⏳ Next |
| 2 | TRIJYA-7 remote setup (manual) | 1 manual | ⏳ Waiting for server access |
| 3 | AI Job Queue (Supabase table + ai-provider.js) | 2-3 | ⏳ Pending |
| 4 | TRIJYA-7 Worker codebase | 2-3 | ⏳ Pending |
| 5 | Rewire AI calls (analysis, batch, chat, video) | 3-4 | ⏳ Pending |
| 6 | Analysis quality tracking | 1 | ⏳ Pending |
| 7 | Event-driven batch intelligence | 1 | ⏳ Pending |
| 8 | Testing + deployment | 1-2 | ⏳ Pending |

---

---

# PHASE 1 — DATABASE INDEXES + SOURCE HEALTH
## Session 1 (Code: ~1 hour | Manual Supabase: 20 min)

### WHY THIS FIRST
- Database indexes = instant query speedup, zero risk, 30 min work
- Source health = stops wasting CPU on dead sources (thesamaja.in has been failing for weeks)
- Both are database-only changes — nothing can break in the application

---

### STEP 1-A: Run SQL in Supabase Dashboard (YOU DO THIS MANUALLY)

**How to get there:**
1. Go to https://supabase.com → Sign in
2. Click your ROBIN project
3. Click **SQL Editor** in the left sidebar
4. Click **New query**
5. Paste the SQL below → Click **Run**

**SQL to run (copy-paste this exactly):**

```sql
-- ============================================================
-- ROBIN OSINT — Phase 1 SQL
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. INDEXES — Query performance
-- Articles: most queried by client + date
CREATE INDEX IF NOT EXISTS idx_articles_client_published
  ON articles (client_id, published_at DESC);

-- Articles: sentiment filtering (used in Media Tone, Political Analysis)
CREATE INDEX IF NOT EXISTS idx_articles_client_sentiment
  ON articles (client_id, sentiment);

-- Articles: importance sorting (used everywhere)
CREATE INDEX IF NOT EXISTS idx_articles_importance
  ON articles (client_id, importance_score DESC);

-- Article analysis: join performance
CREATE INDEX IF NOT EXISTS idx_article_analysis_article_id
  ON article_analysis (article_id);

-- Entity mentions: entity lookups
CREATE INDEX IF NOT EXISTS idx_entity_mentions_client_name
  ON entity_mentions (client_id, entity_name);

-- Sources: active source fetching (called every scrape cycle)
CREATE INDEX IF NOT EXISTS idx_sources_client_active
  ON sources (client_id, is_active);

-- Intelligence signals: recent signals by client
CREATE INDEX IF NOT EXISTS idx_signals_client_created
  ON intelligence_signals (client_id, created_at DESC);

-- ============================================================
-- 2. SOURCE HEALTH TRACKING — Add columns to sources table
-- ============================================================

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'healthy'
    CHECK (health_status IN ('healthy', 'degraded', 'dead')),
  ADD COLUMN IF NOT EXISTS auto_disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_articles_scraped INTEGER DEFAULT 0;

-- Index for health dashboard queries
CREATE INDEX IF NOT EXISTS idx_sources_health
  ON sources (health_status, consecutive_failures DESC);

-- ============================================================
-- 3. AI JOBS QUEUE TABLE (needed for Phase 3 — create now)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Job definition
  type TEXT NOT NULL,
  -- Valid types: 'article_analysis', 'article_embed', 'chat_response',
  --              'batch_intel', 'video_transcribe', 'video_summarize',
  --              'brief_process', 'daily_intel'

  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  -- 1 = urgent (user waiting), 5 = normal, 10 = background

  payload JSONB NOT NULL,
  -- Input data for the job

  -- Status
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),

  -- Results
  result JSONB,
  error TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Metadata
  client_id UUID,
  worker TEXT,        -- 'trijya-7' or 'groq-fallback'
  model_used TEXT,    -- 'llama3.1:70b' or 'llama-3.3-70b-versatile'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Auto-cleanup after 24 hours
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours')
);

-- Fast polling index (TRIJYA-7 worker queries this every 5 seconds)
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pending
  ON ai_jobs (priority ASC, created_at ASC)
  WHERE status = 'pending';

-- Cleanup index
CREATE INDEX IF NOT EXISTS idx_ai_jobs_expires
  ON ai_jobs (expires_at)
  WHERE status IN ('completed', 'failed');

-- ============================================================
-- VERIFY — Run this after the above to confirm everything worked
-- ============================================================
SELECT
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE tablename IN ('articles', 'article_analysis', 'entity_mentions', 'sources', 'intelligence_signals', 'ai_jobs')
ORDER BY tablename, indexname;
```

**Expected result:** A table showing all indexes created. If you see errors, copy them and tell Claude.

---

### STEP 1-B: Code Changes (Claude does this)

After the SQL above is run, tell Claude:
> "Phase 1 SQL is done, start the orchestrator source health code changes"

Claude will modify:
- `robin-backend/src/scrapers/orchestrator.js` — add failure tracking + auto-disable logic
- Test with TypeScript check
- Commit and push

---

---

# PHASE 2 — TRIJYA-7 REMOTE SETUP
## (YOU DO THIS MANUALLY — No code from Claude needed)

**Do this when you have access to the office network or Tailscale is connected on your laptop.**

---

### STEP 2-A: Connect to TRIJYA-7 via SSH

**From your laptop terminal (CMD or PowerShell or any SSH client):**

```bash
# If you are in the office (same WiFi network):
ssh Admin@192.168.29.50

# If you are outside office (Tailscale must be installed on your laptop):
ssh Admin@100.92.126.27

# Password when prompted:
Red@0909
```

**If SSH doesn't work:**
- Check Tailscale is running on your laptop: open Tailscale app, make sure it shows "Connected"
- Check TRIJYA-7 is on: ping 100.92.126.27 — should get replies
- If Tailscale is not installed on your laptop: go to tailscale.com, download, install, sign in with the office Google account

---

### STEP 2-B: Check Current State of the Server

Once SSH is connected, run these one by one:

```bash
# Check GPU status
nvidia-smi

# Check how much VRAM is free right now
nvidia-smi --query-gpu=memory.used,memory.free,memory.total --format=csv

# Check if Ollama is running
curl http://localhost:11434

# See what AI models are already downloaded
ollama list

# Check disk space (need 50GB+ free for models)
df -h
```

**Tell Claude what you see from these commands before proceeding.**

---

### STEP 2-C: Pull the AI Models

**Run these commands one by one. Each will take time to download.**

```bash
# Step 1: Pull the main model (20GB — will take 10-30 min depending on internet)
# This is the brain of everything — llama 3.1 70 billion parameters
ollama pull llama3.1:70b

# Step 2: Pull the fast model (6GB — takes 5-10 min)
# Used when GPU is busy or for simple tasks
ollama pull llama3.1:8b

# Step 3: Pull the tiny model (2GB — takes 2-5 min)
# Used when video editors are using the GPU — runs on CPU
ollama pull llama3.2:3b

# Step 4: Pull the embedding model (800MB — fast)
# Used for semantic search (replaces Groq embeddings)
ollama pull nomic-embed-text

# Verify all are downloaded
ollama list
```

**Expected output of `ollama list`:**
```
NAME                    ID              SIZE    MODIFIED
llama3.1:70b           ...             42 GB   ...
llama3.1:8b            ...             4.9 GB  ...
llama3.2:3b            ...             2.0 GB  ...
nomic-embed-text       ...             274 MB  ...
```

---

### STEP 2-D: Test Ollama is Working

```bash
# Quick test — ask the 70B model a question
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.1:70b",
  "messages": [{"role": "user", "content": "Reply with just the word: WORKING"}],
  "stream": false
}'

# You should see a JSON response with "WORKING" in it
# Takes 5-15 seconds first time (model loading)
```

---

### STEP 2-E: Install Node.js on TRIJYA-7 (if not installed)

```bash
# Check if Node.js is installed
node --version

# If command not found, install it:
# First install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell
source ~/.bashrc

# Install Node.js LTS
nvm install --lts
nvm use --lts

# Verify
node --version   # Should show v20.x.x or higher
npm --version    # Should show 10.x.x or higher
```

---

### STEP 2-F: Create the Worker Folder

```bash
# Create a folder for the ROBIN worker
mkdir -p /home/Admin/robin-worker
cd /home/Admin/robin-worker

# Initialize a Node.js project
npm init -y

# Install dependencies
npm install @supabase/supabase-js node-fetch dotenv

# Create the .env file
nano .env
```

**In the nano editor, paste this (replace with your actual values):**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
OLLAMA_URL=http://localhost:11434
WORKER_NAME=trijya-7
POLL_INTERVAL_MS=5000
GPU_CHECK_INTERVAL_MS=10000
LOG_LEVEL=info
```

**To save in nano:** Press `Ctrl+X` → Press `Y` → Press `Enter`

**Where to find your Supabase values:**
- Go to supabase.com → your project → Settings → API
- Copy `Project URL` → paste as SUPABASE_URL
- Copy `service_role` key (under Project API keys) → paste as SUPABASE_SERVICE_ROLE_KEY

---

### STEP 2-G: Set Ollama to Accept External Connections

By default Ollama only listens on localhost. We need it to listen on all interfaces so the worker can reach it (the worker runs on the same machine, so localhost works — but we also want flexibility):

```bash
# Check if Ollama is running as a service
systemctl status ollama

# If it's a systemd service, edit it:
sudo systemctl edit ollama

# Add these lines in the editor that opens (between the comments):
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"

# Save and restart
sudo systemctl daemon-reload
sudo systemctl restart ollama

# Verify it's running
curl http://localhost:11434
```

**If Ollama is not a systemd service (running manually):**
```bash
# Kill existing Ollama
pkill ollama

# Start with all interfaces
OLLAMA_HOST=0.0.0.0:11434 ollama serve &

# Test
curl http://localhost:11434
```

---

### STEP 2-H: Test Full Connection

From your **laptop** (not the server), run:

```bash
# This tests that Ollama is reachable from outside the server
curl http://100.92.126.27:11434

# Should return: {"message":"Ollama is running"}
```

If this works, TRIJYA-7 is ready. Tell Claude — Phase 3 can begin.

---

---

# PHASE 3 — AI JOB QUEUE BACKEND
## (Claude does this — 2-3 sessions)

**Wait until Phase 2 is confirmed working before starting Phase 3.**

### What gets built:
1. `robin-backend/src/lib/ai-provider.js` — Universal AI function that:
   - Creates a job in `ai_jobs` table
   - Waits for TRIJYA-7 to complete it (polls every 2s, timeout 60s)
   - Falls back to Groq if TRIJYA-7 doesn't pick it up in time
   - Returns the result to the caller — callers don't need to know where it came from

2. Every existing file that calls Groq directly gets updated to call `ai-provider.js` instead:
   - `analysis-worker.js` — Article analysis
   - `batch-intelligence.js` — 7-pass intel
   - `embedding.js` — Vector embeddings
   - `chat-rag.js` — Chat (Groq kept for streaming, TRIJYA-7 for non-streaming)
   - `video-processor/` — Transcription + summarization

**Session 3 starts with:** "Phase 2 is done, TRIJYA-7 is reachable. Start Phase 3 — build ai-provider.js"

---

---

# PHASE 4 — TRIJYA-7 WORKER CODEBASE
## (Claude writes the code, you deploy it)

### What gets built:
`/home/Admin/robin-worker/` on TRIJYA-7 — a Node.js service that:

1. Polls `ai_jobs` table every 5 seconds
2. Checks GPU availability (nvidia-smi) before each job
3. Picks the right Ollama model based on available VRAM:
   - VRAM > 20GB free → llama3.1:70b (full power)
   - VRAM 6-20GB → llama3.1:8b (shared mode)
   - VRAM < 6GB → llama3.2:3b on CPU (rendering mode)
   - CPU > 90% → pause, fallback to Groq
4. Processes these job types:
   - `article_analysis` → Ollama chat (structured JSON output)
   - `article_embed` → Ollama nomic-embed-text
   - `batch_intel` → Ollama chat (multi-pass)
   - `video_transcribe` → Local Whisper (if installed) or Groq Whisper
   - `video_summarize` → Ollama chat
   - `brief_process` → Ollama chat
   - `chat_response` → Ollama chat (kept on Groq for streaming)
5. Writes results back to `ai_jobs` table
6. Runs as a Windows service (auto-starts on boot, survives restarts)

### Manual step after Claude writes the code:

```bash
# On TRIJYA-7 via SSH:
cd /home/Admin/robin-worker

# Copy the worker files Claude created (Claude will give you exact file contents)
# Create each file

# Test run (should see "Polling for jobs...")
node index.js

# If working, install as Windows service so it auto-starts:
npm install -g pm2
pm2 start index.js --name robin-worker
pm2 save
pm2 startup
# Follow the command it gives you
```

---

---

# PHASE 5 — REWIRE ALL AI CALLS
## (Claude does this systematically)

Order of rewiring (safest to riskiest):

1. `embedding.js` — Simplest, clear input/output
2. `analysis-worker.js` — Highest volume, most impact
3. `batch-intelligence.js` — Complex, 7 passes
4. `video-processor/transcription-service.js` — Video pipeline
5. `chat-rag.js` — Keep Groq for streaming, use TRIJYA-7 for non-streaming parts

After each file: run `tsc --noEmit`, commit, push, check Render logs.

---

---

# PHASE 6 — ANALYSIS QUALITY TRACKING
## (Claude does this — 1 session)

Add to `article_analysis` table:
- `analysis_quality: 'high' | 'medium' | 'low'`
- `analyzed_by: 'llama3.1:70b' | 'llama3.1:8b' | 'groq-70b' | 'groq-8b' | 'local-rules'`
- `reanalysis_needed: boolean` — true if analyzed by fallback, re-queue when 70B available

Add re-analysis queue processor in TRIJYA-7 worker.

---

---

# PHASE 7 — EVENT-DRIVEN BATCH INTELLIGENCE
## (Claude does this — 1 session)

Replace the 2AM cron with a trigger that fires after each scrape cycle:

```
Current:  Cron at 2AM → always runs regardless
New:      After scrape cycle ends:
           - If >10 new articles with importance ≥ 7 → Run immediately
           - If >50 new articles total → Run within 30 min
           - Normal → Run after scrape cycle ends
           - No new articles → Skip entirely
```

Changes in: `orchestrator.js` + `scheduler/cron.js`

---

---

# LATER (Phase 8+)

These are real improvements but not blocking anything today:

| Item | When to do |
|------|-----------|
| Source template packs (domain-specific source libraries) | Before 2nd client onboarding |
| Per-client scrape scheduling | When you have 3+ clients |
| Data retention + cleanup policies | When Supabase hits 300MB |
| Smart source discovery (historical success rates) | When source count > 200 |
| Audit logging middleware | Before any government client signs |
| Cross-client intelligence architecture | When 3+ clients active |
| Whisper local installation on TRIJYA-7 | After video pipeline microservice is stable |

---

---

# ENVIRONMENT VARIABLES REFERENCE

### Render Backend (current):
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
GROQ_API_KEY_1= through GROQ_API_KEY_6=
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://your-vercel-url.vercel.app
RENDER_SKIP_BROWSER=true
SCRAPER_INTERVAL_HOURS=2
```

### Render Backend (add in Phase 3):
```
TRIJYA_OLLAMA_URL=http://100.92.126.27:11434
TRIJYA_HEALTH_TIMEOUT_MS=3000
AI_JOB_TIMEOUT_MS=60000
AI_FALLBACK_TO_GROQ=true
```

### TRIJYA-7 Worker (.env):
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OLLAMA_URL=http://localhost:11434
WORKER_NAME=trijya-7
POLL_INTERVAL_MS=5000
GPU_CHECK_INTERVAL_MS=10000
VRAM_TIER1_THRESHOLD_GB=20
VRAM_TIER2_THRESHOLD_GB=6
VRAM_TIER3_THRESHOLD_GB=2
LOG_LEVEL=info
```

---

---

# SESSION LOG
> Update this after each session

| Date | Session | What was done | What's next |
|------|---------|---------------|-------------|
| 2026-03-23 | Planning | Created PLAN.md | Phase 1: Run SQL, then orchestrator changes |
| 2026-03-23 | Phase 1 | SQL complete (all indexes + source health columns + ai_jobs table). orchestrator.js: added updateSourceHealth(), hooked into crawlWithFallback + Google News + Reddit wrappers. Auto-disables source at 15 failures, degrades at 5. Committed locally, NOT pushed. | Phase 2: TRIJYA-7 manual setup (needs server access) |

---

---

# QUICK REFERENCE — TRIJYA-7 SSH

```bash
# Connect (from anywhere with Tailscale):
ssh Admin@100.92.126.27
# Password: Red@0909

# Check GPU
nvidia-smi

# Check free VRAM
nvidia-smi --query-gpu=memory.free --format=csv,noheader

# Check Ollama
curl http://localhost:11434
ollama list

# Check worker status
pm2 status
pm2 logs robin-worker

# Restart worker
pm2 restart robin-worker

# Pull a new model
ollama pull llama3.1:70b

# Test a model
ollama run llama3.2:3b "Say WORKING"
```

---

# QUICK REFERENCE — SUPABASE

```
Dashboard: https://supabase.com/dashboard
SQL Editor: Dashboard → SQL Editor → New Query
Tables: Dashboard → Table Editor
Logs: Dashboard → Logs → Postgres logs
```

---

*This document is the single source of truth. Update SESSION LOG after every session.*
