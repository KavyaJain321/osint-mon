// Manual one-shot scrape for Government of Odisha client
import '../config.js';
import { runScraperCycle } from './orchestrator.js';
import { log } from '../lib/logger.js';

const ODISHA_CLIENT_ID = '7b5390a0-0d5b-419e-84b4-533fd9c44d36';

log.scraper.info('Starting manual Odisha Government scrape cycle...', { clientId: ODISHA_CLIENT_ID });

runScraperCycle(ODISHA_CLIENT_ID)
    .then(() => {
        log.scraper.info('Odisha scrape cycle complete');
        process.exit(0);
    })
    .catch((error) => {
        log.scraper.error('Odisha scrape cycle failed', { error: error.message });
        process.exit(1);
    });
