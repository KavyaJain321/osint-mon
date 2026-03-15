// ============================================================
// ROBIN OSINT — Keyword Matcher Service
// Smart multi-strategy matching for article relevance
// v2: Proximity-aware word matching + content cleaning
// ============================================================

// Common stopwords to ignore in keyword decomposition
const STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'can', 'shall', 'with', 'from', 'by', 'as', 'its', 'it', 'this', 'that',
    'not', 'no', 'but', 'if', 'so', 'than', 'too', 'very', 'just',
]);

/**
 * Extract significant words from a keyword (filter stopwords, min 2 chars).
 */
function getSignificantWords(keyword) {
    return keyword
        .toLowerCase()
        .split(/[\s\-_\/]+/)
        .filter(w => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Find all positions of a word in text.
 * For short words (≤3 chars), uses word boundary matching.
 * @returns {number[]} Array of start positions
 */
function findWordPositions(text, word) {
    const positions = [];
    if (word.length <= 3) {
        const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
            positions.push(match.index);
        }
    } else {
        let idx = 0;
        const lowerWord = word.toLowerCase();
        const lowerText = text.toLowerCase();
        while ((idx = lowerText.indexOf(lowerWord, idx)) !== -1) {
            positions.push(idx);
            idx += lowerWord.length;
        }
    }
    return positions;
}

/**
 * Check if a set of words all appear within a proximity window in the text.
 * This prevents matching "government" in paragraph 1 with "orissa" in a footer.
 *
 * @param {string} text - The text to search
 * @param {string[]} sigWords - Significant words to look for
 * @param {number} maxDistance - Maximum char distance between words (default 200)
 * @returns {boolean} true if all words appear within the window
 */
function wordsInProximity(text, sigWords, maxDistance = 200) {
    // Get positions of all words
    const wordPositions = sigWords.map(w => findWordPositions(text, w));

    // If any word has 0 occurrences, no proximity match possible
    if (wordPositions.some(positions => positions.length === 0)) return false;

    // Use the rarest word (fewest positions) as anchor for efficiency
    let anchorIdx = 0;
    let minPositions = wordPositions[0].length;
    for (let i = 1; i < wordPositions.length; i++) {
        if (wordPositions[i].length < minPositions) {
            minPositions = wordPositions[i].length;
            anchorIdx = i;
        }
    }

    // For each anchor position, check if all other words appear within maxDistance
    for (const anchorPos of wordPositions[anchorIdx]) {
        let allClose = true;
        for (let i = 0; i < wordPositions.length; i++) {
            if (i === anchorIdx) continue;
            // Find if any occurrence of this word is within maxDistance of anchor
            const hasClose = wordPositions[i].some(
                pos => Math.abs(pos - anchorPos) <= maxDistance
            );
            if (!hasClose) {
                allClose = false;
                break;
            }
        }
        if (allClose) return true;
    }

    return false;
}

/**
 * Match keywords against text using a 3-tier strategy with proximity awareness:
 * 1. Exact phrase match (highest confidence)
 * 2. All significant words present WITHIN PROXIMITY (2-3 word keywords, 200 char window)
 * 3. Majority words present WITHIN PROXIMITY (4+ words, 60% threshold, 300 char window)
 *
 * @param {string} text - Text to search in
 * @param {string[]} keywords - Keywords to look for
 * @returns {string[]} Matched keywords (deduplicated)
 */
export function matchKeywords(text, keywords) {
    if (!text || !keywords || keywords.length === 0) return [];

    const lowerText = text.toLowerCase();
    const matched = new Set();

    for (const keyword of keywords) {
        const lowerKw = keyword.toLowerCase().trim();
        if (!lowerKw) continue;

        // Tier 1: Exact phrase match (always the strongest signal)
        if (lowerText.includes(lowerKw)) {
            matched.add(keyword);
            continue;
        }

        // Tier 2 & 3: Word-level matching with PROXIMITY for multi-word keywords
        const sigWords = getSignificantWords(lowerKw);

        if (sigWords.length <= 1) {
            // Single-word keyword: only exact match (already checked above)
            continue;
        }

        if (sigWords.length <= 3) {
            // Tier 2: Short multi-word (2-3 sig words)
            // Require ALL words within 200 chars of each other
            if (wordsInProximity(text, sigWords, 200)) {
                matched.add(keyword);
            }
        } else {
            // Tier 3: Long multi-word (4+ sig words)
            // First check if 60%+ of words exist at all
            const wordHits = sigWords.filter(w => {
                if (w.length <= 3) {
                    return new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(lowerText);
                }
                return lowerText.includes(w);
            });

            const ratio = wordHits.length / sigWords.length;
            if (ratio >= 0.6) {
                // Then verify proximity: the matching words must be near each other
                if (wordsInProximity(text, wordHits, 300)) {
                    matched.add(keyword);
                }
            }
        }
    }

    return [...matched];
}

/**
 * Quick filter: returns true if at least minMatches keywords match.
 * Uses the same proximity-aware logic as matchKeywords.
 * @param {string} text - Text to search
 * @param {string[]} keywords - Keywords to match
 * @param {number} minMatches - Minimum required matches
 * @returns {boolean}
 */
export function hasMinimumMatch(text, keywords, minMatches = 1) {
    if (!text || !keywords || keywords.length === 0) return false;
    // Reuse matchKeywords which now has proximity logic
    const matches = matchKeywords(text, keywords);
    return matches.length >= minMatches;
}

/**
 * Match an article against keywords using both title and content.
 * Keywords found in title always count as matches.
 * @param {{ title: string, content: string }} article
 * @param {string[]} keywords
 * @returns {{ matched: boolean, matchedKeywords: string[] }}
 */
export function matchArticle({ title, content }, keywords) {
    const titleMatches = matchKeywords(title || '', keywords);
    const contentMatches = matchKeywords(content || '', keywords);

    // Merge and deduplicate
    const allMatches = [...new Set([...titleMatches, ...contentMatches])];

    return {
        matched: allMatches.length > 0,
        matchedKeywords: allMatches,
    };
}

/**
 * Clean article content by stripping common boilerplate:
 * - Source attribution footers (e.g. "Orissa POST – Odisha's No.1 English Daily")
 * - Navigation/sidebar text that leaks in from HTML parsing
 * - Repeated ad text
 *
 * @param {string} content - Raw article text content
 * @returns {string} Cleaned content
 */
export function cleanArticleContent(content) {
    if (!content) return '';

    let cleaned = content;

    // Strip common newspaper footer patterns:
    // "Source Name – Tagline" at the end of articles
    // These inject the source name (e.g. "Orissa POST") into every article
    cleaned = cleaned
        // "Orissa POST – Odisha's No.1 English Daily" and similar
        .replace(/\b\w+\s+(POST|Times|Tribune|Herald|Express|Gazette|Chronicle|Observer|Mirror|Star|Sun|Journal|Standard|Review|Dispatch|Sentinel|Bulletin)\s*[–—-]\s*[^\n]{5,60}$/gi, '')
        // "Published in [Source]" / "Source: [Name]" at end
        .replace(/(?:Published\s+(?:in|by)|Source\s*:)\s*[^\n]{3,60}$/gi, '')
        // Generic "© 2026 Source Name" copyright lines
        .replace(/©\s*\d{4}\s+[^\n]{3,60}$/gi, '')
        // "Read more at [source]" at end
        .replace(/Read\s+more\s+(?:at|on)\s+[^\n]{3,60}$/gi, '');

    return cleaned.trim();
}

/**
 * Build a set of broad topic words from all keywords.
 * Used for light topic-relevance filtering on brief-generated sources.
 * Excludes overly generic words that appear in any news article.
 * @param {string[]} keywords - All keywords from the brief
 * @returns {Set<string>} Unique significant words across all keywords
 */
export function buildTopicWords(keywords) {
    // Words that are too generic for topic filtering — they appear in almost any news article.
    // CRITICAL: Single bare words like 'india', 'protest', 'corruption' would match
    // unrelated BBC/Reuters global headlines. Only allow these through when they appear
    // as PART of a multi-word keyword (e.g. "Odisha protest", "BJD corruption").
    const GENERIC_WORDS = new Set([
        // Common article boilerplate
        'social', 'media', 'risks', 'risk', 'warnings', 'warning', 'issues', 'issue',
        'treatment', 'effects', 'impact', 'analysis', 'report', 'system', 'global',
        'new', 'market', 'markets', 'news', 'world', 'government', 'policy',
        'people', 'public', 'data', 'information', 'health', 'crisis', 'major',
        'latest', 'breaking', 'today', 'state', 'national', 'international',
        // Country/region names — too broad on their own, match everything
        'india', 'usa', 'us', 'uk', 'china', 'russia', 'pakistan', 'europe',
        'america', 'britain', 'east', 'west', 'north', 'south', 'asian', 'global',
        // Generic political/crime trigger words — match any global news headline
        'protest', 'protests', 'fraud', 'scam', 'corruption', 'crackdown',
        'scandal', 'lawsuit', 'investigation', 'arrested', 'arrest', 'probe',
        'allegation', 'allegations', 'controversy', 'opposition', 'election',
        'vote', 'voting', 'poll', 'rally', 'strike', 'violence', 'attack',
        // Generic economic words
        'economy', 'economic', 'budget', 'growth', 'inflation', 'gdp', 'trade',
        'investment', 'stocks', 'shares', 'profit', 'loss', 'revenue', 'funding',
        // Generic institutional words
        'court', 'minister', 'parliament', 'congress', 'senate', 'bill', 'law',
        'party', 'leader', 'official', 'authority', 'commission', 'department',
    ]);

    const topicWords = new Set();
    for (const kw of keywords) {
        for (const word of getSignificantWords(kw)) {
            if (word.length >= 4 && !GENERIC_WORDS.has(word)) {
                topicWords.add(word);
            }
        }
    }
    return topicWords;
}

/**
 * Check if text is relevant to the brief's topic.
 * Requires at least 1 topic word to appear in the text.
 * Best used on article TITLES — short text where 1 match is meaningful.
 *
 * @param {string} text - Article title (or short text)
 * @param {Set<string>} topicWords - Pre-built topic word set from buildTopicWords()
 * @returns {boolean} true if 1+ topic word found
 */
export function topicRelevant(text, topicWords) {
    if (!text || !topicWords || topicWords.size === 0) return false;
    const lowerText = text.toLowerCase();
    for (const word of topicWords) {
        if (lowerText.includes(word)) return true;
    }
    return false;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
