import dotenv from 'dotenv';
dotenv.config();
import { supabase } from './src/lib/supabase.js';

async function main() {
    const { data: sources } = await supabase
        .from('sources')
        .select('*')
        .eq('source_type', 'youtube');
        
    console.log(JSON.stringify(sources, null, 2));
}

main().then(() => setTimeout(() => process.exit(0), 1000));
