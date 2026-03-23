"use client";

import { useState, useEffect, useMemo } from "react";
import {
    TrendingUp, Minus,
    ChevronDown, ExternalLink, Clock, RefreshCw,
    Download, CheckCircle2, Eye, Zap, Activity, Users,
    Radio, ArrowUpRight, ArrowDownRight,
    ChevronUp, Loader2,
} from "lucide-react";
import { dailyIntelApi } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
    id: string;
    title: string;
    title_en?: string;
    url: string;
    published_at: string;
    source_name?: string;
    sentiment?: string;
    importance_score?: number;
    summary?: string;
    keywords?: string[];
    risk_indicators?: string[];
    entities?: { orgs?: string[]; people?: string[]; locations?: string[] };
}

interface KeywordItem {
    keyword: string;
    keyword_en?: string;
    category: string;
    priority: number;
    hits: number;
    paused?: boolean;
    sentiments?: { positive: number; negative: number; neutral: number };
    articles?: { id: string; title: string; title_en?: string; importance: number; sentiment: string; summary: string; timestamp: string }[];
}

interface Signal {
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    confidence: number;
    impact_score: number;
    recommended_actions?: { priority: string; action: string }[];
    related_entities?: string[];
    created_at: string;
}

interface EntityProfile {
    name: string;
    type: string;
    status?: string;
    change?: string;
    mentions?: number;
    risk_tags?: string[];
    sentiment?: { positive: number; negative: number; neutral: number; trend?: string };
    relevance_reason?: string;
}

interface ComputedSummary {
    executive_summary: string;
    key_developments: string;
    emerging_threats: string;
    watch_list: string;
}

// ─── Odisha Sectors ───────────────────────────────────────────────────────────

const ODISHA_SECTORS = [
    { key: "agriculture", label: "Agriculture & MSP", icon: "🌾", keywords: ["agriculture", "paddy", "farmer", "crop", "msp", "kharif", "rabi", "irrigation", "procurement", "harvest", "food", "grain", "rice", "vegetable", "horticulture", "fertilizer", "drought", "water supply"] },
    { key: "disaster", label: "Disaster Management", icon: "🌊", keywords: ["cyclone", "flood", "disaster", "odrf", "ndrf", "relief", "evacuation", "storm", "rainfall", "drought", "heat wave", "earthquake", "fire", "accident", "blast", "landslide", "rescue", "casualty", "dead", "death", "injured", "crisis", "emergency"] },
    { key: "mining", label: "Mining & Industry", icon: "⛏️", keywords: ["mine", "mining", "steel", "iron ore", "keonjhar", "coal", "mineral", "industry", "factory", "plant", "jharsuguda", "angul", "vedanta", "tata", "nalco", "hindalco", "power plant", "investment", "startup", "msme"] },
    { key: "health", label: "Health & Sanitation", icon: "🏥", keywords: ["health", "hospital", "doctor", "vaccine", "disease", "malaria", "dengue", "nutrition", "anemia", "sanitation", "covid", "outbreak", "patient", "medicine", "treatment", "nurse", "clinic", "ambulance", "epidemic", "preventive", "heatstroke", "ailment"] },
    { key: "laworder", label: "Law & Order", icon: "🚓", keywords: ["crime", "police", "naxal", "maoist", "arrest", "murder", "violence", "robbery", "encounter", "security", "protest", "agitation", "court", "legal", "judiciary", "mla", "mp", "bjd", "bjp", "congress", "political", "assembly", "disqualification", "suspended", "election", "ban", "raid", "drug", "gang", "scam", "corruption", "bribery"] },
    { key: "infrastructure", label: "Infrastructure & Roads", icon: "🏗️", keywords: ["road", "bridge", "highway", "construction", "railway", "airport", "smart city", "infrastructure", "project", "tender", "bhubaneswar", "cuttack", "puri", "berhampur", "odisha cm", "chief minister", "water", "electricity", "power", "gas", "lpg", "shortage", "supply", "connectivity"] },
    { key: "education", label: "Education & Employment", icon: "📚", keywords: ["school", "education", "student", "employment", "job", "training", "university", "skill", "scholarship", "recruitment", "exam", "teacher", "college", "board", "result", "youth", "graduate"] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().split("T")[0]; }

function fmtDate(d: string) {
    return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
}

function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function fmtTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function severityFromScore(score?: number): "critical" | "high" | "elevated" | "routine" {
    if (!score) return "routine";
    if (score >= 9) return "critical";
    if (score >= 7) return "high";
    if (score >= 5) return "elevated";
    return "routine";
}

const SEV = {
    critical: { border: "border-l-red-500", bg: "bg-red-500/8", pill: "bg-red-500/20 text-red-300", dot: "bg-red-500", label: "CRITICAL", text: "text-red-400" },
    high:     { border: "border-l-amber-500", bg: "bg-amber-500/8", pill: "bg-amber-500/20 text-amber-300", dot: "bg-amber-500", label: "HIGH", text: "text-amber-400" },
    elevated: { border: "border-l-yellow-500", bg: "bg-yellow-500/8", pill: "bg-yellow-500/20 text-yellow-300", dot: "bg-yellow-500", label: "ELEVATED", text: "text-yellow-400" },
    routine:  { border: "border-l-slate-600", bg: "", pill: "bg-slate-700/60 text-slate-400", dot: "bg-slate-600", label: "ROUTINE", text: "text-slate-400" },
};

function sentimentColor(s?: string) {
    const u = (s || "").toUpperCase();
    if (u === "POSITIVE") return "text-emerald-400";
    if (u === "NEGATIVE") return "text-red-400";
    return "text-slate-400";
}

function riskLevelStyle(level?: string) {
    const l = (level || "").toUpperCase();
    if (l === "CRITICAL") return { text: "text-red-400", bg: "bg-red-500/15 border-red-500/30", dot: "bg-red-500", label: "CRITICAL" };
    if (l === "HIGH")     return { text: "text-amber-400", bg: "bg-amber-500/15 border-amber-500/30", dot: "bg-amber-500", label: "HIGH" };
    if (l === "ELEVATED") return { text: "text-yellow-400", bg: "bg-yellow-500/15 border-yellow-500/30", dot: "bg-yellow-400", label: "ELEVATED" };
    return { text: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", dot: "bg-emerald-500", label: "ROUTINE" };
}

function matchesSector(article: Article, sector: typeof ODISHA_SECTORS[0]) {
    const text = [
        article.title,
        article.title_en,
        article.summary,
        ...(article.keywords || []),
    ].filter(Boolean).join(" ").toLowerCase();
    return sector.keywords.some(kw => text.includes(kw));
}

function assignSectors(articles: Article[]): Record<string, Article[]> {
    const map: Record<string, Article[]> = {};
    for (const s of ODISHA_SECTORS) map[s.key] = [];
    for (const a of articles) {
        let matched = false;
        for (const s of ODISHA_SECTORS) {
            if (matchesSector(a, s)) {
                map[s.key].push(a);
                matched = true;
            }
        }
        // If no sector matched, put under infrastructure as a catch-all
        if (!matched) map["infrastructure"].push(a);
    }
    return map;
}

// ─── Auto-generate summary from articles ─────────────────────────────────────

function buildSummaryFromArticles(articles: Article[], sectorMap: Record<string, Article[]>, date: string): ComputedSummary {
    const sorted = [...articles].sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
    const top5 = sorted.slice(0, 5);
    const negHigh = sorted.filter(a => a.sentiment?.toUpperCase() === "NEGATIVE" && (a.importance_score || 0) >= 6);
    const dateLabel = fmtDate(date);

    // Executive Summary
    const execLines = top5
        .filter(a => a.summary)
        .map((a, i) => `${i + 1}. ${a.title_en || a.title}: ${(a.summary || "").slice(0, 160).trim()}${(a.summary || "").length > 160 ? "..." : ""}`);
    const executive_summary = execLines.length > 0
        ? `Situation summary for ${dateLabel}. ${articles.length} articles monitored across ${Object.values(sectorMap).filter(v => v.length > 0).length} active governance domains.\n\n${execLines.join("\n\n")}`
        : `${articles.length} articles collected for ${dateLabel}. No high-importance developments detected.`;

    // Key Developments — one line per active sector
    const devLines: string[] = [];
    for (const s of ODISHA_SECTORS) {
        const arts = sectorMap[s.key];
        if (arts.length === 0) continue;
        const topArt = [...arts].sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))[0];
        devLines.push(`${s.icon} ${s.label} (${arts.length} articles): ${topArt.title}`);
    }
    const key_developments = devLines.length > 0
        ? devLines.join("\n")
        : "No sector-specific developments identified for this date.";

    // Emerging Threats
    const threatLines = negHigh
        .slice(0, 5)
        .map(a => `• ${a.title}${a.summary ? ` — ${a.summary.slice(0, 120)}...` : ""}`);
    const emerging_threats = threatLines.length > 0
        ? `${negHigh.length} high-importance negative developments detected:\n\n${threatLines.join("\n\n")}`
        : "No significant emerging threats identified. Situation appears stable across monitored domains.";

    // Watch List — top entities from articles
    const entityCount: Record<string, number> = {};
    for (const a of articles) {
        const all = [
            ...(a.entities?.people || []),
            ...(a.entities?.orgs || []),
            ...(a.entities?.locations || []),
        ];
        for (const e of all) {
            entityCount[e] = (entityCount[e] || 0) + 1;
        }
    }
    const topEntities = Object.entries(entityCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => `• ${name} (${count} mention${count > 1 ? "s" : ""})`);
    const watch_list = topEntities.length > 0
        ? `Key entities appearing in today's coverage:\n\n${topEntities.join("\n")}`
        : "No prominent entities identified in today's articles.";

    return { executive_summary, key_developments, emerging_threats, watch_list };
}

