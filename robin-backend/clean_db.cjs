require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function cleanupJunk() {
  try {
    // We want to delete articles where matched_keywords contains ONLY 'topic_relevant' or 'brief_source'
    console.log('Cleaning up junk articles...');
    
    // First, let's look at what we're about to delete
    const { data: toDelete, error: checkErr } = await supabase
      .from('content_items')
      .select('id, title, matched_keywords')
      .contains('matched_keywords', ['topic_relevant']);
      
    if (checkErr) { // fallback safely
        console.error(checkErr);
    } else {
        console.log(`Found ${toDelete.length} items with topic_relevant tag.`);
        // Delete them
        if (toDelete.length > 0) {
            const ids = toDelete.map(item => item.id);
            const { error: delErr } = await supabase.from('content_items').delete().in('id', ids);
            if (delErr) console.error('Delete error topic_relevant:', delErr);
            else console.log('Deleted topic_relevant items.');
        }
    }
    
    const { data: toDelete2, error: checkErr2 } = await supabase
      .from('content_items')
      .select('id, title, matched_keywords')
      .contains('matched_keywords', ['brief_source']);
      
    if (!checkErr2 && toDelete2 && toDelete2.length > 0) {
        console.log(`Found ${toDelete2.length} items with brief_source tag.`);
        const ids = toDelete2.map(item => item.id);
        const { error: delErr2 } = await supabase.from('content_items').delete().in('id', ids);
        if (delErr2) console.error('Delete error brief_source:', delErr2);
        else console.log('Deleted brief_source items.');
    }
    
    console.log('Cleanup complete!');
  } catch(e) { console.error(e); }
}

cleanupJunk();
