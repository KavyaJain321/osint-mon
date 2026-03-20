// ============================================================
// Keyword Generator — Enhanced 10-Category Keyword Ontology
// Three-call LLM strategy for comprehensive coverage:
//   Call 1: Extract structured context from problem statement
//   Call 2: Generate primary keyword batch (categories 1-5)
//   Call 3: Generate advanced keyword batch (categories 6-10)
// Target: 80+ keywords across 10 categories
// ============================================================

import { groqChat } from '../lib/groq.js';
import { log } from '../lib/logger.js';
const MAX_KW = 100; // hard max

// ── 10 Category Definitions ───────────────────────────────

const CATEGORIES = {
    core_entity: { label: 'Core Entity Names', target: 10, priority: 10 },
    industry_sector: { label: 'Industry/Sector Terms', target: 10, priority: 9 },
    regulatory_legal: { label: 'Regulatory & Legal', target: 8, priority: 8 },
    geographic: { label: 'Geographic & Regional', target: 8, priority: 7 },
    competitor_peer: { label: 'Competitor & Peer', target: 8, priority: 7 },
    stakeholder: { label: 'Stakeholder & Official', target: 8, priority: 6 },
    sentiment: { label: 'Sentiment Triggers', target: 8, priority: 6 },
    abstract_lateral: { label: 'Abstract/Lateral', target: 8, priority: 5 },
    proxy_indicator: { label: 'Proxy Indicators', target: 6, priority: 5 },
    narrative: { label: 'Narrative Triggers', target: 6, priority: 4 },
};

// ── Call 1: Structured context extraction ──────────────────

async function extractBriefContext(problemStatement, clientName) {
    const prompt = `You are an intelligence analyst. Extract structured context from this client problem statement.

CLIENT: ${clientName}
PROBLEM STATEMENT:
${problemStatement}

Return ONLY valid JSON with this exact structure:
{
  "industry": "string (e.g. banking, pharma, energy, defense)",
  "risk_domains": ["array", "of", "strings"],
  "entities_of_interest": ["company or person names", "regulators", "govt bodies"],
  "competitors": ["competitor names if mentioned or inferable"],
  "geographic_focus": ["countries or regions"],
  "stakeholders": ["key officials, ministers, regulators mentioned or implied"],
  "core_problem": "1 sentence summary of the core intelligence need",
  "sub_topics": ["3-5 specific sub-topics derived from the problem"]
}

Risk domain options: financial, regulatory, reputational, operational, geopolitical, legal, environmental, cybersecurity, technological, supply_chain
Return only JSON, no explanation.`;

    const resp = await groqChat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.2, max_tokens: 800, response_format: { type: 'json_object' } }
    );

    return JSON.parse(resp.choices[0].message.content);
}

// ── Call 2: Primary keywords (categories 1-5) ─────────────

async function generatePrimaryKeywords(context, problemStatement) {
    const prompt = `You are a senior OSINT analyst building a keyword ontology for continuous media monitoring.

CLIENT CONTEXT:
- Industry: ${context.industry}
- Core Problem: ${context.core_problem}
- Risk Domains: ${context.risk_domains.join(', ')}
- Key Entities: ${context.entities_of_interest.join(', ')}
- Competitors: ${(context.competitors || []).join(', ') || 'Not specified'}
- Stakeholders: ${(context.stakeholders || []).join(', ') || 'Not specified'}
- Geography: ${context.geographic_focus.join(', ')}
- Sub-topics: ${(context.sub_topics || []).join(', ')}

ORIGINAL PROBLEM: ${problemStatement.substring(0, 600)}

Generate keywords for these 5 categories:

1. **core_entity** (10 keywords): The exact names, abbreviations, ticker symbols, and short name variants of the primary entities being monitored. Use the SHORTEST form journalists actually write: "Trump" not "Trump Administration", "Fed" not "Federal Reserve Board of Governors", "OPEC" not "OPEC member nations".

2. **industry_sector** (10 keywords): Industry-specific terminology and acronyms professionals use in headlines. Use short industry jargon: "tariff", "sanctions", "inflation", "CPI", "interest rate" — NOT generic phrases like "monetary policy adjustment".

3. **regulatory_legal** (8 keywords): Laws, regulatory bodies, and compliance terms. Use short forms: "SEC", "FDA approval", "antitrust", "sanctions" — NOT full legal act names.

4. **geographic** (8 keywords): Specific cities, regions, economic zones relevant to the problem. Short names: "Wall Street", "Brussels", "Beijing" — not "Washington D.C. federal district".

5. **competitor_peer** (8 keywords): Named competitors and industry benchmarks. Use short recognized names.

CRITICAL RULES FOR MATCHING:
- Keywords MUST be highly PRECISE and UNIQUE to the specific client/context so they don't match unrelated global news.
- REGIONAL STRICTNESS: If the client focus is a specific state or region (e.g., Odisha), DO NOT generate names of other states (like Kerala, West Bengal, Maharashtra, etc.). Stick ONLY to the geography directly requested.
- Keywords MUST be 1-3 words maximum — they are used for substring matching against news headlines.
- DO NOT generate generic single-word terms like "protest", "fraud", "corruption", "crackdown", "India", "SEC" unless tightly coupled with the client name or region (e.g. "Odisha protest", "Odisha fraud").
- If a concept is broad, you MUST combine it with the client entity or geography to form a 2-3 word phrase.
- Think: what phrase would appear in a headline specifically about THIS client and NOT about a random global event?
- BAD EXAMPLES: "protest", "fraud", "corruption", "India", "SEC", "Section 232 investigation"
- GOOD EXAMPLES: "Odisha protest", "Odisha fraud", "BJD corruption", "Odisha CM", "tariff", "Fed rate"

Return ONLY valid JSON:
{
  "keywords": [
    {
      "keyword": "short headline term",
      "category": "core_entity|industry_sector|regulatory_legal|geographic|competitor_peer",
      "priority": 1-10,
      "rationale": "one sentence why this matters"
    }
  ]
}`;

    const resp = await groqChat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.35, max_tokens: 3000, response_format: { type: 'json_object' } }
    );

    const parsed = JSON.parse(resp.choices[0].message.content);
    return parsed.keywords || [];
}

