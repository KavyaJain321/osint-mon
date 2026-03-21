const http = require('http');

http.get('http://localhost:3000/api/test/intelligence?type=newspaper', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
        const json = JSON.parse(data);
        console.log(`Feed returned ${json.data?.length || 0} items`);
        (json.data || []).slice(0, 5).forEach(i => {
            console.log(`- [${i.content_type}] ${i.source_name}: ${i.url} (published: ${i.published_at})`);
        });
    } catch(e) { console.error("Error parsing", e); }
  });
}).on('error', e => console.error(e));
