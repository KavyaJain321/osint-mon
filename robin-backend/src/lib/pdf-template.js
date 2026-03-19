export function generateMediaReportHtml({ 
    client, 
    enriched, 
    pos, neu, neg, tot, 
    tvA, onA, npA,
    cmA, cmPos, cmNeu, cmNeg,
    issues,
    sentStyle,
    fmtT,
    fmtD,
    grpByDate,
    svgPh
}) {
    const today = new Date().toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'});

    function artCard(a) { 
        const ss = sentStyle(a.sentiment); 
        const fb = svgPh(a.source_name, a.mediaType); 
        const img = a.image_url || fb; 
        
        return `
      <div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid #f1f5f9;break-inside:avoid;">
        <img src="${img}" alt="" data-article-url="${a.url || ''}" style="width:130px;height:85px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid #e2e8f0;" onerror="this.src='${fb}'">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="background:${ss.bg};color:${ss.col};border:1px solid ${ss.br||'transparent'};padding:2px 10px;border-radius:4px;font-size:10px;font-weight:600;">● ${ss.lbl}</span>
            <span style="color:#94a3b8;font-size:11px;">${fmtT(a.published_at||a.created_at)}</span>
            <span style="color:#94a3b8;font-size:11px;">|</span>
            <span style="color:#64748b;font-size:11px;font-weight:500;">${a.source_name}</span>
            ${a.importance>=7?'<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;">⚡ HIGH PRIORITY</span>':''}
          </div>
          <a href="${a.url||'#'}" target="_blank" style="font-size:14px;font-weight:600;color:#0f172a;text-decoration:none;line-height:1.3;display:block;margin-bottom:4px;">${a.title||'Untitled'}</a>
          <p style="font-size:12px;color:#64748b;line-height:1.5;margin:0;">${(a.summary||a.title||'').substring(0,220)}...</p>
          ${a.matched_keywords?.length?`
          <div style="margin-top:6px;">${a.matched_keywords.slice(0,5).map(k=>`<span style="background:#f0fdf4;color:#166534;padding:2px 8px;border-radius:4px;font-size:9px;margin-right:4px;">#${k}</span>`).join('')}</div>`:``}
        </div>
      </div>`; 
    }

    function buildSec(title, icon, items, color) { 
        const groups = grpByDate(items); 
        if(!items.length) return ''; 
        
        let html = `
<div class="page-break" style="padding:50px 60px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid ${color};"><span style="font-size:28px;">${icon}</span><h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">${title}</h2><span style="background:${color}20;color:${color};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;margin-left:auto;">${items.length} Stories</span></div>`; 
        
        for(const [date,dayItems] of groups) { 
            html += `
<div style="margin-bottom:28px;"><div style="background:linear-gradient(90deg,${color}15,transparent);padding:8px 16px;border-left:4px solid ${color};border-radius:0 6px 6px 0;margin-bottom:12px;"><span style="font-size:14px;font-weight:700;color:#0f172a;">📅 ${fmtD(date)}</span><span style="color:#94a3b8;font-size:12px;margin-left:12px;">${dayItems.length} stories</span></div>
            ${dayItems.map(a=>artCard(a)).join('')}
</div>`; 
        } 
        return html + '</div>'; 
    }

    function issueBars(issue) { 
        const t = issue.total || 1; 
        const pp = Math.round(issue.positive/t*100), np = Math.round(issue.negative/t*100), nup = 100-pp-np; 
        return `
        <div style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:14px;font-weight:600;color:#1e293b;">${issue.name}</span>
            <span style="font-size:12px;color:#64748b;font-weight:500;">${issue.total} mentions</span>
          </div>
          <div style="display:flex;height:24px;border-radius:6px;overflow:hidden;background:#f1f5f9;">
            ${pp>0?`<div style="width:${pp}%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${pp}%</div>`:``}
            ${nup>0?`<div style="width:${nup}%;background:#94a3b8;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${nup}%</div>`:``}
            ${np>0?`<div style="width:${np}%;background:#ef4444;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${np}%</div>`:``}
          </div>
        </div>`; 
    }

    const cmNeuPct = Math.round(cmNeu/Math.max(cmA.length,1)*100);
    const cmPosPct = Math.round(cmPos/Math.max(cmA.length,1)*100);
    const cmNegPct = Math.round(cmNeg/Math.max(cmA.length,1)*100);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ROBIN — Odisha Media Intelligence Report — ${today}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
@page { margin:0; size:A4; }
* { box-sizing:border-box; }
body { font-family:'Inter', sans-serif; margin:0; padding:0; background:white; color:#0f172a; line-height:1.5; font-size:13px; }
.page-break { page-break-before: always; break-before: page; }
</style>
</head>
<body>

<!-- COVER PAGE -->
<div style="min-height:100vh;background:linear-gradient(135deg,#0a0c12 0%,#0f172a 40%,#1e293b 100%);display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;text-align:center;padding:60px 40px;">
  <div style="width:70px;height:70px;border-radius:16px;background:linear-gradient(135deg,#0d9488,#0f766e);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;box-shadow:0 20px 60px rgba(13,148,136,0.3);margin-bottom:30px;">R</div>
  <h1 style="font-size:42px;font-weight:800;letter-spacing:-1px;margin-bottom:8px;">Odisha Media Intelligence Report</h1>
  <p style="font-size:18px;color:rgba(255,255,255,0.5);margin-bottom:40px;">Daily OSINT Monitoring — Government of ${client.name}</p>
  <div style="width:80px;height:3px;background:linear-gradient(90deg,#0d9488,#f59e0b);border-radius:2px;margin-bottom:40px;"></div>
  <h3 style="font-size:22px;font-weight:600;color:#0d9488;margin-bottom:8px;">Government of ${client.name}</h3>
  <p style="color:rgba(255,255,255,0.4);font-size:14px;">Infrastructure & Governance Media Monitoring</p>
  <p style="color:rgba(255,255,255,0.3);font-size:13px;margin-top:20px;">Report Date: ${today}</p>
  <p style="color:rgba(255,255,255,0.3);font-size:13px;">Classification: <strong style="color:#f59e0b;">CONFIDENTIAL — Client Only</strong></p>
  <div style="margin-top:50px;display:flex;gap:40px;">
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#0d9488;">${enriched.length}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Odisha Stories</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#22c55e;">${pos}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Positive</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#cbd5e1;">${neu}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Neutral</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#ef4444;">${neg}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Negative</div></div>
  </div>
</div>

<!-- KEY INTELLIGENCE SIGNALS -->
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:30px;padding-bottom:16px;border-bottom:3px solid #0d9488;">
    <span style="font-size:32px;">🎯</span>
    <h2 style="font-size:28px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">Key Intelligence Signals</h2>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:40px;">
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
      <h3 style="font-size:14px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:20px;">Media Breakdown</h3>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:24px;">📺</span><span style="font-size:15px;font-weight:600;color:#1e293b;">TV News</span></div>
          <span style="font-size:20px;font-weight:800;color:#0d9488;">${tvA.length}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:24px;">🌐</span><span style="font-size:15px;font-weight:600;color:#1e293b;">Online Portals</span></div>
          <span style="font-size:20px;font-weight:800;color:#0d9488;">${onA.length}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:24px;">📰</span><span style="font-size:15px;font-weight:600;color:#1e293b;">Newspapers</span></div>
          <span style="font-size:20px;font-weight:800;color:#0d9488;">${npA.length}</span>
        </div>
      </div>
    </div>
    
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.03);">
      <h3 style="font-size:14px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:20px;">Topic Sentiments</h3>
      ${issues.length > 0 ? issues.map(i=>issueBars(i)).join('') : '<p style="color:#94a3b8;">No topics found</p>'}
    </div>
  </div>

  <div style="background:linear-gradient(135deg,#0d9488,#0f766e);border-radius:16px;padding:30px;color:white;display:flex;align-items:center;gap:30px;">
    <div style="flex:1;">
      <h3 style="font-size:20px;font-weight:700;margin-bottom:12px;">Overall Sentiment Index</h3>
      <p style="font-size:14px;color:rgba(255,255,255,0.8);line-height:1.6;margin:0;">Based on semantic analysis of ${enriched.length} captured stories relating to ${client.name} today. Priority signals are evaluated using AI-based entity extraction.</p>
    </div>
    <div style="background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);padding:20px 30px;border-radius:12px;text-align:center;">
      <div style="font-size:42px;font-weight:800;line-height:1;">${Math.round((pos/(Math.max(1, pos+neg)))*100) || 50}%</div>
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-top:8px;color:rgba(255,255,255,0.8);">Positivity Score</div>
    </div>
  </div>
</div>

<!-- CM PERCEPTION -->
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:30px;padding-bottom:16px;border-bottom:3px solid #2563eb;">
    <span style="font-size:32px;">🏛️</span>
    <h2 style="font-size:28px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">Chief Minister Perception</h2>
  </div>

  <div style="display:grid;grid-template-columns:250px 1fr;gap:30px;margin-bottom:40px;">
    <div style="background:linear-gradient(135deg,#1e3a8a,#1e40af);border-radius:16px;padding:30px;text-align:center;color:white;display:flex;flex-direction:column;justify-content:center;">
      <div style="font-size:64px;font-weight:800;line-height:1;">${cmA.length}</div>
      <div style="font-size:14px;font-weight:600;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;margin-top:16px;">Direct Mentions</div>
      <p style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:16px;line-height:1.5;">Across TV, Online & Print</p>
    </div>
    
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:30px;box-shadow:0 10px 30px rgba(0,0,0,0.03);display:flex;flex-direction:column;justify-content:center;">
      <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:24px;">Perception Breakdown</h3>
      
      <div style="display:flex;height:40px;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${cmPosPct>0 ? `<div style="width:${cmPosPct}%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px;">${cmPosPct}%</div>` : ''}
        ${cmNeuPct>0 ? `<div style="width:${cmNeuPct}%;background:#94a3b8;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px;">${cmNeuPct}%</div>` : ''}
        ${cmNegPct>0 ? `<div style="width:${cmNegPct}%;background:#ef4444;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px;">${cmNegPct}%</div>` : ''}
      </div>
      
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;">
        <span style="color:#16a34a;display:flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:3px;background:#22c55e;display:block;"></span> Positive (${cmPos})</span>
        <span style="color:#64748b;display:flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:3px;background:#94a3b8;display:block;"></span> Neutral (${cmNeu})</span>
        <span style="color:#dc2626;display:flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:3px;background:#ef4444;display:block;"></span> Negative (${cmNeg})</span>
      </div>
    </div>
  </div>

  ${cmA.length > 0 ? `
  <h3 style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
    <span style="width:4px;height:16px;background:#2563eb;display:block;border-radius:2px;"></span>
    Recent Stories
  </h3>
  <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:0 24px;">
    ${cmA.slice(0, 10).map(a => `
    <div style="padding:20px 0;border-bottom:1px solid #f1f5f9;display:flex;gap:20px;align-items:flex-start;break-inside:avoid;">
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="background:${sentStyle(a.sentiment).bg};color:${sentStyle(a.sentiment).col};padding:3px 10px;border-radius:4px;font-size:10px;font-weight:800;">● ${sentStyle(a.sentiment).lbl}</span>
          <span style="font-size:12px;color:#64748b;font-weight:600;">${a.source_name}</span>
          <span style="color:#cbd5e1;">•</span>
          <span style="font-size:12px;color:#94a3b8;">${fmtT(a.published_at || a.created_at)}</span>
        </div>
        <a href="${a.url||'#'}" target="_blank" style="font-size:15px;font-weight:700;color:#0f172a;text-decoration:none;display:block;margin-bottom:4px;line-height:1.4;">${a.title}</a>
      </div>
    </div>`).join('')}
  </div>` : '<p style="color:#94a3b8;font-style:italic;">No articles directly mentioning the Chief Minister were found in this period.</p>'}
</div>

${buildSec('TV Intelligence','📺',tvA,'#7c3aed')}
${buildSec('Online News','🌐',onA,'#0d9488')}
${buildSec('Newspapers','📰',npA,'#ea580c')}

<!-- BACK COVER -->
<div class="page-break" style="min-height:100vh;background:linear-gradient(135deg,#0a0c12,#0f172a,#1e293b);display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;text-align:center;padding:60px;">
  <div style="width:50px;height:50px;border-radius:12px;background:linear-gradient(135deg,#0d9488,#0f766e);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;margin-bottom:24px;">R</div>
  <h2 style="font-size:28px;font-weight:700;margin-bottom:8px;">ROBIN Intelligence Platform</h2>
  <p style="color:rgba(255,255,255,0.4);font-size:13px;margin-bottom:30px;">AI-Powered Media Monitoring & Analysis</p>
  <div style="width:60px;height:2px;background:linear-gradient(90deg,#0d9488,#f59e0b);margin-bottom:30px;"></div>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;">This report was automatically generated by the ROBIN Intelligence Platform.</p>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;">Only ${client.name}-relevant articles from ${enriched.length} monitored stories are included.</p>
  <p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:30px;">© 2026 ROBIN Intelligence. Confidential — Government of ${client.name}.</p>
</div>
<script>
// Client-side og:image loader — fetches article pages and extracts og:image meta tags
(function() {
  const imgs = document.querySelectorAll('img[data-article-url]');
  const PROXY = 'https://api.allorigins.win/raw?url=';
  let i = 0;
  function next() {
    if (i >= imgs.length) return;
    const img = imgs[i++];
    const url = img.getAttribute('data-article-url');
    if (!url || url === '#' || img.src.startsWith('http')) { next(); return; }
    fetch(PROXY + encodeURIComponent(url), { signal: AbortSignal.timeout(4000) })
      .then(r => r.ok ? r.text() : '')
      .then(html => {
        let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (m && m[1]) {
          let src = m[1];
          if (src.startsWith('//')) src = 'https:' + src;
          img.src = src;
        }
      })
      .catch(() => {})
      .finally(() => setTimeout(next, 100));
  }
  // Process 3 at a time
  next(); next(); next();
})();
</script>
</body></html>`;
}

