// ============================================================
// ROBIN OSINT — Indian Newspaper Source Registry
//
// Used by the newspaper-intel-service integration to select
// which newspapers to scan for a given client brief.
//
// Each entry describes a single newspaper edition:
//   name            — canonical name passed to the extraction service
//   language        — ISO 639-1 code (hi/en/or/bn/te/ta/ml)
//   scraper_type    — how the service fetches the PDF (all use flipbook_intercept now)
//   base_url        — e-paper portal URL; the service resolves today's
//                     PDF URL from this (passed as pdf_url to /extract)
//   geographic_states — Indian state codes this edition covers;
//                       ["all"] means it's a national paper
//   cities          — cities with dedicated editions or strong coverage
// ============================================================

export const SOURCES = [
    // ── NATIONAL ENGLISH PAPERS ───────────────────────

    {
        name: 'The Hindu',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.thehindu.com',
        geographic_states: ['all'],
        cities: ['Delhi', 'Mumbai', 'Chennai', 'Bengaluru', 'Hyderabad', 'Kolkata'],
    },
    {
        name: 'Indian Express',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.indianexpress.com',
        geographic_states: ['all'],
        cities: ['Delhi', 'Mumbai', 'Pune', 'Chandigarh', 'Ahmedabad', 'Lucknow'],
    },
    {
        name: 'Times of India',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.timesgroup.com',
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
        name: 'Deccan Herald',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.deccanherald.com',
        geographic_states: ['Karnataka'],
        cities: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubli'],
    },
    {
        name: 'The Tribune',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.tribuneindia.com',
        geographic_states: ['Punjab', 'Haryana', 'HP', 'Uttarakhand'],
        cities: ['Chandigarh', 'Delhi', 'Jalandhar', 'Dehradun'],
    },

    // ── HINDI PAPERS ─────────────────────────────────

    {
        name: 'Dainik Jagran',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.jagran.com',
        geographic_states: ['UP', 'Uttarakhand', 'Bihar', 'MP', 'Jharkhand'],
        cities: ['Delhi', 'Lucknow', 'Patna', 'Dehradun', 'Varanasi', 'Agra', 'Kanpur'],
    },
    {
        name: 'Amar Ujala',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.amarujala.com',
        geographic_states: ['UP', 'Uttarakhand', 'HP', 'Punjab', 'J&K'],
        cities: ['Delhi', 'Lucknow', 'Dehradun', 'Agra', 'Meerut', 'Chandigarh', 'Shimla'],
    },
    {
        name: 'Dainik Bhaskar',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://www.bhaskar.com/epaper',
        geographic_states: ['MP', 'Rajasthan', 'Gujarat', 'Chhattisgarh', 'Bihar'],
        cities: ['Bhopal', 'Indore', 'Jaipur', 'Ahmedabad', 'Raipur', 'Patna'],
    },
    {
        name: 'Hindustan',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://www.livehindustan.com/epaper',
        geographic_states: ['Bihar', 'Jharkhand', 'UP'],
        cities: ['Delhi', 'Patna', 'Lucknow', 'Ranchi'],
    },
    {
        name: 'Rajasthan Patrika',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.patrika.com',
        geographic_states: ['Rajasthan'],
        cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer'],
    },
    {
        name: 'Punjab Kesari',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://www.punjabkesari.in/epaper',
        geographic_states: ['Punjab', 'Haryana', 'HP', 'Delhi', 'J&K'],
        cities: ['Delhi', 'Chandigarh', 'Jalandhar', 'Ludhiana'],
    },
    {
        name: 'Prabhat Khabar',
        language: 'hi',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.prabhatkhabar.com',
        geographic_states: ['Jharkhand', 'Bihar', 'WB'],
        cities: ['Ranchi', 'Patna', 'Dhanbad', 'Jamshedpur'],
    },

    // ── ODISHA — Primary focus sources ──────────────────

    {
        name: 'Dharitri',
        language: 'or',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://dharitriepaper.in',
        geographic_states: ['Odisha'],
        cities: ['Bhubaneswar', 'Cuttack', 'Sambalpur'],
    },
    {
        name: 'Pragativadi',
        language: 'or',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://pragativadi.com',
        geographic_states: ['Odisha'],
        cities: ['Bhubaneswar', 'Cuttack', 'Bhadrak', 'Balasore'],
    },
    {
        name: 'Sambad',
        language: 'or',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://sambad.in',
        geographic_states: ['Odisha'],
        cities: ['Bhubaneswar', 'Cuttack', 'Sambalpur', 'Berhampur'],
    },
    {
        name: 'Orissa Post',
        language: 'en',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://www.orissapost.com',
        geographic_states: ['Odisha'],
        cities: ['Bhubaneswar', 'Cuttack'],
    },
    // SSL cert error currently on epaper.thesamaja.com — keeping inactive here or commenting out
    // {
    //     name: 'Samaja',
    //     language: 'or',
    //     scraper_type: 'flipbook_intercept',
    //     base_url: 'https://epaper.thesamaja.com',
    //     geographic_states: ['Odisha'],
    //     cities: ['Bhubaneswar', 'Cuttack', 'Sambalpur', 'Berhampur'],
    // },
    {
        name: 'Odisha TV (OTV)',
        language: 'or',
        scraper_type: 'html_article',
        base_url: 'https://odishatv.in',
        geographic_states: ['Odisha'],
        cities: ['Bhubaneswar'],
    },

    // ── OTHER REGIONAL PAPERS ─────────────────────────

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
        cities: ['Hyderabad', 'Vijayawada', 'Visakhapatnam', 'Tirupati'],
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
        name: 'Mathrubhumi',
        language: 'ml',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.mathrubhumi.com',
        geographic_states: ['Kerala'],
        cities: ['Kozhikode', 'Kochi', 'Thiruvananthapuram'],
    },
    {
        name: 'Divya Bhaskar',
        language: 'gu',
        scraper_type: 'flipbook_intercept',
        base_url: 'https://epaper.divyabhaskar.co.in',
        geographic_states: ['Gujarat'],
        cities: ['Ahmedabad', 'Surat', 'Vadodara'],
    },
];

export function getSourcesForBrief(brief) {
    if (!brief || !brief.geographic_focus || !brief.languages) return [];
    
    // Exact matched sources by state + national sources
    const allowedStates = brief.geographic_focus;
    const allowedLangs = brief.languages.map(l => l.toLowerCase());
    
    return SOURCES.filter(s => {
        const matchesState = s.geographic_states.some(st => st === 'all' || allowedStates.includes(st));
        const matchesLang = allowedLangs.includes(s.language.toLowerCase());
        return matchesState || matchesLang;
    });
}