// ─── PDF Report Builder ───────────────────────────────────────────────────────

function buildReportHTML(
    date: string,
    articles: Article[],
    sectorMap: Record<string, Article[]>,
    summary: ComputedSummary,
    keywords: KeywordItem[],
    signals: Signal[],
    sentiment: { positive_pct: number; negative_pct: number; neutral_pct: number; total: number } | null,
    riskLevel: string,
): string {
    const dateLabel = fmtDate(date);
    const criticalArts = articles.filter(a => (a.importance_score || 0) >= 9);
    const highArts = articles.filter(a => (a.importance_score || 0) >= 7 && (a.importance_score || 0) < 9);
    const critWarnings = signals.filter(s => s.severity === "critical" || s.severity === "high").slice(0, 5);
    const riskColor = riskLevel === "CRITICAL" ? "#ef4444" : riskLevel === "HIGH" ? "#f59e0b" : riskLevel === "ELEVATED" ? "#eab308" : "#10b981";

    const sectorRows = ODISHA_SECTORS.map(s => {
        const arts = sectorMap[s.key] || [];
        if (arts.length === 0) return "";
        const top = [...arts].sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))[0];
        const negPct = arts.length ? Math.round((arts.filter(a => a.sentiment?.toUpperCase() === "NEGATIVE").length / arts.length) * 100) : 0;
        return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${s.icon} ${s.label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${arts.length}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${negPct > 50 ? "#dc2626" : negPct > 25 ? "#d97706" : "#16a34a"}">${negPct > 50 ? "Adverse" : negPct > 25 ? "Mixed" : "Favourable"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">${top.title.slice(0, 80)}${top.title.length > 80 ? "..." : ""}</td>
        </tr>`;
    }).filter(Boolean).join("");

    const critRows = [...criticalArts, ...highArts].slice(0, 10).map((a, i) => `
        <tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}">
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:${(a.importance_score || 0) >= 9 ? "#dc2626" : "#d97706"}">${(a.importance_score || 0) >= 9 ? "CRITICAL" : "HIGH"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${a.title}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${a.importance_score}/10</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${a.sentiment?.toUpperCase() === "NEGATIVE" ? "#dc2626" : a.sentiment?.toUpperCase() === "POSITIVE" ? "#16a34a" : "#6b7280"}">${a.sentiment || "–"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280">${a.source_name || "–"}</td>
        </tr>`).join("");

    const signalRows = critWarnings.map(s => `
        <div style="border-left:4px solid ${s.severity === "critical" ? "#dc2626" : "#d97706"};padding:10px 14px;margin-bottom:10px;background:${s.severity === "critical" ? "#fef2f2" : "#fffbeb"}">
          <div style="font-weight:700;font-size:13px;color:${s.severity === "critical" ? "#dc2626" : "#d97706"};margin-bottom:4px">${s.title}</div>
          <div style="font-size:12px;color:#374151;margin-bottom:4px">${s.description}</div>
          <div style="font-size:11px;color:#9ca3af">Confidence: ${s.confidence}% | Impact: ${s.impact_score}/10</div>
        </div>`).join("");

    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Daily Situation Report — ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; }
  @media print { body { margin: 0; } @page { margin: 15mm 15mm 15mm 15mm; size: A4; } }
  .page { max-width: 900px; margin: 0 auto; padding: 30px; }
  h1 { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  h2 { font-size: 15px; font-weight: 700; color: #1f2937; border-bottom: 2px solid #1f2937; padding-bottom: 6px; margin: 28px 0 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  h3 { font-size: 13px; font-weight: 700; color: #374151; margin: 14px 0 6px; }
  p { line-height: 1.7; color: #374151; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #1f2937; color: #fff; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 700; }
  .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 14px 0; }
  .metric { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
  .metric .value { font-size: 28px; font-weight: 800; }
  .metric .label { font-size: 11px; color: #6b7280; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; margin-bottom: 14px; }
  .summary-block .label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin-bottom: 8px; }
  .summary-block .content { font-size: 13px; color: #374151; line-height: 1.8; white-space: pre-wrap; }
  .sentiment-bar { height: 10px; border-radius: 5px; overflow: hidden; display: flex; margin: 8px 0 4px; }
  .header-band { background: #111827; color: #fff; padding: 20px 30px; margin: -30px -30px 24px; }
  .header-band .subtitle { color: #9ca3af; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
  .header-band h1 { color: #fff; }
  .header-band .meta { color: #d1d5db; font-size: 12px; margin-top: 6px; }
  .risk-badge { display: inline-block; padding: 3px 12px; border-radius: 4px; font-size: 13px; font-weight: 700; margin-top: 8px; background: ${riskColor}22; color: ${riskColor}; border: 1px solid ${riskColor}44; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
<div class="page">

<!-- HEADER -->
<div class="header-band">
  <div class="subtitle">Government of Odisha · Information Wing · For Official Use Only</div>
  <h1>Daily Situation Report</h1>
  <div class="meta">${dateLabel} · Generated by ROBIN Monitor System · ${now} IST</div>
  <div class="risk-badge">● ${riskLevel} RISK</div>
</div>

<!-- KEY METRICS -->
<div class="metric-grid">
  <div class="metric"><div class="value" style="color:#dc2626">${criticalArts.length}</div><div class="label">Critical</div></div>
  <div class="metric"><div class="value" style="color:#d97706">${highArts.length}</div><div class="label">High Priority</div></div>
  <div class="metric"><div class="value" style="color:#111827">${articles.length}</div><div class="label">Total Articles</div></div>
  <div class="metric"><div class="value" style="color:#16a34a">${keywords.filter(k => !k.paused).length}</div><div class="label">Active Topics</div></div>
</div>

<!-- SITUATION SUMMARY -->
<h2>1. Situation Summary</h2>

<div class="summary-block">
  <div class="label">Executive Summary</div>
  <div class="content">${summary.executive_summary}</div>
</div>

<div class="summary-block">
  <div class="label">Key Developments by Sector</div>
  <div class="content">${summary.key_developments}</div>
</div>

<div class="summary-block">
  <div class="label">Emerging Threats</div>
  <div class="content">${summary.emerging_threats}</div>
</div>

<div class="summary-block">
  <div class="label">Watch List</div>
  <div class="content">${summary.watch_list}</div>
</div>

<!-- SENTIMENT ANALYSIS -->
<h2>2. Media Sentiment Analysis</h2>
${sentiment ? `
<div class="metric-grid">
  <div class="metric"><div class="value" style="color:#16a34a">${sentiment.positive_pct}%</div><div class="label">Positive</div></div>
  <div class="metric"><div class="value" style="color:#6b7280">${sentiment.neutral_pct}%</div><div class="label">Neutral</div></div>
  <div class="metric"><div class="value" style="color:#dc2626">${sentiment.negative_pct}%</div><div class="label">Negative</div></div>
  <div class="metric"><div class="value">${sentiment.total}</div><div class="label">Total Analysed</div></div>
</div>
<div class="sentiment-bar">
  <div style="width:${sentiment.positive_pct}%;background:#16a34a"></div>
  <div style="width:${sentiment.neutral_pct}%;background:#d1d5db"></div>
  <div style="width:${sentiment.negative_pct}%;background:#dc2626"></div>
</div>
<p style="font-size:11px;color:#9ca3af">Green = Positive · Grey = Neutral · Red = Negative</p>
` : "<p>Sentiment data not available.</p>"}

<!-- SECTOR PULSE -->
<h2>3. Sector-wise Coverage</h2>
${sectorRows ? `
<table>
  <thead><tr><th>Sector</th><th>Articles</th><th>Tone</th><th>Top Development</th></tr></thead>
  <tbody>${sectorRows}</tbody>
</table>` : "<p>No sector data available.</p>"}

<!-- CRITICAL ALERTS -->
<h2 class="page-break">4. Critical & High Priority Articles</h2>
${critRows ? `
<table>
  <thead><tr><th>Level</th><th>Headline</th><th>Score</th><th>Sentiment</th><th>Source</th></tr></thead>
  <tbody>${critRows}</tbody>
</table>` : "<p>No critical or high-priority articles detected for this date.</p>"}

<!-- EARLY WARNINGS -->
<h2>5. Early Warning Signals</h2>
${signalRows || "<p style='color:#16a34a'>✓ No active warning signals. Situation stable.</p>"}

<!-- WATCH TOPICS -->
<h2>6. Active Watch Topics</h2>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
${keywords.filter(k => !k.paused).map(k =>
    `<span style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;padding:4px 10px;font-size:12px">
      <strong>${k.keyword_en || k.keyword}</strong> <span style="color:#9ca3af">${k.category}</span>${k.hits ? ` · ${k.hits} hits` : ""}
    </span>`
).join("")}
</div>

<!-- ARTICLE APPENDIX -->
<h2 class="page-break">7. Full Article List (Top 30 by Importance)</h2>
<table>
  <thead><tr><th>#</th><th>Headline</th><th>Source</th><th>Score</th><th>Sentiment</th><th>Time</th></tr></thead>
  <tbody>
    ${[...articles]
        .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
        .slice(0, 30)
        .map((a, i) => `<tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}">
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#9ca3af;font-size:11px">${i + 1}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:12px">${a.title}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280">${a.source_name || "–"}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${(a.importance_score || 0) >= 9 ? "#dc2626" : (a.importance_score || 0) >= 7 ? "#d97706" : "#374151"}">${a.importance_score || "–"}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:${a.sentiment?.toUpperCase() === "NEGATIVE" ? "#dc2626" : a.sentiment?.toUpperCase() === "POSITIVE" ? "#16a34a" : "#6b7280"};font-size:11px">${a.sentiment || "–"}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#9ca3af">${a.published_at ? fmtTime(a.published_at) : "–"}</td>
        </tr>`).join("")}
  </tbody>
</table>

<!-- FOOTER -->
<div class="footer">
  <span>ROBIN Monitor System · Government of Odisha · FOR OFFICIAL USE ONLY</span>
  <span>Generated: ${now} IST</span>
</div>

</div>
</body>
</html>`;
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children, defaultOpen = true, badge }: {
    title: string; icon: React.ReactNode; children: React.ReactNode;
    defaultOpen?: boolean; badge?: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl overflow-hidden">
            <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/40 transition-colors">
                <div className="flex items-center gap-2.5">
                    <span className="text-slate-400">{icon}</span>
                    <span className="text-sm font-semibold text-slate-200 tracking-wide uppercase">{title}</span>
                    {badge}
                </div>
                {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
            </button>
            {open && <div className="border-t border-slate-700/40">{children}</div>}
        </div>
    );
}

