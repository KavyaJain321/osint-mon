// ============================================================
// RIGIOR Feed — Full Setup Script
// Naval War College India — Maritime Intelligence Feed
//
// What this script does (in order):
//   1. Remove irrelevant sources from RIGIOR (Odisha, Africa, unrelated)
//   2. Deactivate any existing active brief for RIGIOR
//   3. Insert new brief with status: active
//   4. Insert all 107 keywords with categories + priorities
//   5. Verify + insert ~60 new sources (HEAD check, logs failures)
//   6. Ensure Google News Auto source exists
//   7. Insert 15 YouTube channel sources
//
// Usage: node database/seed-rigior.js
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

const RIGIOR_CLIENT_ID = 'c9493d5b-45bc-4c33-998b-e4d5cdde8f59';

// ── 1. Sources to REMOVE ─────────────────────────────────────
// These are irrelevant to the naval intelligence mandate:
// - Odisha regional content (explicitly excluded in brief)
// - African sources with no IOR/chokepoint relevance
// - Broken RSS feeds with 0 articles scraped
// - Canadian/European news with no naval relevance
const SOURCES_TO_REMOVE = [
    'https://graphic.com.gh',
    'https://feeds.reuters.com/reuters/INtopNews',   // broken RSS, replace with targeted Reuters
    'https://malaysiakini.com',
    'https://ft.com',                                 // paywall, 0 articles
    'https://odishabhaskar.in/',
    'https://www.orissapost.com/feed/',
    'https://www.youtube.com/@otv',                  // Odisha TV
    'https://standardmedia.co.ke',
    'https://dailymaverick.co.za',
    'https://freemalaysiatoday.com',
    'https://thewire.in',
    'https://timeslive.co.za',
    'https://pragativadi.com/feed/',
    'https://ici.radio-canada.ca',
    'https://ledevoir.com',
    'https://www.dharitri.com/',
    'https://citinewsroom.com',
    'https://cbc.ca/news',
    'https://thesamaja.in/',
    'https://sambad.in/feed/',
    'https://thefourthestategh.com',
    'https://thestar.com',
    'https://theglobeandmail.com',
    'https://thestar.com.my',
    'https://www.prameyanews7.com/feed/',
    'https://theedgemalaysia.com',
    'https://mg.co.za',
    'https://scmp.com',                               // replace with proper SCMP RSS below
    'https://myjoyonline.com',
    'https://www.indiatoday.in/rss',                  // duplicate of HTML source
    'https://www.deccanherald.com/rss',
    'https://www.newindianexpress.com/rss',
    'https://www.thequint.com/rss',
    'https://news.google.com/rss/search?q=cybersecurity&hl=en', // wrong domain
    'https://www.reddit.com/r/india/',                // wrong subreddit for this feed
];

// ── 2. New sources to ADD ─────────────────────────────────────
// Organised by tier and type. source_type values:
//   rss | html | browser | youtube | google_news
//
// Tier 1 = Government / Premium verified
// Tier 2 = Think tanks / Analytical / Specialist
// Tier 3 = Unverified / Handle with caution