// ── Call 3: Advanced keywords (categories 6-10) ───────────

async function generateAdvancedKeywords(context, problemStatement, primaryKeywords) {
    const existingKws = primaryKeywords.map(k => k.keyword).join(', ');

    const prompt = `You are a senior intelligence analyst. You already have these primary monitoring keywords:
[${existingKws}]

Now generate ADVANCED keywords for the SAME intelligence brief:

CLIENT CONTEXT:
- Industry: ${context.industry}
- Core Problem: ${context.core_problem}
- Risk Domains: ${context.risk_domains.join(', ')}
- Geography: ${context.geographic_focus.join(', ')}

Generate keywords for these 5 categories:

6. **stakeholder** (8 keywords): Key decision-makers and officials — use the SHORT name form that appears in headlines: "Powell" not "Federal Reserve Chairman Jerome Powell", "Yellen" not "Treasury Secretary Janet Yellen".

7. **sentiment** (8 keywords): Short trigger words indicating risk or crisis. Use single words or very short phrases: "recession", "crash", "sanctions", "lawsuit", "downgrade", "recall", "investigation" — specific to this industry.

8. **abstract_lateral** (8 keywords): Adjacent industry terms and macro trends that indirectly signal change. Keep short: "chip shortage", "supply chain", "AI", "automation".

9. **proxy_indicator** (6 keywords): Short measurable proxy signals: stock tickers, hashtags, economic indicators. Examples: "yield curve", "VIX", "jobless claims", "PMI".

10. **narrative** (6 keywords): Short media narrative frames: "whistleblower", "cover-up", "crackdown", "bailout", "default".

CRITICAL RULES FOR MATCHING:
- Keywords MUST be highly PRECISE and UNIQUE to the specific client/context so they don't match unrelated global news.
- REGIONAL STRICTNESS: If the client focus is a specific state or region (e.g., Odisha), DO NOT generate names of other states (like Kerala, West Bengal, Maharashtra, etc.). Stick ONLY to the geography directly requested.
- Keywords MUST be 1-3 words maximum — they are used for substring matching against news headlines.
- DO NOT generate generic single-word terms like "protest", "fraud", "corruption", "crackdown", "India", "SEC", "bailout", "investigation" unless tightly coupled with the client name (e.g. "Odisha bailout", "Odisha investigation").
- If a concept is broad, you MUST combine it with the client entity or geography to form a 2-3 word phrase.
- BAD: "oversight", "sanctions", "protest", "fraud", "corruption", "economy", "growth"
- GOOD: "Odisha oversight", "Odisha sanctions", "BJD protest", "BJD fraud"
- Do NOT repeat any keywords from the primary batch

Return ONLY valid JSON:
{
  "keywords": [
    {
      "keyword": "short headline term",
      "category": "stakeholder|sentiment|abstract_lateral|proxy_indicator|narrative",
      "priority": 1-10,
      "rationale": "one sentence why this matters"
    }
  ]
}`;

    const resp = await groqChat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.4, max_tokens: 2500, response_format: { type: 'json_object' } }
    );

    const parsed = JSON.parse(resp.choices[0].message.content);
    return parsed.keywords || [];
}

// ── Quality filter ─────────────────────────────────────────

const GENERIC_WORDS = new Set([
    'news', 'report', 'latest', 'update', 'article', 'story', 'press',
    'release', 'data', 'information', 'analysis', 'insight', 'trend',
    'company', 'market', 'business', 'industry', 'sector', 'global',
    'world', 'international', 'national', 'local', 'new', 'recent',
    'protest', 'fraud', 'corruption', 'crackdown', 'india', 'usa', 'uk', 
    'sec', 'government', 'policy', 'law', 'lawsuit', 'investigation', 
    'scandal', 'crisis', 'economy', 'growth', 'loss', 'profit',
    'stocks', 'shares', 'trading', 'investment', 'funding', 'startup'
]);