// ─── Top News (Hot Articles) ──────────────────────────────────────────────────

function TopNewsSection({ articles, reviewedIds, onReview, kwMap }: {
    articles: Article[]; reviewedIds: Set<string>; onReview: (id: string) => void; kwMap: Record<string, string>;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    // Only show web articles (no YouTube/video), top 10 by importance score
    const webArticles = articles.filter(a => {
        const t = (a.title || "").toLowerCase();
        return !t.startsWith("[video]") && !t.startsWith("video:");
    });
    const top10 = [...webArticles].sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0)).slice(0, 10);

    if (top10.length === 0) {
        return (
            <div className="px-5 py-8 text-center">
                <CheckCircle2 size={18} className="text-emerald-400 mx-auto mb-2" />
                <div className="text-sm text-slate-400">No articles collected for this date yet.</div>
                <div className="text-xs text-slate-600 mt-1">Articles will appear once scraping runs for the selected date.</div>
            </div>
        );
    }

    return (
        <div className="divide-y divide-slate-700/30">
            {top10.map((article, idx) => {
                const sev = severityFromScore(article.importance_score);
                const s = SEV[sev];
                const isExp = expanded === article.id;
                const reviewed = reviewedIds.has(article.id);
                const isHot = idx < 3; // Top 3 are "HOT"

                return (
                    <div key={article.id} className={cn("border-l-4 transition-colors", s.border, isExp ? "bg-slate-800/50" : "hover:bg-slate-800/20", reviewed && "opacity-55")}>
                        <div className="px-5 py-4">
                            <div className="flex items-start gap-3">
                                {/* Rank Badge */}
                                <div className={cn("flex-shrink-0 w-8 h-8 rounded-lg flex flex-col items-center justify-center",
                                    idx === 0 ? "bg-amber-500/20 border border-amber-500/40" :
                                    idx === 1 ? "bg-slate-400/10 border border-slate-500/30" :
                                    idx === 2 ? "bg-orange-500/10 border border-orange-500/20" :
                                    "bg-slate-800 border border-slate-700"
                                )}>
                                    <span className={cn("text-xs font-bold font-mono",
                                        idx === 0 ? "text-amber-400" : idx === 1 ? "text-slate-300" : idx === 2 ? "text-orange-400" : "text-slate-500"
                                    )}>#{idx + 1}</span>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-3 mb-1.5">
                                        <h3 className={cn("text-sm font-medium leading-snug", reviewed ? "text-slate-500 line-through" : "text-slate-100")}>
                                            {isHot && <span className="inline-flex items-center mr-1.5 text-2xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1 py-0 rounded">🔥 HOT</span>}
                                            {article.title_en || article.title}
                                        </h3>
                                        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                                            <span className={cn("text-2xs font-mono px-1.5 py-0.5 rounded", s.pill)}>{s.label}</span>
                                            <span className="text-2xs font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
                                                {article.importance_score ?? "–"}/10
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 text-2xs text-slate-500 mb-2">
                                        {article.source_name && <span className="bg-slate-800 border border-slate-700/50 px-1.5 py-0.5 rounded text-slate-400">{article.source_name}</span>}
                                        {article.published_at && <span className="flex items-center gap-1"><Clock size={10} />{fmtTime(article.published_at)} · {timeAgo(article.published_at)}</span>}
                                        {article.sentiment && <span className={cn("font-semibold", sentimentColor(article.sentiment))}>{article.sentiment.toUpperCase()}</span>}
                                    </div>

                                    <p className={cn("text-xs leading-relaxed mb-2.5", isExp ? "" : "line-clamp-2", article.summary ? "text-slate-400" : "text-slate-600 italic")}>
                                        {article.summary || "Analysis pending — summary will appear once AI processing completes."}
                                    </p>

                                    {article.keywords && article.keywords.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-2.5">
                                            {article.keywords.slice(0, 6).map(kw => (
                                                <span key={kw} className="text-2xs bg-teal-500/8 text-teal-400 border border-teal-500/20 px-1.5 py-0.5 rounded">{kwMap[kw] || kw}</span>
                                            ))}
                                        </div>
                                    )}

                                    {isExp && article.entities && (
                                        <div className="mt-3 grid grid-cols-3 gap-3 text-2xs border-t border-slate-700/40 pt-3">
                                            {(["people", "orgs", "locations"] as const).map(type => {
                                                const items = (article.entities as Record<string, string[]>)[type] || [];
                                                if (items.length === 0) return null;
                                                const labels: Record<string, string> = { people: "People", orgs: "Organisations", locations: "Locations" };
                                                return (
                                                    <div key={type}>
                                                        <div className="text-slate-500 uppercase tracking-wider mb-1">{labels[type]}</div>
                                                        {items.slice(0, 4).map(p => <div key={p} className="text-slate-300 mb-0.5">{p}</div>)}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {isExp && article.risk_indicators && article.risk_indicators.length > 0 && (
                                        <div className="mt-2">
                                            <div className="text-2xs text-slate-500 uppercase tracking-wider mb-1">Risk Indicators</div>
                                            <div className="flex flex-wrap gap-1">
                                                {article.risk_indicators.map(r => (
                                                    <span key={r} className="text-2xs bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">⚠ {r}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-3 mt-2.5">
                                        <button onClick={() => setExpanded(isExp ? null : article.id)} className="text-2xs text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors">
                                            {isExp ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                            {isExp ? "Collapse" : "Full Details"}
                                        </button>
                                        <a href={article.url} target="_blank" rel="noreferrer" className="text-2xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors">
                                            <ExternalLink size={10} /> Read Source
                                        </a>
                                        <button onClick={() => onReview(article.id)} className={cn("text-2xs flex items-center gap-1 transition-colors ml-auto", reviewed ? "text-emerald-500" : "text-slate-500 hover:text-emerald-400")}>
                                            <CheckCircle2 size={11} />
                                            {reviewed ? "✓ Reviewed" : "Mark Reviewed"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Sector Pulse ─────────────────────────────────────────────────────────────

function SectorPulseSection({ sectorMap }: { sectorMap: Record<string, Article[]> }) {
    // Allow multiple sectors expanded at once
    const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

    const toggle = (key: string) => setExpandedSet(prev => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });

    return (
        <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {ODISHA_SECTORS.map(sector => {
                    const arts = sectorMap[sector.key] || [];
                    const negCount = arts.filter(a => a.sentiment?.toUpperCase() === "NEGATIVE").length;
                    const posCount = arts.filter(a => a.sentiment?.toUpperCase() === "POSITIVE").length;
                    const dominant = negCount > posCount ? "negative" : posCount > negCount ? "positive" : "neutral";
                    const isExp = expandedSet.has(sector.key);

                    let cardStyle = "bg-slate-800/60 border-slate-700/40";
                    let countColor = "text-slate-500";
                    if (arts.length > 3 && dominant === "negative") { cardStyle = "bg-red-500/8 border-red-500/20"; countColor = "text-red-400"; }
                    else if (arts.length > 3) { cardStyle = "bg-amber-500/8 border-amber-500/20"; countColor = "text-amber-400"; }
                    else if (arts.length > 0) { countColor = "text-teal-400"; }

                    return (
                        <div key={sector.key} className={cn("border rounded-lg overflow-hidden transition-all", cardStyle)}>
                            <button
                                onClick={() => arts.length > 0 && toggle(sector.key)}
                                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-700/20 transition-colors"
                            >
                                <span className="text-xl">{sector.icon}</span>
                                <div className="flex-1 text-left">
                                    <div className="text-xs font-semibold text-slate-200">{sector.label}</div>
                                    <div className={cn("text-xs font-mono font-bold mt-0.5", countColor)}>
                                        {arts.length} article{arts.length !== 1 ? "s" : ""}
                                        {arts.length > 0 && <span className={cn("ml-1.5 text-2xs font-normal", sentimentColor(dominant))}>{dominant}</span>}
                                    </div>
                                </div>
                                {arts.length > 0 && (isExp ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />)}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Expanded sector articles — shown below the grid, full width */}
            {ODISHA_SECTORS.filter(s => expandedSet.has(s.key)).map(sector => {
                const arts = [...(sectorMap[sector.key] || [])].sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
                if (arts.length === 0) return null;
                return (
                    <div key={`expanded-${sector.key}`} className="border border-slate-700/50 rounded-lg overflow-hidden bg-slate-900/50">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/40 bg-slate-800/50">
                            <div className="flex items-center gap-2">
                                <span className="text-base">{sector.icon}</span>
                                <span className="text-sm font-semibold text-slate-200">{sector.label}</span>
                                <span className="text-2xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">{arts.length} articles</span>
                            </div>
                            <button onClick={() => toggle(sector.key)} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
                                <ChevronUp size={14} />
                            </button>
                        </div>
                        <div className="divide-y divide-slate-700/20">
                            {arts.map(a => (
                                <a key={a.id} href={a.url} target="_blank" rel="noreferrer"
                                    className="flex items-start gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors group">
                                    <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",
                                        (a.importance_score || 0) >= 8 ? "bg-red-400" :
                                        (a.importance_score || 0) >= 6 ? "bg-amber-400" : "bg-slate-600"
                                    )} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-slate-200 leading-snug group-hover:text-teal-300 transition-colors line-clamp-2">{a.title_en || a.title}</p>
                                        {a.summary && <p className="text-2xs text-slate-500 mt-1 line-clamp-1">{a.summary}</p>}
                                        <div className="flex items-center gap-2 mt-1.5 text-2xs">
                                            {a.source_name && <span className="bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{a.source_name}</span>}
                                            <span className={sentimentColor(a.sentiment)}>{a.sentiment}</span>
                                            {a.importance_score && <span className="text-slate-500">· {a.importance_score}/10</span>}
                                            {a.published_at && <span className="text-slate-600">· {fmtTime(a.published_at)}</span>}
                                            <ExternalLink size={9} className="text-slate-600 group-hover:text-teal-400 ml-auto" />
                                        </div>
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Early Warning Signals ────────────────────────────────────────────────────

function EarlyWarningSection({ signals }: { signals: Signal[] }) {
    const warnings = signals.filter(s => s.severity === "critical" || s.severity === "high" || s.impact_score >= 7).slice(0, 6);
    if (warnings.length === 0) {
        return (
            <div className="px-5 py-5 flex items-center gap-3 text-sm text-emerald-400">
                <CheckCircle2 size={16} />
                No early warning signals detected. Situation stable.
            </div>
        );
    }
    return (
        <div className="divide-y divide-slate-700/30">
            {warnings.map(signal => {
                const sev = signal.severity as keyof typeof SEV;
                const s = SEV[sev] || SEV.routine;
                return (
                    <div key={signal.id} className={cn("px-5 py-4 border-l-4", s.border, "hover:bg-slate-800/20 transition-colors")}>
                        <div className="flex items-start gap-3">
                            <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0 animate-pulse", s.dot)} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-sm font-medium text-slate-200">{signal.title}</span>
                                    <div className="flex gap-1.5 flex-shrink-0">
                                        <span className={cn("text-2xs px-1.5 py-0.5 rounded font-mono", s.pill)}>{s.label}</span>
                                        <span className="text-2xs text-slate-500">Conf: {signal.confidence}%</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed mb-2">{signal.description}</p>
                                {signal.recommended_actions && signal.recommended_actions.length > 0 && (
                                    <div className="space-y-1">
                                        {signal.recommended_actions.slice(0, 2).map((action, i) => (
                                            <div key={i} className="flex items-start gap-1.5">
                                                <span className={cn("text-2xs mt-0.5 flex-shrink-0", action.priority === "immediate" ? "text-red-400" : "text-amber-400")}>→</span>
                                                <span className="text-2xs text-slate-400">{action.action}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Watch Topics ─────────────────────────────────────────────────────────────

function WatchTopicsSection({ keywords, selectedTopics, onToggle }: {
    keywords: KeywordItem[]; selectedTopics: Set<string>; onToggle: (kw: string) => void;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const active = keywords.filter(k => !k.paused);
    if (active.length === 0) return <div className="px-5 py-6 text-sm text-slate-500 text-center">No active watch topics configured.</div>;
    return (
        <div className="divide-y divide-slate-700/30">
            {active.map(kw => {
                const selected = selectedTopics.has(kw.keyword);
                const isExp = expanded === kw.keyword;
                return (
                    <div key={kw.keyword} className={cn("transition-colors", selected ? "bg-teal-500/5" : "")}>
                        <div className="px-5 py-3 flex items-center gap-3">
                            <button onClick={() => onToggle(kw.keyword)} className={cn("w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors", selected ? "bg-teal-500 border-teal-500" : "border-slate-600 hover:border-teal-500/50")}>
                                {selected && <CheckCircle2 size={9} className="text-slate-950" />}
                            </button>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-slate-200 font-medium">{kw.keyword_en || kw.keyword}</span>
                                    <span className="text-2xs bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">{kw.category}</span>
                                    {kw.hits > 0 && <span className="text-2xs bg-teal-500/15 text-teal-400 px-1.5 py-0.5 rounded font-mono">{kw.hits} hits</span>}
                                </div>
                                {kw.sentiments && (
                                    <div className="flex gap-3 mt-0.5 text-2xs">
                                        <span className="text-emerald-500">{kw.sentiments.positive}+</span>
                                        <span className="text-red-400">{kw.sentiments.negative}-</span>
                                        <span className="text-slate-500">{kw.sentiments.neutral}~</span>
                                    </div>
                                )}
                            </div>
                            {(kw.articles || []).length > 0 && (
                                <button onClick={() => setExpanded(isExp ? null : kw.keyword)} className="text-slate-500 hover:text-slate-300 transition-colors">
                                    {isExp ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                            )}
                        </div>
                        {isExp && (kw.articles || []).length > 0 && (
                            <div className="border-t border-slate-700/30 divide-y divide-slate-700/20 bg-slate-900/40">
                                {(kw.articles || []).slice(0, 3).map(a => (
                                    <div key={a.id} className="px-5 py-2.5">
                                        <p className="text-xs text-slate-300 line-clamp-2">{a.title_en || a.title}</p>
                                        <div className="flex gap-2 mt-1 text-2xs text-slate-500">
                                            <span className={sentimentColor(a.sentiment)}>{a.sentiment}</span>
                                            <span>· {a.importance}/10</span>
                                            <span>· {timeAgo(a.timestamp)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Entity Analysis Network ──────────────────────────────────────────────

interface EntityNode {
    name: string;
    type: string;
    mentions: number;
    articles: Article[];
    coOccursWith: { name: string; type: string; count: number }[];
    sentiment: { positive: number; negative: number; neutral: number };
}

function buildEntityNetwork(articles: Article[]): EntityNode[] {
    const entityMap: Record<string, EntityNode> = {};

    const getOrCreate = (name: string, type: string): EntityNode => {
        if (!entityMap[name]) {
            entityMap[name] = { name, type, mentions: 0, articles: [], coOccursWith: [], sentiment: { positive: 0, negative: 0, neutral: 0 } };
        }
        return entityMap[name];
    };

    for (const article of articles) {
        if (!article.entities) continue;
        const allInArticle: { name: string; type: string }[] = [
            ...(article.entities.people || []).map(n => ({ name: n, type: "person" })),
            ...(article.entities.orgs || []).map(n => ({ name: n, type: "org" })),
            ...(article.entities.locations || []).map(n => ({ name: n, type: "location" })),
        ];

        for (const e of allInArticle) {
            const node = getOrCreate(e.name, e.type);
            node.mentions++;
            if (!node.articles.find(a => a.id === article.id)) node.articles.push(article);

            // Track sentiment
            const s = article.sentiment?.toUpperCase();
            if (s === "POSITIVE") node.sentiment.positive++;
            else if (s === "NEGATIVE") node.sentiment.negative++;
            else node.sentiment.neutral++;

            // Co-occurrence: link with every OTHER entity in this same article
            for (const other of allInArticle) {
                if (other.name === e.name) continue;
                const existing = node.coOccursWith.find(c => c.name === other.name);
                if (existing) existing.count++;
                else node.coOccursWith.push({ name: other.name, type: other.type, count: 1 });
            }
        }
    }

    // Sort co-occurrences by count
    for (const node of Object.values(entityMap)) {
        node.coOccursWith.sort((a, b) => b.count - a.count);
    }

    return Object.values(entityMap).sort((a, b) => b.mentions - a.mentions).slice(0, 15);
}

function EntityIntelSection({ articles, externalEntities }: { articles: Article[]; externalEntities: EntityProfile[] }) {
    const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

    // Try to build a co-occurrence network from article.entities (if available in API response)
    const articleNetwork = useMemo(() => buildEntityNetwork(articles), [articles]);

    // Enrich article-based nodes with external profile data
    const enrichedFromArticles = articleNetwork.map(node => {
        const ext = externalEntities.find(e => e.name.toLowerCase() === node.name.toLowerCase());
        return { ...node, risk_tags: ext?.risk_tags || [], relevance_reason: ext?.relevance_reason };
    });

    // Fallback: if article.entities aren't populated (not joined in API), use externalEntities directly
    // and try to find related articles by text-matching entity name in title/summary
    const enriched = enrichedFromArticles.length > 0 ? enrichedFromArticles : externalEntities.map(ext => {
        const nameLC = ext.name.toLowerCase();
        const relatedArticles = articles.filter(a =>
            a.title?.toLowerCase().includes(nameLC) ||
            a.summary?.toLowerCase().includes(nameLC) ||
            (a.keywords || []).some(k => k.toLowerCase().includes(nameLC))
        );

        // Compute co-occurrences: other entities that appear in the same matched articles
        const coMap: Record<string, { name: string; type: string; count: number }> = {};
        for (const a of relatedArticles) {
            for (const other of externalEntities) {
                if (other.name === ext.name) continue;
                const otherLC = other.name.toLowerCase();
                if (a.title?.toLowerCase().includes(otherLC) || a.summary?.toLowerCase().includes(otherLC)) {
                    coMap[other.name] = coMap[other.name]
                        ? { ...coMap[other.name], count: coMap[other.name].count + 1 }
                        : { name: other.name, type: other.type || "location", count: 1 };
                }
            }
        }

        const sentPos = relatedArticles.filter(a => a.sentiment?.toUpperCase() === "POSITIVE").length;
        const sentNeg = relatedArticles.filter(a => a.sentiment?.toUpperCase() === "NEGATIVE").length;
        const sentNeu = relatedArticles.filter(a => a.sentiment?.toUpperCase() === "NEUTRAL").length;

        return {
            name: ext.name,
            type: ext.type || "location",
            mentions: ext.mentions || relatedArticles.length,
            articles: relatedArticles,
            coOccursWith: Object.values(coMap).sort((a, b) => b.count - a.count),
            sentiment: { positive: sentPos, negative: sentNeg, neutral: sentNeu },
            risk_tags: ext.risk_tags || [],
            relevance_reason: ext.relevance_reason,
        } as EntityNode & { risk_tags: string[]; relevance_reason?: string };
    }).filter(e => e.mentions > 0).sort((a, b) => b.mentions - a.mentions);

    if (enriched.length === 0) {
        return (
            <div className="px-5 py-8 text-center">
                <Users size={18} className="text-slate-600 mx-auto mb-2" />
                <div className="text-sm text-slate-500">No entity data available for this date.</div>
                <div className="text-xs text-slate-600 mt-1">Entities are extracted automatically as articles are scraped and analysed.</div>
            </div>
        );
    }

    const typeIcon: Record<string, string> = { person: "👤", org: "🏛️", location: "📍" };
    const typeColor: Record<string, string> = { person: "text-blue-400 bg-blue-500/10 border-blue-500/20", org: "text-purple-400 bg-purple-500/10 border-purple-500/20", location: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };

    return (
        <div className="divide-y divide-slate-700/30">
            {enriched.map((entity, idx) => {
                const isExp = expandedEntity === entity.name;
                const total = entity.sentiment.positive + entity.sentiment.negative + entity.sentiment.neutral;
                const negPct = total > 0 ? Math.round((entity.sentiment.negative / total) * 100) : 0;
                const posPct = total > 0 ? Math.round((entity.sentiment.positive / total) * 100) : 0;
                const dominantSentiment = negPct > 50 ? "negative" : posPct > 50 ? "positive" : "mixed";

                return (
                    <div key={entity.name} className={cn("transition-colors", isExp ? "bg-slate-800/30" : "hover:bg-slate-800/10")}>
                        <button
                            onClick={() => setExpandedEntity(isExp ? null : entity.name)}
                            className="w-full px-5 py-3.5 flex items-center gap-4 text-left"
                        >
                            {/* Rank */}
                            <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                                <span className="text-2xs text-slate-400 font-mono">{idx + 1}</span>
                            </div>

                            {/* Entity info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-sm font-semibold text-slate-200">{entity.name}</span>
                                    <span className={cn("text-2xs px-1.5 py-0.5 rounded border font-medium", typeColor[entity.type] || "text-slate-400 bg-slate-800 border-slate-700")}>
                                        {typeIcon[entity.type] || "●"} {entity.type}
                                    </span>
                                    {entity.risk_tags && entity.risk_tags.length > 0 && entity.risk_tags.slice(0, 2).map(tag => (
                                        <span key={tag} className="text-2xs bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">{tag}</span>
                                    ))}
                                </div>
                                {/* Connection summary */}
                                {entity.coOccursWith.length > 0 && (
                                    <p className="text-2xs text-slate-500 line-clamp-1">
                                        Connected with: {entity.coOccursWith.slice(0, 4).map(c => c.name).join(", ")}
                                        {entity.coOccursWith.length > 4 ? ` +${entity.coOccursWith.length - 4} more` : ""}
                                    </p>
                                )}
                            </div>

                            {/* Right side metrics */}
                            <div className="flex items-center gap-3 flex-shrink-0">
                                {/* Sentiment mini-bar */}
                                <div className="hidden sm:flex flex-col items-end gap-0.5">
                                    <div className="flex rounded-full overflow-hidden h-1.5 w-16">
                                        <div style={{ width: `${posPct}%` }} className="bg-emerald-500" />
                                        <div style={{ width: `${100 - posPct - negPct}%` }} className="bg-slate-600" />
                                        <div style={{ width: `${negPct}%` }} className="bg-red-500" />
                                    </div>
                                    <span className={cn("text-2xs font-medium",
                                        dominantSentiment === "negative" ? "text-red-400" :
                                        dominantSentiment === "positive" ? "text-emerald-400" : "text-slate-500"
                                    )}>{dominantSentiment}</span>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-bold font-mono text-slate-300">{entity.mentions}</div>
                                    <div className="text-2xs text-slate-600">mentions</div>
                                </div>
                                {isExp ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                            </div>
                        </button>

                        {isExp && (
                            <div className="px-5 pb-4 space-y-3 border-t border-slate-700/30 pt-3">
                                {/* Connection Web */}
                                {entity.coOccursWith.length > 0 && (
                                    <div>
                                        <div className="text-2xs font-mono text-slate-500 uppercase tracking-wider mb-2">🔗 Entity Connections (co-appears in same articles)</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {entity.coOccursWith.slice(0, 10).map(c => (
                                                <div key={c.name} className="flex items-center gap-1 bg-slate-800 border border-slate-700/60 rounded px-2 py-1">
                                                    <span className="text-2xs">{typeIcon[c.type] || "●"}</span>
                                                    <span className="text-2xs text-slate-300 font-medium">{c.name}</span>
                                                    <span className="text-2xs text-slate-600 font-mono">×{c.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Sentiment breakdown */}
                                <div>
                                    <div className="text-2xs font-mono text-slate-500 uppercase tracking-wider mb-2">📊 Coverage Sentiment</div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex rounded-full overflow-hidden h-2 flex-1">
                                            <div style={{ width: `${posPct}%` }} className="bg-emerald-500" />
                                            <div style={{ width: `${100 - posPct - negPct}%` }} className="bg-slate-600" />
                                            <div style={{ width: `${negPct}%` }} className="bg-red-500" />
                                        </div>
                                        <div className="flex gap-3 text-2xs flex-shrink-0">
                                            <span className="text-emerald-400">{entity.sentiment.positive} pos</span>
                                            <span className="text-slate-500">{entity.sentiment.neutral} neu</span>
                                            <span className="text-red-400">{entity.sentiment.negative} neg</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Related articles */}
                                {entity.articles.length > 0 && (
                                    <div>
                                        <div className="text-2xs font-mono text-slate-500 uppercase tracking-wider mb-2">📰 Appearing In ({entity.articles.length} article{entity.articles.length !== 1 ? "s" : ""})</div>
                                        <div className="space-y-1.5">
                                            {entity.articles.slice(0, 4).map(a => (
                                                <a key={a.id} href={a.url} target="_blank" rel="noreferrer"
                                                    className="flex items-start gap-2 group hover:bg-slate-800/50 rounded px-2 py-1.5 transition-colors">
                                                    <div className={cn("w-1 h-1 rounded-full mt-1.5 flex-shrink-0",
                                                        a.sentiment?.toUpperCase() === "NEGATIVE" ? "bg-red-400" :
                                                        a.sentiment?.toUpperCase() === "POSITIVE" ? "bg-emerald-400" : "bg-slate-600"
                                                    )} />
                                                    <span className="text-2xs text-slate-400 group-hover:text-teal-300 transition-colors line-clamp-2">{a.title_en || a.title}</span>
                                                    <ExternalLink size={8} className="text-slate-600 group-hover:text-teal-400 flex-shrink-0 mt-1" />
                                                </a>
                                            ))}
                                            {entity.articles.length > 4 && (
                                                <p className="text-2xs text-slate-600 pl-4">+{entity.articles.length - 4} more articles</p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {entity.relevance_reason && (
                                    <div className="bg-slate-800/60 border border-slate-700/40 rounded px-3 py-2">
                                        <div className="text-2xs font-mono text-slate-500 uppercase tracking-wider mb-1">Analysis Note</div>
                                        <p className="text-2xs text-slate-400">{entity.relevance_reason}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Media Tone ───────────────────────────────────────────────────────────────

function MediaToneSection({ sentiment, narrative, totalArticles }: {
    sentiment: { positive: number; negative: number; neutral: number; positive_pct: number; negative_pct: number; neutral_pct: number; total: number } | null;
    narrative: { weekly_narrative?: string; dominant_sentiment?: string; emerging_themes?: string[] } | null;
    totalArticles: number;
}) {
    if (!sentiment) return <div className="px-5 py-6 text-sm text-slate-500 text-center">Sentiment data not available.</div>;
    const dominant = sentiment.positive_pct >= sentiment.negative_pct && sentiment.positive_pct >= sentiment.neutral_pct ? "POSITIVE"
        : sentiment.negative_pct >= sentiment.positive_pct && sentiment.negative_pct >= sentiment.neutral_pct ? "NEGATIVE" : "NEUTRAL";
    const toneLabel = dominant === "POSITIVE" ? "Favourable" : dominant === "NEGATIVE" ? "Adverse" : "Mixed";
    const toneColor = dominant === "POSITIVE" ? "text-emerald-400" : dominant === "NEGATIVE" ? "text-red-400" : "text-slate-400";

    return (
        <div className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <div className="text-2xs text-slate-500 uppercase tracking-wider mb-1">Overall Media Tone</div>
                    <div className={cn("text-2xl font-bold", toneColor)}>{toneLabel}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{totalArticles} articles analysed</div>
                </div>
                <div className="text-right">
                    <div className="text-2xs text-slate-500 mb-1">Dominant Sentiment</div>
                    <div className={cn("text-sm font-semibold", sentimentColor(narrative?.dominant_sentiment || dominant))}>
                        {narrative?.dominant_sentiment || dominant}
                    </div>
                </div>
            </div>
            <div className="mb-4">
                <div className="flex rounded-full overflow-hidden h-3">
                    <div style={{ width: `${sentiment.positive_pct}%` }} className="bg-emerald-500 transition-all" />
                    <div style={{ width: `${sentiment.neutral_pct}%` }} className="bg-slate-600 transition-all" />
                    <div style={{ width: `${sentiment.negative_pct}%` }} className="bg-red-500 transition-all" />
                </div>
                <div className="flex justify-between text-2xs mt-1.5 text-slate-500">
                    <span className="text-emerald-500">{sentiment.positive_pct}% Positive</span>
                    <span>{sentiment.neutral_pct}% Neutral</span>
                    <span className="text-red-400">{sentiment.negative_pct}% Negative</span>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                    { label: "Positive", value: sentiment.positive, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                    { label: "Neutral", value: sentiment.neutral, color: "text-slate-400", bg: "bg-slate-700/40 border-slate-600/30" },
                    { label: "Negative", value: sentiment.negative, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
                ].map(item => (
                    <div key={item.label} className={cn("rounded-lg border px-3 py-2.5 text-center", item.bg)}>
                        <div className={cn("text-xl font-bold font-mono", item.color)}>{item.value}</div>
                        <div className="text-2xs text-slate-500 mt-0.5">{item.label}</div>
                    </div>
                ))}
            </div>
            {narrative?.emerging_themes && narrative.emerging_themes.length > 0 && (
                <div>
                    <div className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Emerging Themes</div>
                    <div className="flex flex-wrap gap-2">
                        {narrative.emerging_themes.slice(0, 8).map(theme => (
                            <span key={theme} className="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-2.5 py-1 rounded-full">{theme}</span>
                        ))}
                    </div>
                </div>
            )}
            {narrative?.weekly_narrative && (() => {
                // Parse JSON narrative if it's a JSON string, else show as plain text
                let parsed: Record<string, string> | null = null;
                try {
                    const raw = narrative.weekly_narrative!.trim();
                    if (raw.startsWith("{")) parsed = JSON.parse(raw);
                } catch { /* not JSON */ }

                if (parsed) {
                    const sections: { key: string; label: string; icon: string }[] = [
                        { key: "executive_summary", label: "Executive Summary", icon: "📋" },
                        { key: "key_developments", label: "Key Developments", icon: "📌" },
                        { key: "emerging_threats", label: "Emerging Threats", icon: "⚠️" },
                        { key: "entity_movements", label: "Entity Movements", icon: "👥" },
                        { key: "coverage_patterns", label: "Coverage Patterns", icon: "📰" },
                        { key: "watch_list", label: "Watch List", icon: "👁️" },
                        { key: "full_narrative", label: "Full Analysis", icon: "📄" },
                    ];

                    // Render a markdown-like text block cleanly (strip ## headings, clean bullets)
                    const renderCleanText = (raw: string) => {
                        const lines = raw
                            .replace(/\\n/g, "\n")   // unescape \n
                            .split("\n")
                            .map(l => l.trim())
                            .filter(Boolean);

                        return (
                            <div className="space-y-1.5">
                                {lines.map((line, i) => {
                                    // ## Heading or # Heading → styled subheading
                                    if (/^#{1,3}\s/.test(line)) {
                                        const text = line.replace(/^#{1,3}\s+/, "").replace(/\*\*/g, "");
                                        return <p key={i} className="text-xs font-semibold text-slate-300 mt-2 first:mt-0 uppercase tracking-wide">{text}</p>;
                                    }
                                    // * bullet or • bullet
                                    if (/^[*•\-]\s/.test(line)) {
                                        const text = line.replace(/^[*•\-]\s+/, "").replace(/\*\*/g, "");
                                        return (
                                            <p key={i} className="text-xs text-slate-400 leading-relaxed flex gap-1.5">
                                                <span className="text-teal-500 flex-shrink-0 mt-0.5">•</span>
                                                <span>{text}</span>
                                            </p>
                                        );
                                    }
                                    // Plain paragraph
                                    return <p key={i} className="text-xs text-slate-400 leading-relaxed">{line.replace(/\*\*/g, "")}</p>;
                                })}
                            </div>
                        );
                    };

                    return (
                        <div className="mt-4 space-y-2">
                            {sections.map(({ key, label, icon }) => {
                                const text = parsed![key];
                                if (!text) return null;
                                return (
                                    <div key={key} className="p-3 bg-slate-800/60 border border-slate-700/40 rounded-lg">
                                        <div className="text-2xs text-slate-500 uppercase tracking-wider mb-2">{icon} {label}</div>
                                        {renderCleanText(text)}
                                    </div>
                                );
                            })}
                        </div>
                    );
                }

                // Plain text fallback
                return (
                    <div className="mt-4 p-3 bg-slate-800/60 border border-slate-700/40 rounded-lg">
                        <div className="text-2xs text-slate-500 uppercase tracking-wider mb-1.5">📄 Narrative Analysis</div>
                        <p className="text-xs text-slate-400 leading-relaxed">{narrative.weekly_narrative}</p>
                    </div>
                );
            })()}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DailyIntelPage() {
    const [date, setDate] = useState(todayStr());
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

    const [articles, setArticles] = useState<Article[]>([]);
    const [intelData, setIntelData] = useState<{ entity_profiles?: EntityProfile[]; signals?: Signal[]; threat_assessment?: { level?: string; critical_count?: number; warning_count?: number }; narrative?: { weekly_narrative?: string; dominant_sentiment?: string; emerging_themes?: string[] } } | null>(null);
    const [sentimentData, setSentimentData] = useState<{ positive: number; negative: number; neutral: number; positive_pct: number; negative_pct: number; neutral_pct: number; total: number } | null>(null);
    const [keywords, setKeywords] = useState<KeywordItem[]>([]);

    const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
    const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());

    useEffect(() => {
        setLoading(true);
        Promise.allSettled([
            dailyIntelApi.articles(date, 100),
            dailyIntelApi.intel(),
            dailyIntelApi.analytics(),
            dailyIntelApi.keywords(),
        ]).then(([artsRes, intelRes, analyticsRes, kwRes]) => {
            if (artsRes.status === "fulfilled") {
                const d = artsRes.value as { data?: Article[] } | Article[];
                setArticles(Array.isArray(d) ? d : (d as { data?: Article[] }).data || []);
            }
            if (intelRes.status === "fulfilled") setIntelData(intelRes.value as typeof intelData);
            if (analyticsRes.status === "fulfilled") {
                const d = analyticsRes.value as { sentiment?: typeof sentimentData };
                setSentimentData(d?.sentiment || null);
            }
            if (kwRes.status === "fulfilled") {
                const d = kwRes.value as { data?: KeywordItem[] } | KeywordItem[];
                const kwArr = Array.isArray(d) ? d : (d as { data?: KeywordItem[] }).data || [];
                setKeywords(kwArr);
                setSelectedTopics(new Set(kwArr.filter(k => !k.paused).map(k => k.keyword)));
            }
            setLoading(false);
            setLastRefreshed(new Date());
        });
    }, [date, refreshKey]);

    const sectorMap = useMemo(() => assignSectors(articles), [articles]);

    // Build executive summary for the header card (no brief required)
    const computedSummary = useMemo(() =>
        buildSummaryFromArticles(articles, sectorMap, date),
        [articles, sectorMap, date]
    );

    // Articles sorted by importance for quick metrics
    const sortedByImportance = useMemo(() =>
        [...articles].sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0)),
        [articles]
    );

    const entities = (intelData?.entity_profiles || []) as EntityProfile[];
    const signals = (intelData?.signals || []) as Signal[];
    const threat = intelData?.threat_assessment;

    const critCount = threat?.critical_count ?? sortedByImportance.filter(a => (a.importance_score || 0) >= 9).length;
    const highCount = threat?.warning_count ?? sortedByImportance.filter(a => (a.importance_score || 0) >= 7 && (a.importance_score || 0) < 9).length;

    const riskLevel = threat?.level || (critCount >= 3 ? "CRITICAL" : critCount >= 1 ? "HIGH" : highCount >= 3 ? "ELEVATED" : "ROUTINE");
    const riskStyle = riskLevelStyle(riskLevel);

    const handleExport = () => {
        setExporting(true);
        try {
            const html = buildReportHTML(
                date, articles, sectorMap, computedSummary,
                keywords, signals, sentimentData, riskLevel.toUpperCase()
            );
            const win = window.open("", "_blank");
            if (win) {
                win.document.write(html);
                win.document.close();
                // Trigger save-as-PDF dialog after load
                win.addEventListener("load", () => {
                    setTimeout(() => win.print(), 600);
                });
                // Fallback if load already fired
                setTimeout(() => {
                    try { win.print(); } catch { /* already printed */ }
                }, 1200);
            }
        } finally {
            setExporting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <Loader2 size={28} className="text-teal-500 animate-spin" />
                <div className="text-sm text-slate-500">Analysing {date === todayStr() ? "today's" : date + "'s"} articles...</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">

            {/* ── Command Bar ── */}
            <div className="flex-shrink-0 px-6 py-3 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className={cn("w-2.5 h-2.5 rounded-full animate-pulse", riskStyle.dot)} />
                        <span className="text-xs font-mono uppercase tracking-wider text-slate-400">Daily Situation Report</span>
                        <span className="text-slate-700">|</span>
                        <span className={cn("text-xs font-semibold font-mono px-2 py-0.5 rounded border", riskStyle.bg, riskStyle.text)}>
                            {riskLevel} RISK
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={date}
                            max={todayStr()}
                            onChange={e => setDate(e.target.value)}
                            className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-teal-500/50 transition-colors"
                        />
                        <button onClick={() => setRefreshKey(k => k + 1)} title="Refresh" className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors">
                            <RefreshCw size={14} />
                        </button>
                        <button
                            onClick={handleExport}
                            disabled={exporting}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 rounded font-semibold transition-colors"
                        >
                            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                            {exporting ? "Generating..." : "Download Report"}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Scrollable Content ── */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-7xl mx-auto px-6 py-5 space-y-4">

                    {/* Morning Briefing Card */}
                    <div className={cn("rounded-xl border p-5", riskStyle.bg, "border-slate-700/40")}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-2xs font-mono text-slate-500 uppercase tracking-widest">Government of Odisha · Information Wing</span>
                                    <span className="text-2xs bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">FOR OFFICIAL USE ONLY</span>
                                </div>
                                <h1 className="text-lg font-bold text-slate-100 mb-0.5">Daily Situation Report — {fmtDate(date)}</h1>
                                <p className="text-xs text-slate-400 mb-3">Prepared by ROBIN Monitor System · Last refreshed {lastRefreshed.toLocaleTimeString("en-IN")}</p>
                                <p className="text-sm text-slate-300 leading-relaxed line-clamp-3">
                                    {computedSummary.executive_summary.split("\n\n")[0]}
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 flex-shrink-0 min-w-[160px]">
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { label: "Critical", value: critCount, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
                                        { label: "High", value: highCount, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
                                        { label: "Articles", value: articles.length, color: "text-slate-300", bg: "bg-slate-800 border-slate-700/40" },
                                        { label: "Topics", value: keywords.filter(k => !k.paused).length, color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20" },
                                    ].map(m => (
                                        <div key={m.label} className={cn("rounded-lg border px-3 py-2 text-center", m.bg)}>
                                            <div className={cn("text-xl font-bold font-mono", m.color)}>{m.value}</div>
                                            <div className="text-2xs text-slate-500 mt-0.5 leading-tight">{m.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Top News — always show Top 10 HOT articles of the day */}
                    <SectionCard
                        title="Today's Hot News"
                        icon={<TrendingUp size={15} />}
                        badge={
                            <span className={cn(
                                "text-2xs px-1.5 py-0.5 rounded font-mono ml-1",
                                articles.length > 0 ? "bg-amber-500/20 text-amber-400" : "bg-slate-700 text-slate-500"
                            )}>
                                Top {Math.min(10, articles.length)} stories
                            </span>
                        }
                    >
                        <TopNewsSection
                            articles={articles}
                            reviewedIds={reviewedIds}
                            onReview={id => setReviewedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                            kwMap={Object.fromEntries(keywords.map(k => [k.keyword, k.keyword_en || k.keyword]))}
                        />
                    </SectionCard>

                    {/* Sector Pulse */}
                    <SectionCard title="Sector Pulse" icon={<Activity size={15} />}
                        badge={<span className="text-2xs text-slate-500 ml-1">Odisha Governance Domains</span>}>
                        <SectorPulseSection sectorMap={sectorMap} />
                    </SectionCard>

                    {/* Early Warning */}
                    <SectionCard title="Early Warning Signals" icon={<Zap size={15} />}
                        badge={signals.filter(s => s.severity === "critical" || s.severity === "high").length > 0
                            ? <span className="text-2xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-mono ml-1 animate-pulse">{signals.filter(s => s.severity === "critical" || s.severity === "high").length} active</span>
                            : undefined}>
                        <EarlyWarningSection signals={signals} />
                    </SectionCard>

                    {/* Watch Topics */}
                    <SectionCard title="Watch Topics" icon={<Eye size={15} />}
                        badge={<span className="text-2xs bg-teal-500/15 text-teal-400 px-1.5 py-0.5 rounded font-mono ml-1">{selectedTopics.size} selected</span>}>
                        <WatchTopicsSection keywords={keywords} selectedTopics={selectedTopics} onToggle={kw => setSelectedTopics(prev => { const n = new Set(prev); n.has(kw) ? n.delete(kw) : n.add(kw); return n; })} />
                    </SectionCard>

                    {/* Entity Analysis Network */}
                    <SectionCard
                        title="Entity Analysis Network"
                        icon={<Users size={15} />}
                        badge={<span className="text-2xs text-slate-500 ml-1">Connections & relationships</span>}
                        defaultOpen={false}
                    >
                        <EntityIntelSection articles={articles} externalEntities={entities} />
                    </SectionCard>

                    {/* Media Tone */}
                    <SectionCard title="Media Tone Analysis" icon={<Radio size={15} />}
                        badge={<span className="text-2xs text-slate-500 ml-1">How Odisha is covered today</span>}
                        defaultOpen={false}>
                        <MediaToneSection sentiment={sentimentData} narrative={intelData?.narrative || null} totalArticles={articles.length} />
                    </SectionCard>

                    <div className="h-8" />
                </div>
            </div>
        </div>
    );
}