const NEW_SOURCES = [

    // ── Tier 1: Government / MOD Press Releases ──────────────
    {
        name: 'US INDOPACOM News',
        url: 'https://www.pacom.mil/Media/News/',
        source_type: 'html', tier: 1,
    },
    {
        name: 'US Department of Defense News',
        url: 'https://www.defense.gov/News/',
        source_type: 'html', tier: 1,
    },
    {
        name: 'US Navy News',
        url: 'https://www.navy.mil/Press-Office/News-Stories/',
        source_type: 'html', tier: 1,
    },
    {
        name: 'UK Ministry of Defence',
        url: 'https://www.gov.uk/government/organisations/ministry-of-defence',
        source_type: 'html', tier: 1,
    },
    {
        name: 'India Ministry of Defence (PIB)',
        url: 'https://mod.gov.in/pressrelease',
        source_type: 'html', tier: 1,
    },
    {
        name: 'ISPR Pakistan (Adversary)',
        url: 'https://www.ispr.gov.pk/',
        source_type: 'html', tier: 1,
    },
    {
        name: 'VesselFinder News',
        url: 'https://www.vesselfinder.com/news',
        source_type: 'html', tier: 1,
    },

    // ── Tier 1: Defence Media ─────────────────────────────────
    {
        name: 'USNI News',
        url: 'https://news.usni.org/feed',
        source_type: 'rss', tier: 1,
    },
    {
        name: 'Breaking Defense',
        url: 'https://breakingdefense.com/feed/',
        source_type: 'rss', tier: 1,
    },
    {
        name: 'Defense News',
        url: 'https://www.defensenews.com/rss/',
        source_type: 'rss', tier: 1,
    },
    {
        name: 'The War Zone',
        url: 'https://www.thedrive.com/the-war-zone',
        source_type: 'html', tier: 1,
    },
    {
        name: "Jane's Defence News",
        url: 'https://www.janes.com/defence-news',
        source_type: 'html', tier: 1,
    },

    // ── Tier 2: Global Think Tanks ────────────────────────────
    {
        name: 'IISS Analysis',
        url: 'https://www.iiss.org/online-analysis/',
        source_type: 'html', tier: 2,
    },
    {
        name: 'RUSI Commentary',
        url: 'https://rusi.org/explore-our-research/publications/commentary',
        source_type: 'html', tier: 2,
    },
    {
        name: 'CSIS Analysis',
        url: 'https://www.csis.org/analysis',
        source_type: 'html', tier: 2,
    },
    {
        name: 'RAND Research',
        url: 'https://www.rand.org/research.html',
        source_type: 'html', tier: 2,
    },
    {
        name: 'CNAS Research',
        url: 'https://www.cnas.org/research',
        source_type: 'html', tier: 2,
    },
    {
        name: 'Carnegie Endowment',
        url: 'https://carnegieendowment.org/publications/',
        source_type: 'html', tier: 2,
    },
    {
        name: 'Brookings Defense & Security',
        url: 'https://www.brookings.edu/topic/defense-security/',
        source_type: 'html', tier: 2,
    },
    {
        name: 'Stimson Center',
        url: 'https://www.stimson.org/',
        source_type: 'html', tier: 2,
    },
    {
        name: 'Council on Foreign Relations',
        url: 'https://www.cfr.org/topic/defense-security',
        source_type: 'html', tier: 2,
    },

    // ── Tier 2: India Think Tanks ─────────────────────────────
    {
        name: 'ORF (Observer Research Foundation)',
        url: 'https://www.orfonline.org/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'IDSA (Institute for Defence Studies)',
        url: 'https://www.idsa.in/rss',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Gateway House',
        url: 'https://www.gatewayhouse.in/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'USI India',
        url: 'https://usiofindia.org/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'ASPI — Australian Strategic Policy Institute',
        url: 'https://www.aspistrategist.org.au/feed/',
        source_type: 'rss', tier: 2,
    },

    // ── Tier 2: Naval / Maritime Analytical ──────────────────
    {
        name: 'Naval News',
        url: 'https://www.navalnews.com/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'AMTI — Asia Maritime Transparency Initiative',
        url: 'https://amti.csis.org/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Naval Technology',
        url: 'https://www.naval-technology.com/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Oryx Blog (Equipment OSINT)',
        url: 'https://www.oryxspioenkop.com/feeds/posts/default',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Covert Shores — H I Sutton (Submarine OSINT)',
        url: 'http://www.hisutton.com/feed.xml',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'DFRLab — Atlantic Council',
        url: 'https://www.atlanticcouncil.org/programs/digital-forensic-research-lab/',
        source_type: 'html', tier: 2,
    },
    {
        name: 'South China Morning Post (Asia/Defence)',
        url: 'https://www.scmp.com/rss/4/feed',
        source_type: 'rss', tier: 2,
    },

    // ── Tier 1: Adversary State Media (signal tracking) ──────
    {
        name: 'Global Times (PRC State Media)',
        url: 'https://www.globaltimes.cn/rss/outbrain.xml',
        source_type: 'rss', tier: 1,
    },
    {
        name: 'CGTN World (PRC State Media)',
        url: 'https://www.cgtn.com/subscribe/rss/section/world.xml',
        source_type: 'rss', tier: 1,
    },
    {
        name: 'PLA Daily — China Military Online',
        url: 'http://eng.chinamil.com.cn/',
        source_type: 'html', tier: 1,
    },

    // ── IOR Littoral Nations ──────────────────────────────────
    {
        name: 'Colombo Gazette (Sri Lanka)',
        url: 'https://colombogazette.com/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Ada Derana (Sri Lanka)',
        url: 'https://www.adaderana.lk/rss.php',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Maldives Independent',
        url: 'https://maldivesindependent.com/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'The Daily Star Bangladesh',
        url: 'https://www.thedailystar.net/rss.xml',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'The Irrawaddy (Myanmar)',
        url: 'https://www.irrawaddy.com/feed',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Myanmar Now',
        url: 'https://myanmar-now.org/en/feed/',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'Times of Oman',
        url: 'https://timesofoman.com/rss',
        source_type: 'rss', tier: 2,
    },
    {
        name: 'The EastAfrican (Djibouti / Horn of Africa)',
        url: 'https://www.theeastafrican.co.ke/feed/',
        source_type: 'rss', tier: 2,
    },

    // ── Tier 3: Reddit Communities ────────────────────────────
    {
        name: 'r/geopolitics',
        url: 'https://www.reddit.com/r/geopolitics/',
        source_type: 'html', tier: 3,
    },
    {
        name: 'r/CredibleDefense',
        url: 'https://www.reddit.com/r/CredibleDefense/',
        source_type: 'html', tier: 3,
    },
    {
        name: 'r/indiandefence',
        url: 'https://www.reddit.com/r/indiandefence/',
        source_type: 'html', tier: 3,
    },
];

