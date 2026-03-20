// ============================================================
// ROBIN OSINT — Indian Newspaper Source Registry
//
// Used by the newspaper-intel-service integration to select
// which newspapers to scan for a given client brief.
//
// Each entry describes a single newspaper edition:
//   name            — canonical name passed to the extraction service
//   language        — ISO 639-1 code (hi/en/or/bn/te/ta/ml)
//   scraper_type    — how the service fetches the PDF:
//                       "aggregator_pdf"     → direct PDF from aggregator
//                       "flipbook_intercept" → e-paper viewer PDF intercept
//   base_url        — e-paper portal URL; the service resolves today's
//                     PDF URL from this (passed as pdf_url to /extract)
//   geographic_states — Indian state codes this edition covers;
//                       ["all"] means it's a national paper
//   cities          — cities with dedicated editions or strong coverage
// ============================================================

export const SOURCES = [

    // ── TIER 1 — Direct PDF / Aggregator ─────────────────────

    {
        name: 'Dainik Jagran',
        language: 'hi',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.jagran.com',
        geographic_states: ['UP', 'Uttarakhand', 'Bihar', 'MP', 'Jharkhand'],
        cities: ['Delhi', 'Lucknow', 'Patna', 'Dehradun', 'Varanasi', 'Agra', 'Kanpur'],
    },
    {
        name: 'Amar Ujala',
        language: 'hi',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.amarujala.com',
        geographic_states: ['UP', 'Uttarakhand', 'HP', 'Punjab', 'J&K'],
        cities: ['Delhi', 'Lucknow', 'Dehradun', 'Agra', 'Meerut', 'Chandigarh', 'Shimla'],
    },
    {
        name: 'Dainik Bhaskar',
        language: 'hi',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.bhaskar.com',
        geographic_states: ['MP', 'Rajasthan', 'Gujarat', 'Chhattisgarh', 'Bihar'],
        cities: ['Bhopal', 'Indore', 'Jaipur', 'Ahmedabad', 'Raipur', 'Patna'],
    },
    {
        name: 'Hindustan',
        language: 'hi',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.livehindustan.com',
        geographic_states: ['Bihar', 'Jharkhand', 'UP'],
        cities: ['Delhi', 'Patna', 'Lucknow', 'Ranchi'],
    },
    {
        name: 'Rajasthan Patrika',
        language: 'hi',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.patrika.com',
        geographic_states: ['Rajasthan'],
        cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer'],
    },
    {
        name: 'Punjab Kesari',
        language: 'hi',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.punjabkesari.in',
        geographic_states: ['Punjab', 'Haryana', 'HP', 'Delhi', 'J&K'],
        cities: ['Delhi', 'Chandigarh', 'Jalandhar', 'Ludhiana'],
    },
    {
        name: 'The Hindu',
        language: 'en',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.thehindu.com',
        geographic_states: ['all'],
        cities: ['Delhi', 'Mumbai', 'Chennai', 'Bengaluru', 'Hyderabad', 'Kolkata'],
    },
    {
        name: 'Indian Express',
        language: 'en',
        scraper_type: 'aggregator_pdf',
        base_url: 'https://epaper.indianexpress.com',
        geographic_states: ['all'],
        cities: ['Delhi', 'Mumbai', 'Pune', 'Chandigarh', 'Ahmedabad', 'Lucknow'],
    },

    // ── TIER 2 — Flipbook Intercept ───────────────────────────

    {
        name: 'Times of India',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.timesofIndia.com',
        geographic_states: ['all'],
        cities: ['Delhi', 'Mumbai', 'Kolkata', 'Bengaluru', 'Chennai', 'Hyderabad', 'Pune'],
    },
    {
        name: 'Hindustan Times',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.hindustantimes.com',
        geographic_states: ['all'],
        cities: ['Delhi', 'Mumbai', 'Chandigarh', 'Lucknow', 'Patna'],
    },
    {
        name: 'Prabhat Khabar',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.prabhatkhabar.com',
        geographic_states: ['Jharkhand', 'Bihar', 'WB'],
        cities: ['Ranchi', 'Patna', 'Dhanbad', 'Jamshedpur'],
    },
    {
        name: 'Samaja',
        language: 'or',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://www.thesamaja.com/epaper',
        geographic_states: ['Odisha'],
        cities: ['Bhubaneswar', 'Cuttack', 'Sambalpur', 'Berhampur'],
    },
    {
        name: 'Dharitri',
        language: 'or',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://dharitriepaper.in/',
        geographic_states: ['Odisha'],
        cities: ['Bhubaneswar', 'Cuttack', 'Sambalpur'],
    },
    {
        name: 'Anandabazar Patrika',
        language: 'bn',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.anandabazar.com',
        geographic_states: ['West Bengal'],
        cities: ['Kolkata', 'Siliguri'],
    },
    {
        name: 'Eenadu',
        language: 'te',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.eenadu.net',
        geographic_states: ['Telangana', 'Andhra Pradesh'],
        cities: ['Hyderabad', 'Vijayawada', 'Visakhapatnam'],
    },
    {
        name: 'Dinamalar',
        language: 'ta',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.dinamalar.com',
        geographic_states: ['Tamil Nadu'],
        cities: ['Chennai', 'Madurai', 'Coimbatore'],
    },
    {
        name: 'Deccan Herald',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.deccanherald.com',
        geographic_states: ['Karnataka'],
        cities: ['Bengaluru', 'Mysuru', 'Mangaluru'],
    },
    {
        name: 'Mathrubhumi',
        language: 'ml',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.mathrubhumi.com',
        geographic_states: ['Kerala'],
        cities: ['Kozhikode', 'Kochi', 'Thiruvananthapuram'],
    },
];

// ── Helper: normalise a state/language string for comparison ──
const norm = s => (s || '').toLowerCase().trim();

/**
 * Return sources relevant to a brief's geographic focus.
 *
 * @param {string[]} geographicStates  List of state names/codes from brief
 *                                     (e.g. ["Odisha", "Bhubaneswar", "WB"])
 * @param {string[]} [languages]       Optional ISO language codes to further filter
 *                                     (e.g. ["or", "en"])
 * @returns {Array<object>}            Deduplicated list of matching SOURCES entries
 */
export function getSourcesForBrief(geographicStates = [], languages = null) {
    if (!geographicStates.length) return [...SOURCES];

    const normStates = geographicStates.map(norm);

    const matched = SOURCES.filter(source => {
        if (languages?.length) {
            if (!languages.map(norm).includes(norm(source.language))) return false;
        }

        const sourceStates = source.geographic_states.map(norm);
        if (sourceStates.includes('all')) return true;

        const sourceCities = (source.cities || []).map(norm);

        return normStates.some(
            s => sourceStates.includes(s) || sourceCities.includes(s)
        );
    });

    const seen = new Set();
    return matched.filter(s => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
    });
}

/**
 * Return all newspaper names in the registry.
 *
 * @returns {string[]}
 */
export function getSourceNames() {
    return SOURCES.map(s => s.name);
}
