export function generateMediaReportHtml({
    client,
    narrative,
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

    // ── Smart client name (avoid "Government of Government of Odisha") ──────────
    const clientName = client.name || 'Client';

    // ── Colour helpers ────────────────────────────────────────────────────────
    const sevCol = s => {
        const sl = (s||'').toLowerCase();
        return sl==='critical'?'#dc2626':sl==='high'?'#d97706':sl==='moderate'?'#ca8a04':'#16a34a';
    };
    const sevBg = s => {
        const sl = (s||'').toLowerCase();
        return sl==='critical'?'#fef2f2':sl==='high'?'#fffbeb':sl==='moderate'?'#fefce8':'#f0fdf4';
    };
    const urgCol = u => {
        const ul = (u||'').toLowerCase();
        return ul==='immediate'||ul==='critical'?'#dc2626':ul==='high'?'#d97706':'#6b7280';
    };

    // ── Narrative section helpers ─────────────────────────────────────────────
    const narr = narrative || {};

    // Executive summary bullets
    const execBullets = narr.executive_summary
        ? narr.executive_summary.split(/\n\n+/).map(b=>b.replace(/^[•\-]\s*/,'').trim()).filter(Boolean).slice(0,6)
        : [];

    // Key developments array
    const keyDevs = Array.isArray(narr.key_developments) ? narr.key_developments.slice(0,8) : [];

    // Risk heatmap object
    const riskHM = (narr.risk_heatmap && typeof narr.risk_heatmap === 'object' && !Array.isArray(narr.risk_heatmap))
        ? narr.risk_heatmap : null;

    // Recommended actions array
    const recActions = Array.isArray(narr.recommended_actions) ? narr.recommended_actions.slice(0,8) : [];

    // Early warning signals
    const earlyWarnings = Array.isArray(narr.early_warning_signals) ? narr.early_warning_signals.slice(0,6) : [];

    // Geographic hotspots
    const geoHotspots = Array.isArray(narr.geographic_hotspots) ? narr.geographic_hotspots.slice(0,8) : [];

    // Stakeholder impact
    const stakeholders = (narr.stakeholder_impact && typeof narr.stakeholder_impact === 'object')
        ? narr.stakeholder_impact : null;

    const hasNarrative = narr && (execBullets.length>0 || keyDevs.length>0 || riskHM || recActions.length>0);

    // ── Article card ──────────────────────────────────────────────────────────
    function artCard(a) {
        const ss = sentStyle(a.sentiment);
        const fb = svgPh(a.source_name, a.mediaType);
        const img = a.image_url || fb;
        return `
      <div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid #f1f5f9;break-inside:avoid;">
        <img src="${img}" alt="" style="width:130px;height:85px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid #e2e8f0;" onerror="this.src='${fb}'">
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
          ${a.matched_keywords?.length?`<div style="margin-top:6px;">${a.matched_keywords.slice(0,5).map(k=>`<span style="background:#f0fdf4;color:#166534;padding:2px 8px;border-radius:4px;font-size:9px;margin-right:4px;">#${k}</span>`).join('')}</div>`:''}
        </div>
      </div>`;
    }

    // ── Media section builder ─────────────────────────────────────────────────
    function buildSec(title, icon, items, color) {
        const groups = grpByDate(items);
        if(!items.length) return '';
        let html = `
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid ${color};">
    <span style="font-size:28px;">${icon}</span>
    <h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;">${title}</h2>
    <span style="background:${color}20;color:${color};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;margin-left:auto;">${items.length} Stories</span>
  </div>`;
        for(const [date,dayItems] of groups) {
            html += `
  <div style="margin-bottom:28px;">
    <div style="background:linear-gradient(90deg,${color}15,transparent);padding:8px 16px;border-left:4px solid ${color};border-radius:0 6px 6px 0;margin-bottom:12px;">
      <span style="font-size:14px;font-weight:700;color:#0f172a;">📅 ${fmtD(date)}</span>
      <span style="color:#94a3b8;font-size:12px;margin-left:12px;">${dayItems.length} stories</span>
    </div>
    ${dayItems.map(a=>artCard(a)).join('')}
  </div>`;
        }
        return html + '</div>';
    }

    // ── Key Developments cards ────────────────────────────────────────────────
    const keyDevsHtml = keyDevs.length > 0
        ? keyDevs.map((d,i) => `
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:12px;background:${i%2===0?'#fff':'#f8fafc'};break-inside:avoid;">
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
              ${d.theme?`<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">${d.theme}</span>`:''}
              ${d.severity?`<span style="background:${sevBg(d.severity)};color:${sevCol(d.severity)};border:1px solid ${sevCol(d.severity)}44;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;text-transform:uppercase">${d.severity.toUpperCase()}</span>`:''}
              ${d.department?`<span style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:600">${d.department}</span>`:''}
            </div>
            <p style="font-size:15px;font-weight:700;color:#0f172a;margin:0 0 8px;line-height:1.3">${d.headline||'Development'}</p>
            ${d.what_happened?`<p style="font-size:13px;color:#334155;margin:0 0 6px;line-height:1.6"><strong>What happened:</strong> ${d.what_happened}</p>`:''}
            ${d.so_what?`<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:8px 12px;margin:8px 0 0;border-radius:0 6px 6px 0"><p style="font-size:12px;color:#92400e;margin:0;line-height:1.5"><strong>So what:</strong> ${d.so_what}</p></div>`:''}
            ${(d.locations||[]).length?`<p style="font-size:11px;color:#64748b;margin:8px 0 0">📍 ${(d.locations||[]).join(', ')}</p>`:''}
          </div>`).join('')
        : `<p style="color:#64748b;font-style:italic;">Key developments data not available for this period.</p>`;

    // ── Risk Heatmap bands ────────────────────────────────────────────────────
    const riskHeatmapHtml = riskHM
        ? ['critical','high','moderate','low'].map(level => {
            const items = (riskHM[level]||[]);
            if(!items.length) return '';
            return `
          <div style="background:${sevBg(level)};border:1px solid ${sevCol(level)}33;border-radius:8px;padding:12px 16px;margin-bottom:10px">
            <div style="font-size:10px;font-weight:800;color:${sevCol(level)};text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">${level.toUpperCase()} RISK</div>
            ${items.map(item=>`
            <div style="padding:6px 0;border-bottom:1px solid ${sevCol(level)}22">
              <p style="font-size:13px;font-weight:600;color:#0f172a;margin:0 0 3px">${item.issue||''}</p>
              ${item.why?`<p style="font-size:12px;color:#334155;margin:0 0 2px;line-height:1.5">${item.why}</p>`:''}
              ${item.so_what?`<p style="font-size:11px;color:${sevCol(level)};margin:0;font-style:italic">${item.so_what}</p>`:''}
            </div>`).join('')}
          </div>`;
          }).join('')
        : `<p style="color:#64748b;font-style:italic;">Risk data not available — run the analysis pipeline to generate.</p>`;

    // ── Recommended Actions ───────────────────────────────────────────────────
    const recActionsHtml = recActions.length > 0
        ? recActions.map(a => `
          <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:10px;background:#fff;break-inside:avoid;">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
              ${a.department?`<span style="font-size:10px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:3px;padding:2px 8px">${a.department}</span>`:''}
              ${a.urgency?`<span style="font-size:10px;font-weight:700;color:${urgCol(a.urgency)};background:${urgCol(a.urgency)}18;border:1px solid ${urgCol(a.urgency)}44;border-radius:3px;padding:2px 8px;text-transform:uppercase">${a.urgency}</span>`:''}
            </div>
            <p style="font-size:14px;font-weight:600;color:#0f172a;margin:0 0 4px">${a.action||''}</p>
            ${a.rationale?`<p style="font-size:12px;color:#64748b;margin:0;line-height:1.5">${a.rationale}</p>`:''}
          </div>`).join('')
        : `<p style="color:#64748b;font-style:italic;">No recommended actions generated — run the analysis pipeline.</p>`;

    // ── Geographic Hotspots ───────────────────────────────────────────────────
    const geoHtml = geoHotspots.length > 0
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
            ${geoHotspots.map(g=>`<span style="background:${sevBg(g.severity)};border:1px solid ${sevCol(g.severity)}44;border-radius:20px;padding:5px 14px;font-size:12px;color:${sevCol(g.severity)};font-weight:600">📍 ${g.location}${g.event_count?` (${g.event_count} events)`:''}</span>`).join('')}
           </div>
           ${geoHotspots.some(g=>g.key_issue)?`
           <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
             <thead><tr>
               <th style="background:#1e293b;color:#fff;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase">Location</th>
               <th style="background:#1e293b;color:#fff;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase">Key Issue</th>
               <th style="background:#1e293b;color:#fff;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase">Risk Level</th>
             </tr></thead>
             <tbody>${geoHotspots.filter(g=>g.key_issue).map((g,i)=>`
               <tr style="background:${i%2===0?'#fff':'#f8fafc'}">
                 <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600">${g.location}</td>
                 <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${g.key_issue}</td>
                 <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:${sevCol(g.severity)};font-weight:700;text-transform:uppercase">${g.severity||'–'}</td>
               </tr>`).join('')}</tbody>
           </table>`:''}`
        : `<p style="color:#64748b;font-style:italic;">No geographic hotspots identified.</p>`;

    // ── Stakeholder Impact ────────────────────────────────────────────────────
    const stakeholderHtml = stakeholders && Object.keys(stakeholders).length
        ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr>
              <th style="background:#1e293b;color:#fff;padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;width:30%">Stakeholder</th>
              <th style="background:#1e293b;color:#fff;padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase">Impact</th>
            </tr></thead>
            <tbody>${Object.entries(stakeholders).map(([k,v],i)=>`
              <tr style="background:${i%2===0?'#fff':'#f8fafc'}">
                <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a">${k}</td>
                <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#334155">${v}</td>
              </tr>`).join('')}</tbody>
           </table>`
        : `<p style="color:#64748b;font-style:italic;">Stakeholder impact data not available.</p>`;

    // ── Early Warning Signals ─────────────────────────────────────────────────
    const earlyWarningHtml = earlyWarnings.length > 0
        ? earlyWarnings.map(w=>`
          <div style="border-left:4px solid #d97706;padding:12px 16px;margin-bottom:12px;background:#fffbeb;border-radius:0 8px 8px 0;break-inside:avoid">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
              <span style="font-weight:700;font-size:13px;color:#92400e">⚠ ${w.signal||w.type||'Signal'}</span>
              ${w.confidence?`<span style="font-size:10px;color:#64748b;background:#f1f5f9;border-radius:3px;padding:1px 7px">Confidence: ${w.confidence}</span>`:''}
            </div>
            ${w.implication?`<p style="font-size:12px;color:#334155;margin:0 0 4px;line-height:1.5">${w.implication}</p>`:''}
            ${w.timeframe?`<p style="font-size:11px;color:#94a3b8;margin:0">Timeframe: ${w.timeframe}</p>`:''}
          </div>`).join('')
        : `<p style="color:#16a34a;font-weight:500;">✓ No active warning signals detected. Situation appears stable.</p>`;

    // ── CM sentiment percentages ──────────────────────────────────────────────
    const cmPosPct = Math.round(cmPos/Math.max(cmA.length,1)*100);
    const cmNegPct = Math.round(cmNeg/Math.max(cmA.length,1)*100);
    const cmNeuPct = Math.round(cmNeu/Math.max(cmA.length,1)*100);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ROBIN — ${clientName} Media Analysis Report — ${today}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
@page { margin:0; size:A4; }
* { box-sizing:border-box; }
body { font-family:'Inter', sans-serif; margin:0; padding:0; background:white; color:#0f172a; line-height:1.5; font-size:13px; }
.page-break { page-break-before: always; break-before: page; }
</style>
</head>
<body>

<!-- ═══ COVER PAGE ═══ -->
<div style="min-height:100vh;background:linear-gradient(135deg,#0a0c12 0%,#0f172a 40%,#1e293b 100%);display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;text-align:center;padding:60px 40px;">
  <div style="width:70px;height:70px;border-radius:16px;background:linear-gradient(135deg,#0d9488,#0f766e);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;box-shadow:0 20px 60px rgba(13,148,136,0.3);margin-bottom:30px;">R</div>
  <h1 style="font-size:42px;font-weight:800;letter-spacing:-1px;margin-bottom:8px;">${clientName} Media Analysis Report</h1>
  <p style="font-size:18px;color:rgba(255,255,255,0.5);margin-bottom:40px;">Daily Media Monitoring — ${clientName}</p>
  <div style="width:80px;height:3px;background:linear-gradient(90deg,#0d9488,#f59e0b);border-radius:2px;margin-bottom:40px;"></div>
  <h3 style="font-size:22px;font-weight:600;color:#0d9488;margin-bottom:8px;">${clientName}</h3>
  <p style="color:rgba(255,255,255,0.4);font-size:14px;">Media Monitoring & Situation Analysis</p>
  <p style="color:rgba(255,255,255,0.3);font-size:13px;margin-top:20px;">Report Date: ${today}</p>
  <p style="color:rgba(255,255,255,0.3);font-size:13px;">Classification: <strong style="color:#f59e0b;">CONFIDENTIAL — Client Only</strong></p>
  <div style="margin-top:50px;display:flex;gap:40px;">
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#0d9488;">${enriched.length}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Stories Monitored</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#22c55e;">${pos}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Positive</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#cbd5e1;">${neu}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Neutral</div></div>
    <div style="text-align:center;"><div style="font-size:36px;font-weight:800;color:#ef4444;">${neg}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">Negative</div></div>
  </div>
</div>

<!-- ═══ SECTION 1: STRATEGIC ANALYSIS BRIEFING (AI-Generated) ═══ -->
${hasNarrative ? `
<div class="page-break" style="padding:50px 60px;background:#f8fafc;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:30px;padding-bottom:16px;border-bottom:3px solid #0f766e;">
    <span style="font-size:32px;">📑</span>
    <div>
      <h2 style="font-size:28px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">Strategic Analysis Briefing</h2>
      <span style="font-size:11px;color:#0d9488;font-weight:600;text-transform:uppercase;letter-spacing:.08em">AI-Synthesised · ROBIN Analysis Engine</span>
    </div>
  </div>

  <!-- Executive Summary -->
  ${execBullets.length > 0 ? `
  <div style="background:white;border:1px solid #e2e8f0;border-left:4px solid #0d9488;border-radius:8px;padding:24px;margin-bottom:28px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 14px">Executive Summary</h3>
    <ul style="list-style:none;padding:0;margin:0">
      ${execBullets.map(b=>`
      <li style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;line-height:1.7">
        <span style="color:#0d9488;flex-shrink:0;margin-top:4px;font-weight:700">●</span>
        <span>${b}</span>
      </li>`).join('')}
    </ul>
  </div>` : ''}

  <!-- Key Developments -->
  ${keyDevs.length > 0 ? `
  <div style="margin-bottom:28px;">
    <h3 style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
      <span style="width:4px;height:16px;background:#0d9488;display:block;border-radius:2px;"></span>
      Top Priority Developments
    </h3>
    ${keyDevsHtml}
  </div>` : ''}
</div>` : ''}

<!-- ═══ SECTION 2: RISK ASSESSMENT ═══ -->
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:30px;padding-bottom:16px;border-bottom:3px solid #dc2626;">
    <span style="font-size:32px;">⚠️</span>
    <h2 style="font-size:28px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">Risk Assessment</h2>
  </div>

  <!-- Risk Heatmap from AI -->
  ${riskHM ? `
  <div style="margin-bottom:32px;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:14px">Risk Heatmap <span style="font-size:11px;color:#0d9488;font-weight:600;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:3px;padding:2px 7px;margin-left:6px">AI Synthesised</span></h3>
    ${riskHeatmapHtml}
  </div>` : ''}

  <!-- Early Warning Signals -->
  <div style="margin-bottom:32px;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:14px">Early Warning Signals</h3>
    ${earlyWarningHtml}
  </div>

  <!-- Geographic Hotspots -->
  ${geoHotspots.length > 0 ? `
  <div style="margin-bottom:32px;">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:14px">Geographic Hotspots</h3>
    ${geoHtml}
  </div>` : ''}
</div>

<!-- ═══ SECTION 3: RECOMMENDED ACTIONS ═══ -->
${recActions.length > 0 ? `
<div class="page-break" style="padding:50px 60px;background:#f8fafc;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:30px;padding-bottom:16px;border-bottom:3px solid #2563eb;">
    <span style="font-size:32px;">✅</span>
    <h2 style="font-size:28px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">Recommended Actions</h2>
  </div>
  ${recActionsHtml}
</div>` : ''}

<!-- ═══ SECTION 4: STAKEHOLDER IMPACT ═══ -->
${stakeholders && Object.keys(stakeholders).length > 0 ? `
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:30px;padding-bottom:16px;border-bottom:3px solid #7c3aed;">
    <span style="font-size:32px;">👥</span>
    <h2 style="font-size:28px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">Stakeholder Impact Analysis</h2>
  </div>
  ${stakeholderHtml}
</div>` : ''}

<!-- ═══ SECTION 5: MEDIA SIGNALS & ANALYTICS ═══ -->
<div class="page-break" style="padding:50px 60px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:30px;padding-bottom:16px;border-bottom:3px solid #0d9488;">
    <span style="font-size:32px;">🎯</span>
    <h2 style="font-size:28px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">Media Signals & Analytics</h2>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:40px;">
    <!-- Media Breakdown -->
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
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid #e2e8f0;">
          <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:24px;">📊</span><span style="font-size:15px;font-weight:600;color:#1e293b;">Total Monitored</span></div>
          <span style="font-size:20px;font-weight:800;color:#374151;">${enriched.length}</span>
        </div>
      </div>
    </div>

    <!-- Topic Sentiments -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.03);">
      <h3 style="font-size:14px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:20px;">Topic Sentiments</h3>
      ${issues.length > 0 ? issues.map(i=>`
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${i.name}</span>
            <span style="font-size:11px;color:#94a3b8;">${i.total} articles</span>
          </div>
          <div style="display:flex;height:20px;border-radius:5px;overflow:hidden;background:#f1f5f9;">
            ${Math.round(i.positive/Math.max(i.total,1)*100)>0?`<div style="width:${Math.round(i.positive/Math.max(i.total,1)*100)}%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${Math.round(i.positive/Math.max(i.total,1)*100)}%</div>`:''}
            ${Math.round((i.total-i.positive-i.negative)/Math.max(i.total,1)*100)>0?`<div style="width:${Math.round((i.total-i.positive-i.negative)/Math.max(i.total,1)*100)}%;background:#94a3b8;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${Math.round((i.total-i.positive-i.negative)/Math.max(i.total,1)*100)}%</div>`:''}
            ${Math.round(i.negative/Math.max(i.total,1)*100)>0?`<div style="width:${Math.round(i.negative/Math.max(i.total,1)*100)}%;background:#ef4444;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${Math.round(i.negative/Math.max(i.total,1)*100)}%</div>`:''}
          </div>
        </div>`).join('') : '<p style="color:#94a3b8;">No topic data available</p>'}
    </div>
  </div>

  <!-- Overall Sentiment Index -->
  <div style="background:linear-gradient(135deg,#0d9488,#0f766e);border-radius:16px;padding:30px;color:white;display:flex;align-items:center;gap:30px;margin-bottom:32px;">
    <div style="flex:1;">
      <h3 style="font-size:20px;font-weight:700;margin-bottom:12px;">Overall Sentiment Index</h3>
      <p style="font-size:14px;color:rgba(255,255,255,0.8);line-height:1.6;margin:0 0 16px;">Based on semantic analysis of ${enriched.length} captured stories for ${clientName}.</p>
      <div style="display:flex;height:16px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,0.2);">
        ${pos>0?`<div style="width:${Math.round(pos/Math.max(tot,1)*100)}%;background:#22c55e;"></div>`:''}
        ${neu>0?`<div style="width:${Math.round(neu/Math.max(tot,1)*100)}%;background:rgba(255,255,255,0.4);"></div>`:''}
        ${neg>0?`<div style="width:${Math.round(neg/Math.max(tot,1)*100)}%;background:#ef4444;"></div>`:''}
      </div>
      <div style="display:flex;gap:20px;margin-top:10px;font-size:12px;font-weight:600;">
        <span style="color:rgba(255,255,255,0.8);">✓ Positive: ${Math.round(pos/Math.max(tot,1)*100)}%</span>
        <span style="color:rgba(255,255,255,0.6);">● Neutral: ${Math.round(neu/Math.max(tot,1)*100)}%</span>
        <span style="color:rgba(255,255,255,0.8);">✗ Negative: ${Math.round(neg/Math.max(tot,1)*100)}%</span>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);padding:20px 30px;border-radius:12px;text-align:center;flex-shrink:0;">
      <div style="font-size:42px;font-weight:800;line-height:1;">${Math.round((pos/Math.max(pos+neg,1))*100)||50}%</div>
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-top:8px;color:rgba(255,255,255,0.8);">Positivity Score</div>
    </div>
  </div>
</div>

<!-- ═══ SECTION 6: CHIEF MINISTER PERCEPTION ═══ -->
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
      <div style="display:flex;height:40px;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        ${cmPosPct>0?`<div style="width:${cmPosPct}%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px;">${cmPosPct}%</div>`:''}
        ${cmNeuPct>0?`<div style="width:${cmNeuPct}%;background:#94a3b8;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px;">${cmNeuPct}%</div>`:''}
        ${cmNegPct>0?`<div style="width:${cmNegPct}%;background:#ef4444;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px;">${cmNegPct}%</div>`:''}
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
    Recent Coverage
  </h3>
  <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:0 24px;">
    ${cmA.slice(0,10).map(a=>`
    <div style="padding:16px 0;border-bottom:1px solid #f1f5f9;break-inside:avoid;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="background:${sentStyle(a.sentiment).bg};color:${sentStyle(a.sentiment).col};padding:3px 10px;border-radius:4px;font-size:10px;font-weight:800;">● ${sentStyle(a.sentiment).lbl}</span>
        <span style="font-size:12px;color:#64748b;font-weight:600;">${a.source_name}</span>
        <span style="color:#cbd5e1;">•</span>
        <span style="font-size:12px;color:#94a3b8;">${fmtT(a.published_at||a.created_at)}</span>
      </div>
      <a href="${a.url||'#'}" target="_blank" style="font-size:14px;font-weight:700;color:#0f172a;text-decoration:none;display:block;line-height:1.4">${a.title}</a>
    </div>`).join('')}
  </div>` : '<p style="color:#94a3b8;font-style:italic;">No articles directly mentioning the Chief Minister found in this period.</p>'}
</div>

<!-- ═══ SECTIONS 7-9: MEDIA COVERAGE BY TYPE ═══ -->
${buildSec('TV News Coverage','📺',tvA,'#7c3aed')}
${buildSec('Online News','🌐',onA,'#0d9488')}
${buildSec('Print Coverage','📰',npA,'#ea580c')}

<!-- ═══ BACK COVER ═══ -->
<div class="page-break" style="min-height:100vh;background:linear-gradient(135deg,#0a0c12,#0f172a,#1e293b);display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;text-align:center;padding:60px;">
  <div style="width:50px;height:50px;border-radius:12px;background:linear-gradient(135deg,#0d9488,#0f766e);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;margin-bottom:24px;">R</div>
  <h2 style="font-size:28px;font-weight:700;margin-bottom:8px;">ROBIN Media Monitor</h2>
  <p style="color:rgba(255,255,255,0.4);font-size:13px;margin-bottom:30px;">AI-Powered Media Monitoring & Situation Analysis</p>
  <div style="width:60px;height:2px;background:linear-gradient(90deg,#0d9488,#f59e0b);margin-bottom:30px;"></div>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;">This report was automatically generated by the ROBIN Monitor System.</p>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;">${enriched.length} stories monitored and analysed for ${clientName}.</p>
  <p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:30px;">© 2026 ROBIN. Confidential — ${clientName}. For authorised recipients only.</p>
</div>

</body></html>`;
}