// ── 3. YouTube channels ───────────────────────────────────────
// Channel URLs using @handle format — resolved to channel IDs at crawl time.
// Mix of news (daily posts) and analytical (weekly posts).
// RIGIOR per-client overrides handle the deeper lookback for infrequent channels.
const YOUTUBE_SOURCES = [
    // Tier 1 — Defence media
    { name: 'USNI News (YouTube)',          url: 'https://www.youtube.com/@NavalInstituteNews', tier: 1 },
    { name: 'Breaking Defense (YouTube)',   url: 'https://www.youtube.com/@BreakingDefense',    tier: 1 },
    { name: 'The War Zone (YouTube)',       url: 'https://www.youtube.com/@TheWarZone',         tier: 1 },
    { name: 'Naval News (YouTube)',         url: 'https://www.youtube.com/@NavalNewsChannel',   tier: 1 },
    // Tier 1 — Indian national news (fast-moving India-China-Pakistan coverage)
    { name: 'Indian Navy Official',         url: 'https://www.youtube.com/@IndianNavy',         tier: 1 },
    { name: 'WION (YouTube)',               url: 'https://www.youtube.com/@WIONNews',            tier: 1 },
    { name: 'Times Now (YouTube)',          url: 'https://www.youtube.com/@TimesNow',            tier: 1 },
    { name: 'ANI News (YouTube)',           url: 'https://www.youtube.com/@ANINewsAgency',       tier: 1 },
    { name: 'DD News (YouTube)',            url: 'https://www.youtube.com/@DDNewsIndia',         tier: 1 },
    // Tier 1 — International
    { name: 'Al Jazeera English (YouTube)', url: 'https://www.youtube.com/@AlJazeeraEnglish',   tier: 1 },
    { name: 'South China Morning Post (YouTube)', url: 'https://www.youtube.com/@SCMPNews',     tier: 1 },
    // Tier 1 — Adversary state media (narrative tracking)
    { name: 'CGTN (YouTube)',               url: 'https://www.youtube.com/@CGTNOfficial',        tier: 1 },
    // Tier 2 — Think tanks
    { name: 'CSIS (YouTube)',               url: 'https://www.youtube.com/@CSIS_DC',             tier: 2 },
    { name: 'ORF (YouTube)',                url: 'https://www.youtube.com/@ORFonlineIndia',      tier: 2 },
    { name: 'IDSA India (YouTube)',         url: 'https://www.youtube.com/@IDSAIndia',           tier: 2 },
];

