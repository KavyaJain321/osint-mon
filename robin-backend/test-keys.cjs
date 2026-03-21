require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    const { data: clients, error: cerr } = await supabase.from('client_briefs').select('id, title, client_id, entities_of_interest').order('created_at', { ascending: false }).limit(1);
    
    if (cerr) {
        console.error('client_briefs error:', cerr);
        return;
    }

    if (!clients || clients.length === 0) {
      console.log('No briefs found');
      return;
    }
    
    const brief = clients[0];
    console.log('Brief:', brief.title);
    
    const { data: keys, error: kerr } = await supabase.from('brief_generated_keywords').select('keyword, type, is_required').eq('brief_id', brief.id);
    if (kerr) console.error('keys error:', kerr);
    console.log('Keywords:', keys.map(k => k.keyword).join(', '));
    
    // Also, what's in watch_expressions?
    const { data: wex, error: wexerr } = await supabase.from('watch_expressions').select('expression').eq('client_id', brief.client_id);
    if (wex) console.log('Watch Expressions:', wex.map(w => w.expression).join(', '));
    else console.error('watch err', wexerr);

  } catch (err) {
    console.error('Error:', err);
  }
}
run();