function filterKeywords(keywords) {
    const seen = new Set();
    return keywords.filter(kw => {
        const w = kw.keyword.toLowerCase().trim();
        if (w.length < 3) return false;
        if (GENERIC_WORDS.has(w)) return false;
        if (!kw.category) return false;
        if (seen.has(w)) return false; // dedup
        seen.add(w);
        // Ensure valid category
        if (!CATEGORIES[kw.category]) {
            // Try to map old categories
            const catMap = {
                'primary': 'core_entity',
                'entity': 'core_entity',
                'semantic': 'industry_sector',
                'competitive': 'competitor_peer',
                'temporal': 'narrative',
                'negative': 'sentiment',
            };
            kw.category = catMap[kw.category] || kw.category;
        }
        return true;
    });
}

// ── Call 4: Translate Keywords to Odia ─────────────────────

async function translateKeywordsToOdia(keywords) {
    // Only translate the top 30 keywords to save tokens and time
    const topKeywords = [...keywords].sort((a, b) => b.priority - a.priority).slice(0, 30);
    const kwsList = topKeywords.map(k => k.keyword).join(', ');
    
    const prompt = `You are a professional Odia translator. Translate the following English media monitoring keywords strictly into the Odia language (ଓଡ଼ିଆ). These will be used to search for news articles in Odia newspapers like Sambad and Dharitri.
Return ONLY valid JSON with this exact structure:
{
  "translations": [
    {
      "english": "original english keyword",
      "odia": "odia translation"
    }
  ]
}

Keywords to translate:
[${kwsList}]`;

    try {
        const resp = await groqChat(
            [{ role: 'user', content: prompt }],
            { temperature: 0.1, max_tokens: 3000, response_format: { type: 'json_object' } }
        );
        const parsed = JSON.parse(resp.choices[0].message.content);
        return parsed.translations || [];
    } catch (e) {
        log.ai.error('Odia translation failed', { error: e.message });
        return [];
    }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Generate an 80+ keyword ontology from a client problem brief.
 *
 * @param {string} problemStatement - Raw problem text from client
 * @param {string} clientName       - Client organization name
 * @returns {Promise<{ context: Object, keywords: Array }>}
 */
export async function generateKeywordsFromBrief(problemStatement, clientName) {
    const startTime = Date.now();
    log.ai.info('Keyword generation started (enhanced 10-category)', { clientName, statementLen: problemStatement.length });

    try {
        // Call 1: extract structured context
        const context = await extractBriefContext(problemStatement, clientName);
        log.ai.info('Brief context extracted', {
            industry: context.industry,
            entities: context.entities_of_interest?.length,
            subTopics: context.sub_topics?.length,
        });

        // Call 2: generate primary keywords (categories 1-5)
        const primaryKws = await generatePrimaryKeywords(context, problemStatement);
        log.ai.info('Primary keywords generated', { count: primaryKws.length });

        // Call 3: generate advanced keywords (categories 6-10)
        const advancedKws = await generateAdvancedKeywords(context, problemStatement, primaryKws);
        log.ai.info('Advanced keywords generated', { count: advancedKws.length });

        // Merge and filter
        const allKws = [...primaryKws, ...advancedKws];
        const keywords = filterKeywords(allKws).slice(0, MAX_KW);

        // Call 4: Translate top keywords to Odia
        log.ai.info('Translating top keywords to Odia...', { count: keywords.length });
        const translations = await translateKeywordsToOdia(keywords);
        
        const kwMap = new Map();
        keywords.forEach(kw => kwMap.set(kw.keyword.toLowerCase(), kw));

        const odiaKeywords = [];
        for (const trans of translations) {
            if (trans.odia && trans.odia !== trans.english) {
                 const orig = kwMap.get((trans.english || '').toLowerCase());
                 if (orig) {
                     odiaKeywords.push({
                         keyword: trans.odia,
                         category: orig.category,
                         priority: orig.priority,
                         rationale: orig.rationale + ' (Odia Translation)'
                     });
                 }
            }
        }
        
        const finalKeywords = [...keywords, ...odiaKeywords];

        // Log category breakdown
        const catCounts = {};
        for (const kw of finalKeywords) {
            catCounts[kw.category] = (catCounts[kw.category] || 0) + 1;
        }

        const elapsed = Date.now() - startTime;
        log.ai.info('Keyword generation complete (enhanced + Odia)', {
            total: finalKeywords.length,
            englishCount: keywords.length,
            odiaCount: odiaKeywords.length,
            categories: catCounts,
            ms: elapsed,
        });

        return { context, keywords: finalKeywords };

    } catch (err) {
        log.ai.error('Keyword generation failed', { error: err.message });
        throw err;
    }
}

// Export for testing
export { CATEGORIES };