// ── 4. Keywords ───────────────────────────────────────────────
// 107 keywords from the RIGIOR brief, organised by category with priority scores.
// Priority 1–10: 10 = must-surface, 7 = standard tracking, below 7 = background.
const KEYWORDS = [
    // PLA Navy / China (Priority 9–10)
    { keyword: 'PLA Navy',                      category: 'china',          priority: 10 },
    { keyword: 'PLAN deployment',               category: 'china',          priority: 10 },
    { keyword: 'Chinese submarine IOR',         category: 'china',          priority: 10 },
    { keyword: 'PLAN carrier',                  category: 'china',          priority: 9  },
    { keyword: 'Type 055 destroyer',            category: 'china',          priority: 9  },
    { keyword: 'Type 054A frigate',             category: 'china',          priority: 9  },
    { keyword: 'Type 093 submarine',            category: 'china',          priority: 10 },
    { keyword: 'Type 094 SSBN',                 category: 'china',          priority: 10 },
    { keyword: 'Chinese naval base',            category: 'china',          priority: 9  },
    { keyword: 'PLAN Indian Ocean',             category: 'china',          priority: 10 },
    { keyword: 'China naval exercise',          category: 'china',          priority: 9  },
    { keyword: 'Maritime Silk Road',            category: 'china',          priority: 8  },
    { keyword: 'dual-use port China',           category: 'china',          priority: 8  },
    { keyword: 'PLAN logistics ship',           category: 'china',          priority: 9  },
    { keyword: 'Chinese survey vessel IOR',     category: 'china',          priority: 9  },
    { keyword: 'Yuanwang tracking ship',        category: 'china',          priority: 9  },
    { keyword: 'Military-Civil Fusion maritime',category: 'china',          priority: 8  },

    // Pakistan Navy (Priority 8–9)
    { keyword: 'Pakistan Navy',                 category: 'pakistan',       priority: 9  },
    { keyword: 'PN exercise',                   category: 'pakistan',       priority: 8  },
    { keyword: 'Type 054AP frigate',            category: 'pakistan',       priority: 9  },
    { keyword: 'Hangor submarine',              category: 'pakistan',       priority: 9  },
    { keyword: 'Agosta submarine',              category: 'pakistan',       priority: 9  },
    { keyword: 'PNS deployment',                category: 'pakistan',       priority: 8  },
    { keyword: 'Gwadar militarization',         category: 'pakistan',       priority: 9  },
    { keyword: 'CPEC naval',                    category: 'pakistan',       priority: 8  },
    { keyword: 'China Pakistan naval drill',    category: 'pakistan',       priority: 9  },
    { keyword: 'Sea Guardians exercise',        category: 'pakistan',       priority: 9  },
    { keyword: 'Pakistan Arabian Sea',          category: 'pakistan',       priority: 8  },
    { keyword: 'Pakistan Navy expansion',       category: 'pakistan',       priority: 8  },
    { keyword: 'PN anti-ship missile',          category: 'pakistan',       priority: 8  },

    // Indian Ocean Region (Priority 8–9)
    { keyword: 'Indian Ocean Region',           category: 'ior',            priority: 9  },
    { keyword: 'IOR security',                  category: 'ior',            priority: 9  },
    { keyword: 'IOR naval presence',            category: 'ior',            priority: 9  },
    { keyword: 'Indo-Pacific maritime',         category: 'ior',            priority: 8  },
    { keyword: 'Strait of Hormuz naval',        category: 'ior',            priority: 9  },
    { keyword: 'Bab-el-Mandeb security',        category: 'ior',            priority: 9  },
    { keyword: 'Strait of Malacca military',    category: 'ior',            priority: 9  },
    { keyword: 'Lombok Strait',                 category: 'ior',            priority: 8  },
    { keyword: 'Nine Degree Channel',           category: 'ior',            priority: 9  },
    { keyword: 'chokepoint security',           category: 'ior',            priority: 9  },
    { keyword: 'SLOC disruption',               category: 'ior',            priority: 8  },
    { keyword: 'undersea cable threat',         category: 'ior',            priority: 8  },
    { keyword: 'maritime domain awareness',     category: 'ior',            priority: 8  },
    { keyword: 'IOR balance of power',          category: 'ior',            priority: 8  },
    { keyword: 'foreign naval base IOR',        category: 'ior',            priority: 9  },

    // Strategic Infrastructure (Priority 8–9)
    { keyword: 'Gwadar port military',          category: 'infrastructure', priority: 9  },
    { keyword: 'Hambantota port China',         category: 'infrastructure', priority: 9  },
    { keyword: 'Djibouti PLAN base',            category: 'infrastructure', priority: 9  },
    { keyword: 'Ream Naval Base Cambodia',      category: 'infrastructure', priority: 8  },
    { keyword: 'Kyaukphyu port Myanmar',        category: 'infrastructure', priority: 8  },
    { keyword: 'Duqm port Oman',               category: 'infrastructure', priority: 8  },
    { keyword: 'Belt and Road maritime',        category: 'infrastructure', priority: 8  },
    { keyword: 'String of Pearls strategy',     category: 'infrastructure', priority: 8  },
    { keyword: 'Chinese port acquisition',      category: 'infrastructure', priority: 8  },
    { keyword: 'dual-use infrastructure',       category: 'infrastructure', priority: 8  },

    // Maritime Threats & Anomalies (Priority 8–10) — highest priority signal category
    { keyword: 'AIS spoofing',                  category: 'threats',        priority: 9  },
    { keyword: 'dark ship detection',           category: 'threats',        priority: 9  },
    { keyword: 'vessel tracking anomaly',       category: 'threats',        priority: 9  },
    { keyword: 'submarine sighting',            category: 'threats',        priority: 10 },
    { keyword: 'maritime surveillance',         category: 'threats',        priority: 8  },
    { keyword: 'illegal maritime activity',     category: 'threats',        priority: 7  },
    { keyword: 'piracy Indian Ocean',           category: 'threats',        priority: 7  },
    { keyword: 'maritime sabotage',             category: 'threats',        priority: 9  },
    { keyword: 'undersea infrastructure attack',category: 'threats',        priority: 9  },
    { keyword: 'drone boat naval',              category: 'threats',        priority: 8  },
    { keyword: 'UUV deployment',                category: 'threats',        priority: 9  },

    // Naval Weapons & Technology (Priority 8–9)
    { keyword: 'anti-ship missile test',        category: 'weapons',        priority: 9  },
    { keyword: 'DF-21D deployment',             category: 'weapons',        priority: 9  },
    { keyword: 'DF-26 anti-ship',               category: 'weapons',        priority: 9  },
    { keyword: 'YJ-18 missile',                 category: 'weapons',        priority: 9  },
    { keyword: 'hypersonic naval missile',      category: 'weapons',        priority: 8  },
    { keyword: 'naval drone strike',            category: 'weapons',        priority: 8  },
    { keyword: 'torpedo test',                  category: 'weapons',        priority: 8  },
    { keyword: 'naval mine deployment',         category: 'weapons',        priority: 8  },
    { keyword: 'submarine-launched missile',    category: 'weapons',        priority: 9  },
    { keyword: 'carrier killer missile',        category: 'weapons',        priority: 9  },
    { keyword: 'stealth frigate',               category: 'weapons',        priority: 8  },

    // Exercises & Operations (Priority 7–9)
    { keyword: 'FONOP South China Sea',                 category: 'exercises',   priority: 9 },
    { keyword: 'freedom of navigation operation',       category: 'exercises',   priority: 8 },
    { keyword: 'Malabar exercise',                      category: 'exercises',   priority: 8 },
    { keyword: 'QUAD naval exercise',                   category: 'exercises',   priority: 8 },
    { keyword: 'Milan naval exercise',                  category: 'exercises',   priority: 8 },
    { keyword: 'bilateral naval exercise Indo-Pacific', category: 'exercises',   priority: 8 },
    { keyword: 'carrier strike group deployment',       category: 'exercises',   priority: 9 },
    { keyword: 'amphibious assault exercise',           category: 'exercises',   priority: 8 },
    { keyword: 'anti-submarine warfare exercise',       category: 'exercises',   priority: 9 },
    { keyword: 'naval blockade drill',                  category: 'exercises',   priority: 8 },

    // Information Warfare (Priority 7–8)
    { keyword: 'PLA information warfare',           category: 'infowar',     priority: 8 },
    { keyword: 'naval disinformation',              category: 'infowar',     priority: 7 },
    { keyword: 'CGTN maritime narrative',           category: 'infowar',     priority: 7 },
    { keyword: 'Global Times navy',                 category: 'infowar',     priority: 7 },
    { keyword: 'ISPR naval statement',              category: 'infowar',     priority: 8 },
    { keyword: 'Pakistan navy propaganda',          category: 'infowar',     priority: 7 },
    { keyword: 'maritime incident false flag',      category: 'infowar',     priority: 8 },
    { keyword: 'naval deepfake',                    category: 'infowar',     priority: 7 },
    { keyword: 'psychological deterrence maritime', category: 'infowar',     priority: 7 },
    { keyword: 'grey zone maritime operation',      category: 'infowar',     priority: 8 },

    // Geopolitical Signals (Priority 7–9)
    { keyword: 'India China maritime tension',          category: 'geopolitical', priority: 9 },
    { keyword: 'India Pakistan naval standoff',         category: 'geopolitical', priority: 9 },
    { keyword: 'IOR escalation',                        category: 'geopolitical', priority: 9 },
    { keyword: 'maritime boundary dispute',             category: 'geopolitical', priority: 8 },
    { keyword: 'EEZ violation',                         category: 'geopolitical', priority: 9 },
    { keyword: 'island militarization IOR',             category: 'geopolitical', priority: 8 },
    { keyword: 'Sri Lanka China base',                  category: 'geopolitical', priority: 8 },
    { keyword: 'Maldives Chinese presence',             category: 'geopolitical', priority: 8 },
    { keyword: 'Bangladesh naval cooperation China',    category: 'geopolitical', priority: 8 },
    { keyword: 'Myanmar Kyaukphyu PLAN',                category: 'geopolitical', priority: 8 },
];

