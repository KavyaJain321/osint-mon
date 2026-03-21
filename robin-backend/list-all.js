import dotenv from 'dotenv';
dotenv.config();
import { supabase } from './src/lib/supabase.js';
import fs from 'fs';

async function main() {
    const { data: sources } = await supabase.from('sources').select('name, url, source_type, client_id, is_active');
    fs.writeFileSync('all_sources.json', JSON.stringify(sources, null, 2));
    console.log('Saved to all_sources.json');
}

main().then(() => setTimeout(() => process.exit(0), 1000));
