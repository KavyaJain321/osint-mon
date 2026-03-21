# ROBIN Intelligence 
**System Architecture & Technical Specifications Report**

ROBIN is an autonomous, deeply analytical Open-Source Intelligence (OSINT) State Monitoring System. By leveraging high-performance scraping infrastructure and large language models (Llama-3 70B & Whisper), ROBIN transforms raw, disorganized news feeds and multimedia into structured, actionable intelligence alerts.

---

## 1. The Core: "Intelligence Briefs" (Mission Directives)

At the heart of ROBIN is the **Client Brief**. This dictates exactly what the system looks for.

### 1.1 The Human Input
An analyst or user creates a Brief by simply providing a human-readable **Problem Statement** or objective (e.g., *"Monitor state government infrastructure spending, political rivalries, and public discontent in Odisha"*). They tag core entities (politicians, rival parties) and define geographic boundaries.

### 1.2 AI Keyword Generation & Expansion
Robins' backend does not rely on the user to guess exact search terms. When a Brief is activated, it undergoes an algorithmic AI expansion:
1. **The LLM Pass:** The system sends the problem statement to Groq (Llama-3 70B) with strict system instructions to act as an Intelligence Targeting expert.
2. **Expansion Output:** The AI generates up to **50 highly specific keywords**. 
3. **Categorization:** Every keyword is uniquely categorized and weighted:
   - *Primary/Critical Targets* (e.g., the Chief Minister's name in 3 different spellings).
   - *Secondary Themes* (e.g., "tender corruption", "highway delay", "protest").
   - *Locations & Hubs* (e.g., "Bhubaneswar Secretariat", "Cuttack High Court").
4. **Target Matrix:** These 50+ weighted keywords are written to the `brief_generated_keywords` table and become the primary "Target Matrix" that drives all autonomous crawlers and media scrapers across the system. 

---

## 2. Text Intelligence: The Newspaper & Article Pipeline

Textually-based news portals (like *Odisha Bhaskar*, e-papers, etc.) form the bulk of the data ocean. 

### 2.1 Scraping & Ingestion
- **Cron-Triggered Workers:** Distributed Node.js batch workers wake up on cron schedules (e.g., every 30 minutes) and initialize Puppeteer/Cheerio headless scrapers.
- **Queue Interception:** They visit the pre-configured URLs (news sitemaps, RSS feeds, or raw HTML lists). They extract the Title, Summary/Content, Author, and Timestamp.
- **Relevance Pre-Filter:** The scraper compares the scraped unstructured text against the 50 AI-generated keywords from the active Brief. If there is a match, the data is pulled.

### 2.2 Newspaper Data Storage
- **Unified Tables:** Text content is vaulted immediately into the `content_items` (and historically `articles`) tables inside **Supabase PostgreSQL**. 
- **Type Metadata:** The database stores the raw text, the absolute URL limit, and tags it as `content_type = 'article'`. It also logs an array of exactly *which* keywords triggered the fetch (`matched_keywords` column).

### 2.3 The 9-Pass Cognitive Analysis Engine
Once the raw newspaper article rests in the database, the **Batch Intelligence Worker** intercepts it asynchronously. It runs a deep, 9-step LLM extraction:
1. **Sentiment Profiling:** Is this article praising an entity, or highly critical?
2. **Entity Extraction:** Pulls out every mentioned Person, Organization, and Geo-coordinate.
3. **Claim Verification Matrix:** Maps claims to see if a news source is making a factual dispute.
4. **Threat Flagging:** Assigns a 1-10 "Importance Score".
5. **Clustering:** Groups the new article with previous articles over the last 72 hours to form a "Development" (e.g., a single protest turning into a 3-day riot).

---

## 3. Multimedia Intelligence: The Video Pipeline

ROBIN does not just read newspapers; it watches television feeds and vlogs autonomously.

### 3.1 Scraping & Discovery
- Using the identical 50 AI-generated keywords from the Brief, the `youtube-search-crawler.js` repeatedly polls the YouTube Data API to locate trending regional news coverage (like state news channels). 

### 3.2 The Zero-Click Post-Processing Engine
Once a target video is saved, the pipeline immediately springs into action:
1. **Audio Rip:** `yt-dlp` securely rips the 128kbps audio stream locally.
2. **Whisper Transcription:** Groq’s Whisper (large-v3) transcribes the entire video with highly accurate, word-level timestamps.
3. **Odia-to-English Translation:** A translation pipeline detects Odia text and seamlessly parses it into English context for homogeneous database storage.
4. **Context Evaluation & Auto-Purging:** The AI checks the actual spoken transcript. Even if the video title matched a keyword, if the *actual transcript* finds 0 mentions of the keywords, **ROBIN immediately hard-deletes the video** from the Supabase database. This guarantees a noise-free interface.
5. **Native Clip Splicing:** For verified keyword hits, `ffmpeg` automatically splices the raw video stream, generating native **28-second .mp4 clips** (14s prior to the keyword utterance, 14s after).
6. **Cloud Storage:** Those clips are fired into Supabase Storage Buckets.
7. **AI Clip Summaries:** The Llama-3 model watches the 28s transcript of the clip and provides exactly *why* the individual clip matters to the mission.

---

## 4. The Command Center (Frontend Visualization)

When an authorized user logs into the Next.js frontend, they don't see massive spreadsheets of scraped articles. They see a **Strategic Command Interface**:

- **Risk Pulse (Recharts):** A dynamic 24/7 heartbeat chart showing the Volume vs. Average Threat Importance of the entire state's news flow.
- **Geographic Node Mapping:** Heatmaps plot where intelligence is clustering (e.g., if 60% of hostile news is coming from Sambalpur today).
- **Entity Watchlist:** A live leaderboard. Rather than stating "The Chief Minister was mentioned 40 times", it calculates the delta: *"Chief Minister sentiment has shifted 80% negative in the last 6 hours due to 12 linked corruption articles."*

In the **Activity Feed -> TV News Panel**, users get their final actionable product:
- They scroll through the curated videos. 
- They don't have to watch a 40-minute news broadcast to find what matters. They simply hit "Play" on a 28-second inline video player that jumps exactly to the moment someone on the news spoke a missioned keyword.