// ── Brief problem_statement ───────────────────────────────────
const BRIEF_TITLE = 'RIGIOR — Naval War College India Intelligence Feed';
const BRIEF_PROBLEM_STATEMENT = `RIGIOR is a continuously deployed open-source naval intelligence feed for the Naval War College India. This system functions as a permanent intelligence analyst — not a news aggregator. Its mandate is to detect patterns, surface anomalies, and flag early-warning signals before they reach mainstream coverage.

PRIMARY THEATRES: China (PLA Navy operations and strategic maritime expansion in the IOR), Pakistan (naval capability development and China-Pakistan maritime coordination), and the Indian Ocean Region (IOR) as the primary operational battlespace.

INTELLIGENCE COLLECTION PRIORITIES:

1. NAVAL & MARITIME ACTIVITY
Highest-priority signal: submarine operations. Track Chinese SSN/SSBN patrol patterns in the IOR, suspected deployments near chokepoints, Pakistan Navy Agosta and Hangor-class submarine activity, and any unconfirmed sighting reports. Fleet movements: PLA Navy surface combatants beyond the South China Sea, carrier strike group positioning, Pakistan Navy movements in the Arabian Sea, and foreign naval vessels near India's EEZ. AIS anomalies: transponder shutoffs, spoofing, identity mismatches — especially for Chinese research/survey vessels and PLA auxiliaries.

2. CHOKEPOINTS
Dedicated monitoring of: Strait of Hormuz, Bab-el-Mandeb, Strait of Malacca, Lombok Strait, Nine Degree Channel. Any disruption, unusual loitering, or military presence triggers immediate alert regardless of source tier.

3. MILITARY CAPABILITY & INFRASTRUCTURE
Weapons: anti-ship missile tests (DF-21D, DF-26, YJ-series, Babur), hypersonic glide vehicles, naval UUV programs. Basing: construction or activity deviating from baseline at Gwadar, Djibouti, Hambantota, Ream Naval Base, Kyaukphyu, Duqm. Exercises: unannounced drills, Sea Guardians series, PLAN IOR exercises, Indian Navy Quad/Malabar/Milan exercises.

4. GEOPOLITICAL & ESCALATION INDICATORS
FONOPs, EEZ violations, sanctions affecting shipping. Chinese diplomatic moves in Sri Lanka, Maldives, Bangladesh, Myanmar, East Africa with direct IOR basing or access implications. India-China and India-Pakistan maritime standoff signals.

5. INFORMATION WARFARE & NARRATIVE SHAPING
State media signaling from PLA Daily, Global Times, CGTN, ISPR — coordinated messaging before/after maritime events is a leading indicator. Psychological deterrence messaging: submarine capability disclosures, anti-ship missile demonstrations near disputed zones. Disinformation campaigns around maritime incidents.

NOISE EXCLUSIONS: Domestic Indian regional content unrelated to naval/maritime affairs, African content without IOR or chokepoint relevance, pure editorial without evidentiary basis, recycled items with no new intelligence angle, Odisha-specific content entirely.

TEMPORAL PRIORITY: Last 24h → immediate surfacing. Last 7 days → contextual relevance. 7-30 days → only if completing a pattern or a capability disclosure. Older → background reference only, never surfaced as fresh.

ANALYTICAL MANDATE: Connect patterns across time — e.g., a Chinese survey vessel IOR entry followed by PLAN submarine deployment 10 days later. Flag deception: when official statements contradict OSINT evidence (AIS, satellite imagery, eyewitness), mark the inconsistency explicitly. Project near-term scenarios (7-30 days) where evidence supports it.

OUTPUT STRUCTURE — Every item must include: Headline (intelligence-style, no journalistic language) | What Happened (factual, no adjectives, no speculation) | Location (precise coordinates or maritime region) | Actors | Strategic Assessment (routine or pattern deviation, implications for India/IOR) | Early Warning Indicator (Yes/No + one line) | Confidence Level (High/Medium/Low + justification) | Source Tier (1/2/3) | Tags.`;

