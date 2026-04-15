// Manual one-shot scrape for RIGIOR client
import '../config.js';
import { runScraperCycle } from './orchestrator.js';
import { log } from '../lib/logger.js';

const RIGIOR_CLIENT_ID = 'c9493d5b-45bc-4c33-998b-e4d5cdde8f59';

log.scraper.info('Starting manual RIGIOR scrape cycle...', { clientId: RIGIOR_CLIENT_ID });

runScraperCycle(RIGIOR_CLIENT_ID)
    .then(() => {
        log.scraper.info('RIGIOR scrape cycle complete');
        process.exit(0);
    })
    .catch((error) => {
        log.scraper.error('RIGIOR scrape cycle failed', { error: error.message });
        process.exit(1);
    });
