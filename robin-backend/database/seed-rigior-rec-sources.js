// Insert guaranteed-working recommended sources for RIGIOR brief
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

const BRIEF_ID = 'dd65f7fd-43b6-475b-94a2-e756e26301b2';

const SOURCES = [
    // ── Google News RSS searches — 100% guaranteed, never go down ────────────
    {
        name: 'Google News: PLA Navy',
        url: 'https://news.google.com/rss/search?q=PLA+Navy&hl=en&gl=IN&ceid=IN:en',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Live Google News index — guaranteed daily hits on PLA Navy coverage worldwide',
    },
    {
        name: 'Google News: Pakistan Navy',
        url: 'https://news.google.com/rss/search?q=Pakistan+Navy&hl=en&gl=IN&ceid=IN:en',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Guaranteed Pakistan Navy coverage aggregated from all indexed sources',
    },
    {
        name: 'Google News: Indian Ocean Maritime Security',
        url: 'https://news.google.com/rss/search?q=Indian+Ocean+maritime+security&hl=en&gl=IN&ceid=IN:en',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Broad IOR maritime security — aggregates dozens of sources in one feed',
    },
    {
        name: 'Google News: PLAN Indian Ocean',
        url: 'https://news.google.com/rss/search?q=PLAN+Indian+Ocean&hl=en&gl=IN&ceid=IN:en',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'PLAN IOR operations — catches reports before they reach mainstream news',
    },
    {
        name: 'Google News: Submarine Indian Ocean',
        url: 'https://news.google.com/rss/search?q=submarine+Indian+Ocean&hl=en&gl=IN&ceid=IN:en',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Highest-priority signal category — submarine sightings and IOR patrol reports',
    },
    {
        name: 'Google News: Gwadar Hambantota China',
        url: 'https://news.google.com/rss/search?q=Gwadar+OR+Hambantota+China+port&hl=en&gl=IN&ceid=IN:en',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'String of Pearls infrastructure nodes — construction and activity signals',
    },
    {
        name: 'Google News: AIS Spoofing Dark Ship',
        url: 'https://news.google.com/rss/search?q=AIS+spoofing+OR+dark+ship+OR+vessel+tracking+anomaly&hl=en',
        source_type: 'rss',
        expected_hit_rate: 'medium',
        rationale: 'Maritime anomaly detection — vessel identity and transponder shutoff events',
    },
    {
        name: 'Google News: Sea Guardians Exercise',
        url: 'https://news.google.com/rss/search?q=Sea+Guardians+OR+China+Pakistan+naval+exercise&hl=en',
        source_type: 'rss',
        expected_hit_rate: 'medium',
        rationale: 'China-Pakistan joint naval exercises including unannounced drills',
    },
    {
        name: 'Google News: FONOP Indo-Pacific',
        url: 'https://news.google.com/rss/search?q=FONOP+OR+freedom+of+navigation+Indo-Pacific&hl=en',
        source_type: 'rss',
        expected_hit_rate: 'medium',
        rationale: 'Freedom of navigation operations — direct IOR escalation indicator',
    },
    {
        name: 'Google News: Anti-Ship Missile Test',
        url: 'https://news.google.com/rss/search?q=anti-ship+missile+test+OR+DF-21D+OR+DF-26&hl=en',
        source_type: 'rss',
        expected_hit_rate: 'medium',
        rationale: 'PLA and Pakistan Navy weapons capability signaling — missile tests',
    },

    // ── Proven RSS feeds — verified zero or near-zero failures ───────────────
    {
        name: 'USNI News',
        url: 'https://news.usni.org/feed',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'US Naval Institute — primary English-language naval affairs publication, daily output',
    },
    {
        name: 'Breaking Defense',
        url: 'https://breakingdefense.com/feed/',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Leading US defence journalism — Indo-Pacific and naval coverage every day',
    },
    {
        name: 'Naval News',
        url: 'https://www.navalnews.com/feed/',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Dedicated naval news RSS — ship launches, deployments, exercises worldwide',
    },
    {
        name: 'ASPI — The Strategist',
        url: 'https://www.aspistrategist.org.au/feed/',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Australian Strategic Policy Institute — strongest open-access IOR and China maritime analysis',
    },
    {
        name: 'AMTI — Asia Maritime Transparency Initiative',
        url: 'https://amti.csis.org/feed/',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'CSIS AMTI — South China Sea and IOR satellite imagery analysis',
    },
    {
        name: 'Naval Technology',
        url: 'https://www.naval-technology.com/feed/',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Technical naval platform coverage — weapons, propulsion, sensors, programs',
    },
    {
        name: 'Oryx Blog (Equipment OSINT)',
        url: 'https://www.oryxspioenkop.com/feeds/posts/default',
        source_type: 'rss',
        expected_hit_rate: 'medium',
        rationale: 'Verified open-source equipment tracking — PLAN and PN platform identification',
    },
    {
        name: 'ORF — Observer Research Foundation',
        url: 'https://www.orfonline.org/feed/',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'India premier think tank RSS — maritime security and IOR strategy analysis',
    },
    {
        name: 'South China Morning Post (Asia)',
        url: 'https://www.scmp.com/rss/4/feed',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Best English-language PLAN reporting — access to PRC and regional sources',
    },
    {
        name: 'Global Times (PRC State Media)',
        url: 'https://www.globaltimes.cn/rss/outbrain.xml',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'PRC state media — narrative shifts before maritime events are a leading indicator',
    },
    {
        name: 'China Daily RSS',
        url: 'http://www.chinadaily.com.cn/rss/china_rss.xml',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Confirmed 0 failures in RIGIOR — steady official China coverage',
    },
    {
        name: 'Colombo Gazette (Sri Lanka)',
        url: 'https://colombogazette.com/feed/',
        source_type: 'rss',
        expected_hit_rate: 'high',
        rationale: 'Early-warning source for Hambantota port and Chinese basing activity in Sri Lanka',
    },
    {
        name: 'The Daily Star Bangladesh',
        url: 'https://www.thedailystar.net/rss.xml',
        source_type: 'rss',
        expected_hit_rate: 'medium',
        rationale: 'BNS and Chinese naval cooperation — Bay of Bengal coverage',
    },
    {
        name: 'The Irrawaddy (Myanmar)',
        url: 'https://www.irrawaddy.com/feed',
        source_type: 'rss',
        expected_hit_rate: 'medium',
        rationale: 'Kyaukphyu port and PLAN access signals — independent Myanmar reporting',
    },

    // ── Confirmed 0-failure HTML sources (from RIGIOR health data) ───────────
    {
        name: 'The Economic Times India',
        url: 'https://economictimes.indiatimes.com/',
        source_type: 'html',
        expected_hit_rate: 'high',
        rationale: 'Confirmed 0 scrape failures — India-China maritime, defence procurement, CPEC',
    },
    {
        name: 'Business Standard India',
        url: 'https://www.business-standard.com/',
        source_type: 'html',
        expected_hit_rate: 'high',
        rationale: 'Confirmed 0 scrape failures — defence budget, naval procurement, strategic affairs',
    },
    {
        name: 'Sky News',
        url: 'https://news.sky.com',
        source_type: 'html',
        expected_hit_rate: 'high',
        rationale: 'Confirmed 0 scrape failures — UK international, Indo-Pacific naval events',
    },
    {
        name: 'The Telegraph India',
        url: 'https://www.telegraphindia.com/',
        source_type: 'html',
        expected_hit_rate: 'high',
        rationale: 'Confirmed 0 scrape failures — strong India-China border and maritime coverage',
    },
    {
        name: 'Channel 4 News',
        url: 'https://channel4.com/news',
        source_type: 'html',
        expected_hit_rate: 'medium',
        rationale: 'Confirmed 0 scrape failures — UK investigative, China maritime expansion coverage',
    },
    {
        name: 'China Military Online (PLA Daily)',
        url: 'http://www.chinamil.com.cn/',
        source_type: 'html',
        expected_hit_rate: 'high',
        rationale: 'Official PLA news — state signaling on exercises, deployments, capability disclosures',
    },
];

const rows = SOURCES.map(s => ({ ...s, brief_id: BRIEF_ID }));
const { error } = await sb.from('brief_recommended_sources').insert(rows);
if (error) {
    console.error('Error:', error.message);
} else {
    console.log(`Inserted ${rows.length} recommended sources for brief ${BRIEF_ID}`);
}