// ── Helpers ───────────────────────────────────────────────────
function log(msg) { console.log(`[seed-rigior] ${msg}`); }
function warn(msg) { console.warn(`[seed-rigior] ⚠ ${msg}`); }
function ok(msg)  { console.log(`[seed-rigior] ✓ ${msg}`); }

async function checkUrl(url) {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 7000);
        const res = await fetch(url, {
            method: 'HEAD',
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ROBIN-OSINT/1.0)' },
            redirect: 'follow',
        });
        clearTimeout(timer);
        return res.ok || res.status === 405; // 405 = HEAD not allowed but site is up
    } catch {
        return false;
    }
}

// ── Main ──────────────────────────────────────────────────────
async function run() {
    log('Starting RIGIOR feed setup...');
    log(`Client ID: ${RIGIOR_CLIENT_ID}`);

    // ─── Step 1: Remove irrelevant sources ───────────────────
    log('\n── Step 1: Removing irrelevant sources ──');
    let removedCount = 0;
    for (const url of SOURCES_TO_REMOVE) {
        const { data, error } = await supabase
            .from('sources')
            .delete()
            .eq('client_id', RIGIOR_CLIENT_ID)
            .eq('url', url)
            .select('name');

        if (error) {
            warn(`Failed to remove ${url}: ${error.message}`);
        } else if (data && data.length > 0) {
            ok(`Removed: ${data[0].name}`);
            removedCount++;
        }
        // If data is empty, source wasn't there — that's fine
    }
    log(`Removed ${removedCount} sources`);

    // ─── Step 2: Deactivate existing active brief ────────────
    log('\n── Step 2: Deactivating existing active brief ──');
    const { data: oldBriefs } = await supabase
        .from('client_briefs')
        .select('id, title')
        .eq('client_id', RIGIOR_CLIENT_ID)
        .eq('status', 'active');

    if (oldBriefs && oldBriefs.length > 0) {
        for (const b of oldBriefs) {
            await supabase
                .from('client_briefs')
                .update({ status: 'replaced' })
                .eq('id', b.id);
            // Delete old keywords
            await supabase
                .from('brief_generated_keywords')
                .delete()
                .eq('brief_id', b.id);
            ok(`Replaced old brief: "${b.title}" (${b.id})`);
        }
    } else {
        log('No existing active brief found');
    }

    // ─── Step 3: Insert new brief ────────────────────────────
    log('\n── Step 3: Inserting new brief ──');
    const { data: brief, error: briefErr } = await supabase
        .from('client_briefs')
        .insert({
            client_id:           RIGIOR_CLIENT_ID,
            title:               BRIEF_TITLE,
            problem_statement:   BRIEF_PROBLEM_STATEMENT,
            status:              'active',
            activated_at:        new Date().toISOString(),
            industry:            'Maritime Intelligence & Strategy',
            risk_domains:        ['Naval Operations', 'Maritime Security', 'Information Warfare', 'Geopolitical Escalation', 'Submarine Operations'],
            entities_of_interest:['PLA Navy', 'Pakistan Navy', 'PLAN', 'Indian Navy', 'US INDOPACOM', 'ISPR'],
            competitors:         [],
            geographic_focus:    ['Indian Ocean Region', 'South China Sea', 'Arabian Sea', 'Strait of Hormuz', 'Indo-Pacific', 'Bab-el-Mandeb', 'Strait of Malacca'],
        })
        .select()
        .single();

    if (briefErr) {
        console.error('[seed-rigior] FATAL: Brief insert failed:', briefErr.message);
        process.exit(1);
    }
    ok(`Brief created: ${brief.id}`);

    // ─── Step 4: Insert keywords ─────────────────────────────
    log('\n── Step 4: Inserting 107 keywords ──');
    const kwRows = KEYWORDS.map(k => ({
        brief_id: brief.id,
        keyword:  k.keyword,
        category: k.category,
        priority: k.priority,
        rationale: `${k.category.toUpperCase()} signal — Naval War College India intelligence brief`,
        approved: true,
    }));

    const { error: kwErr } = await supabase
        .from('brief_generated_keywords')
        .insert(kwRows);

    if (kwErr) {
        warn(`Keyword insert error: ${kwErr.message}`);
    } else {
        ok(`${kwRows.length} keywords inserted`);
    }

    // ─── Step 5: Verify + insert text/RSS/HTML sources ───────
    log('\n── Step 5: Verifying and inserting sources ──');

    // Fetch existing source URLs for dedup
    const { data: existingSources } = await supabase
        .from('sources')
        .select('url')
        .eq('client_id', RIGIOR_CLIENT_ID);
    const existingUrls = new Set((existingSources || []).map(s => s.url.toLowerCase().replace(/\/+$/, '')));

    let srcInserted = 0;
    let srcSkipped  = 0;
    let srcFailed   = 0;

    for (const src of NEW_SOURCES) {
        const normUrl = src.url.toLowerCase().replace(/\/+$/, '');
        if (existingUrls.has(normUrl)) {
            log(`  SKIP (exists): ${src.name}`);
            srcSkipped++;
            continue;
        }

        // HEAD check — log result but insert regardless
        // (some sites block HEAD but are valid scraping targets)
        const reachable = await checkUrl(src.url);
        if (!reachable) {
            warn(`  HEAD failed (inserting anyway): ${src.name} — ${src.url}`);
        }

        const { error } = await supabase
            .from('sources')
            .insert({
                client_id:   RIGIOR_CLIENT_ID,
                name:        src.name,
                url:         src.url,
                source_type: src.source_type,
                is_active:   true,
                tier:        src.tier ?? 2,
            });

        if (error) {
            warn(`  INSERT FAILED: ${src.name} — ${error.message}`);
            srcFailed++;
        } else {
            ok(`  Added [${src.source_type.toUpperCase()}] ${src.name}`);
            srcInserted++;
            existingUrls.add(normUrl); // prevent re-insert in same run
        }
    }

    log(`Sources: ${srcInserted} inserted, ${srcSkipped} already existed, ${srcFailed} failed`);

    // ─── Step 6: Insert YouTube sources ──────────────────────
    log('\n── Step 6: Inserting YouTube channel sources ──');
    let ytInserted = 0;

    for (const src of YOUTUBE_SOURCES) {
        const normUrl = src.url.toLowerCase().replace(/\/+$/, '');
        if (existingUrls.has(normUrl)) {
            log(`  SKIP (exists): ${src.name}`);
            continue;
        }

        const { error } = await supabase
            .from('sources')
            .insert({
                client_id:   RIGIOR_CLIENT_ID,
                name:        src.name,
                url:         src.url,
                source_type: 'youtube',
                is_active:   true,
                tier:        src.tier ?? 1,
            });

        if (error) {
            warn(`  INSERT FAILED: ${src.name} — ${error.message}`);
        } else {
            ok(`  Added [YOUTUBE] ${src.name}`);
            ytInserted++;
            existingUrls.add(normUrl);
        }
    }
    log(`YouTube: ${ytInserted} channels inserted`);

    // ─── Step 7: Ensure Google News Auto source exists ───────
    log('\n── Step 7: Ensuring Google News Auto source ──');
    const gnewsUrl = 'auto';
    if (!existingUrls.has(gnewsUrl)) {
        const { error } = await supabase
            .from('sources')
            .insert({
                client_id:   RIGIOR_CLIENT_ID,
                name:        'Google News (Auto)',
                url:         'auto',
                source_type: 'google_news',
                is_active:   true,
                tier:        2,
            });
        if (error) {
            warn(`Google News Auto insert failed: ${error.message}`);
        } else {
            ok('Google News Auto source created');
        }
    } else {
        ok('Google News Auto source already exists');
    }

    // ─── Final summary ────────────────────────────────────────
    log('\n════════════════════════════════════════');
    log('RIGIOR feed setup complete.');
    log(`Brief ID: ${brief.id}`);
    log(`Keywords: ${kwRows.length}`);
    log(`Sources added this run: ${srcInserted + ytInserted}`);
    log('Next scraper cycle will pick up all sources and keywords automatically.');
    log('════════════════════════════════════════');
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('[seed-rigior] FATAL:', err.message);
        process.exit(1);
    });
