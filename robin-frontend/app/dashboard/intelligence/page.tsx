"use client";

import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useState } from "react";
import {
    Shield, AlertTriangle, TrendingUp, TrendingDown, Eye, Radio,
    ChevronDown, ChevronRight, ExternalLink, Users, Activity,
    Target, Minus, Zap, ArrowUpRight, ArrowDownRight,
    GitBranch, AlertCircle, CheckCircle2, XCircle, Search,
} from "lucide-react";
import { useIntelligenceBrief } from "@/lib/hooks/useIntelligence";
import { cleanSnippet } from "@/lib/utils";

/* ── Types ─────────────────────────────────────────────── */
interface PostureData {
    level: string; color: string; threat_score: number;
    status_line: string; critical_count: number; warning_count: number;
    new_entities: number; articles_collected: number; collection_health: number;
}
interface Mission {
    id: string; title: string; objective: string; status: string;
    industry: string; risk_domains: string[]; created_at: string;
}
interface SituationSummary {
    executive_summary: string | null; key_developments: string | null;
    emerging_threats: string | null; entity_movements: string | null;
    watch_list: string | null; generated_at: string | null;
    risk_level: string | null;
}
interface DevelopmentArticle {
    id: string; title: string; url: string; timestamp: string;
    importance: number; sentiment: string; summary: string;
}
interface Development {
    theme: string; headline: string; summary: string;
    article_count: number; source_count: number; corroborated: boolean;
    avg_importance: number; dominant_sentiment: string; trend: string;
    latest: string; span_hours: number;
    top_entities: { name: string; mentions: number }[];
    keywords: string[];
    articles: DevelopmentArticle[];
}
interface EntityWatch {
    name: string; type: string; status: string; statusColor: string;
    change: string; changeDetail: string; mentions: number;
    influence: number; relevance_score: number;
    risk_tags: string[];
    sentiment: { positive: number; negative: number; neutral: number; trend: string };
    relevance_reason: string;
}
interface Signal {
    id: string; type: string; severity: string; title: string;
    description: string; confidence: number; impact_score: number;
    relevance_reason: string;
    recommended_actions: { priority: string; action: string }[];
    source_breakdown: { source: string; count: number }[];
    related_entities: string[]; created_at: string;
}
interface CollectionGaps {
    health_score: number; total_sources: number; active_sources: number;
    stale_sources: { name: string; type: string; hours_stale: number | null }[];
    failing_sources: { name: string; type: string; fail_count: number }[];
    blind_keywords: { keyword: string; category: string; priority: number }[];
}
interface ThreatDimensions {
    overall_score: number; risk_level: string;
    dimensions: Record<string, number>;
    velocity: { direction?: string };
    active_threats: { title: string; severity: string; category: string; importance: number }[];
}
interface RecommendedAction {
    priority: string; action: string;
    source_signal: string; signal_severity: string;
}
interface InferenceChain {
    id: string; title: string; conclusion: string;
    conclusion_confidence: number; severity: string;
    chain_steps: { step_num?: number; event?: string; evidence?: string; confidence?: number; chain?: string }[];
    scenario_7d: { scenario: string; probability: string; evidence: string }[];
    scenario_30d: { scenario: string; probability: string; evidence: string }[];
    priority_action: { title: string; rationale: string; urgency: string } | null;
    created_at: string;
}
interface BriefData {
    posture: PostureData; mission: Mission | null;
    situation_summary: SituationSummary | null;
    developments: Development[];
    entity_watchlist: EntityWatch[];
    active_signals: Signal[];
    threat_dimensions: ThreatDimensions | null;
    inference_chains: InferenceChain[];
    collection_gaps: CollectionGaps;
    recommended_actions: RecommendedAction[];
    generated_at: string;
}

/* ── Helpers ───────────────────────────────────────────── */
function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

const POSTURE_STYLES: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    red: { bg: "bg-red-500/8", border: "border-red-500/40", text: "text-red-400", glow: "shadow-red-500/10" },
    amber: { bg: "bg-amber-500/8", border: "border-amber-500/40", text: "text-amber-400", glow: "shadow-amber-500/10" },
    yellow: { bg: "bg-yellow-500/8", border: "border-yellow-500/30", text: "text-yellow-400", glow: "shadow-yellow-500/10" },
    green: { bg: "bg-teal-500/8", border: "border-teal-500/30", text: "text-teal-400", glow: "shadow-teal-500/10" },
};

const TREND_ICON: Record<string, React.ReactNode> = {
    accelerating: <ArrowUpRight size={12} className="text-red-400" />,
    new: <Zap size={12} className="text-amber-400" />,
    active: <Activity size={12} className="text-teal-400" />,
    stable: <Minus size={12} className="text-slate-500" />,
    fading: <ArrowDownRight size={12} className="text-slate-600" />,
};

const TREND_LABEL: Record<string, { text: string; color: string }> = {
    accelerating: { text: "ACCELERATING", color: "text-red-400 bg-red-500/10" },
    new: { text: "NEW", color: "text-amber-400 bg-amber-500/10" },
    active: { text: "ACTIVE", color: "text-teal-400 bg-teal-500/10" },
    stable: { text: "STABLE", color: "text-slate-400 bg-slate-500/10" },
    fading: { text: "FADING", color: "text-slate-500 bg-slate-500/10" },
};

const SEV_STYLES: Record<string, { dot: string; pill: string }> = {
    critical: { dot: "bg-red-500", pill: "bg-red-500/15 text-red-400 border-red-500/20" },
    warning: { dot: "bg-amber-500", pill: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
    watch: { dot: "bg-sky-500", pill: "bg-sky-500/15 text-sky-400 border-sky-500/20" },
};

const ENTITY_STATUS: Record<string, { dot: string; label: string }> = {
    elevated: { dot: "bg-red-500", label: "⚠️ Elevated" },
    watch: { dot: "bg-amber-500", label: "🟡 Watch" },
    positive: { dot: "bg-emerald-500", label: "🟢 Stable" },
    stable: { dot: "bg-slate-500", label: "— Stable" },
};

const CHANGE_BADGE: Record<string, { text: string; color: string }> = {
    new: { text: "NEW", color: "text-amber-400 bg-amber-500/15" },
    sentiment_shift: { text: "↑ SHIFT", color: "text-red-400 bg-red-500/15" },
    warning: { text: "⚠ WARN", color: "text-amber-400 bg-amber-500/15" },
    active: { text: "ACTIVE", color: "text-teal-400 bg-teal-500/15" },
    no_change: { text: "—", color: "text-slate-600 bg-transparent" },
};

/* ── Main Page ────────────────────────────────────────── */
export default function IntelligenceBriefPage() {
    const { data, isLoading } = useIntelligenceBrief();
    const [expandedDev, setExpandedDev] = useState<string | null>(null);
    const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
    const [expandedChain, setExpandedChain] = useState<string | null>(null);
    const [showFullNarrative, setShowFullNarrative] = useState(false);

    if (isLoading || !data) {
        return (
            <div className="h-[calc(100vh-48px)] flex items-center justify-center" style={{ background: "#080a0e" }}>
                <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-mono tracking-wider">COMPILING INTELLIGENCE BRIEF...</p>
                </div>
            </div>
        );
    }

    const brief = data as BriefData;
    const p = brief.posture;
    const ps = POSTURE_STYLES[p.color] || POSTURE_STYLES.green;

    return (
        <div className="h-[calc(100vh-48px)] overflow-y-auto custom-scrollbar" style={{ background: "#080a0e" }}>
            <div className="max-w-[1400px] mx-auto px-4 py-4 space-y-4">

                {/* ═══════════════════════════════════════════════════════
                    SECTION 1: POSTURE HEADER — The 5-second answer
                   ═══════════════════════════════════════════════════════ */}
                <div className={`rounded-lg border ${ps.border} ${ps.bg} shadow-lg ${ps.glow} p-4`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Shield size={18} className={ps.text} />
                                <span className={`text-lg font-bold font-mono tracking-wider ${ps.text}`}>
                                    {p.level}
                                </span>
                            </div>
                            {brief.mission && (
                                <div className="flex items-center gap-2 pl-4 border-l border-slate-700/50">
                                    <span className="text-[10px] font-mono text-slate-500 tracking-wider">MONITORING BRIEF</span>
                                    <span className="text-sm font-medium text-slate-200 truncate max-w-[400px]">
                                        {brief.mission.title}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-5">
                            <div className="text-right">
                                <div className="text-[10px] font-mono text-slate-500">THREAT INDEX</div>
                                <div className={`text-xl font-bold font-mono ${ps.text}`}>{p.threat_score}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-mono text-slate-500">COLLECTION</div>
                                <div className={`text-xl font-bold font-mono ${p.collection_health >= 70 ? "text-teal-400" : p.collection_health >= 40 ? "text-amber-400" : "text-red-400"}`}>
                                    {p.collection_health}%
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                                <span className="text-[10px] font-mono text-teal-500">LIVE</span>
                            </div>
                        </div>
                    </div>
                    <p className="text-[12px] text-slate-400 mt-2 font-mono">{p.status_line}</p>
                </div>

                {/* ═══════════════════════════════════════════════════════
                    SECTION 2: SITUATION SUMMARY — The daily narrative
                   ═══════════════════════════════════════════════════════ */}
                {brief.situation_summary?.executive_summary && (
                    <div className="rounded-lg border border-slate-800/60 bg-[#0c0e14] p-5">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Radio size={14} className="text-teal-500" />
                                <span className="text-[11px] font-mono text-slate-500 tracking-wider">SITUATION SUMMARY</span>
                                {brief.situation_summary.generated_at && (
                                    <span className="text-[10px] font-mono text-slate-600">
                                        {timeAgo(brief.situation_summary.generated_at)}
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={() => setShowFullNarrative(!showFullNarrative)}
                                className="text-[10px] font-mono text-teal-500 hover:text-teal-400 transition-colors"
                            >
                                {showFullNarrative ? "SHOW SUMMARY" : "SHOW FULL BRIEF"}
                            </button>
                        </div>

                        {!showFullNarrative ? (
                            <div className="space-y-4">
                                {/* Executive Summary */}
                                <p className="text-[13px] text-slate-200 leading-relaxed">
                                    {brief.situation_summary.executive_summary}
                                </p>

                                {/* Key Developments */}
                                {brief.situation_summary.key_developments && (
                                    <div>
                                        <h4 className="text-[10px] font-mono text-amber-500/70 tracking-wider mb-2">KEY DEVELOPMENTS</h4>
                                        <div className="text-[12px] text-slate-400 leading-relaxed whitespace-pre-line">
                                            {brief.situation_summary.key_developments}
                                        </div>
                                    </div>
                                )}

                                {/* Watch List */}
                                {brief.situation_summary.watch_list && (
                                    <div className="border-t border-slate-800/40 pt-3">
                                        <h4 className="text-[10px] font-mono text-sky-500/70 tracking-wider mb-2">WATCH LIST — NEXT 7 DAYS</h4>
                                        <div className="text-[12px] text-slate-400 leading-relaxed whitespace-pre-line">
                                            {brief.situation_summary.watch_list}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {[
                                    { label: "EXECUTIVE SUMMARY", content: brief.situation_summary.executive_summary, color: "text-teal-500/70" },
                                    { label: "KEY DEVELOPMENTS", content: brief.situation_summary.key_developments, color: "text-amber-500/70" },
                                    { label: "EMERGING THREATS", content: brief.situation_summary.emerging_threats, color: "text-red-500/70" },
                                    { label: "ENTITY MOVEMENTS", content: brief.situation_summary.entity_movements, color: "text-violet-500/70" },
                                    { label: "WATCH LIST", content: brief.situation_summary.watch_list, color: "text-sky-500/70" },
                                ].filter(s => s.content).map(section => (
                                    <div key={section.label}>
                                        <h4 className={`text-[10px] font-mono ${section.color} tracking-wider mb-2`}>{section.label}</h4>
                                        <div className="text-[12px] text-slate-400 leading-relaxed whitespace-pre-line">{section.content}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    SECTION 3: DEVELOPMENTS + ENTITY WATCHLIST (side by side)
                   ═══════════════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

                    {/* ── LEFT: Developments ── */}
                    <div className="lg:col-span-3 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Target size={14} className="text-teal-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">ACTIVE DEVELOPMENTS</span>
                            <span className="text-[10px] font-mono text-slate-600">{brief.developments.length}</span>
                        </div>

                        {brief.developments.length === 0 ? (
                            <div className="rounded-lg border border-slate-800/40 bg-[#0c0e14] p-6 text-center">
                                <p className="text-xs text-slate-600 font-mono">No developments detected. Run batch intelligence after scraping articles.</p>
                            </div>
                        ) : brief.developments.map((dev, i) => {
                            const isExpanded = expandedDev === `${i}`;
                            const trend = TREND_LABEL[dev.trend] || TREND_LABEL.stable;
                            const sentColor = dev.dominant_sentiment === "negative" ? "text-red-400" : dev.dominant_sentiment === "positive" ? "text-emerald-400" : "text-slate-400";

                            return (
                                <div key={i} className="rounded-lg border border-slate-800/40 bg-[#0c0e14] overflow-hidden hover:border-slate-700/60 transition-colors">
                                    <button
                                        onClick={() => setExpandedDev(isExpanded ? null : `${i}`)}
                                        className="w-full text-left p-3 hover:bg-white/[0.01] transition-colors"
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="pt-0.5">{TREND_ICON[dev.trend] || TREND_ICON.stable}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${trend.color}`}>
                                                        {trend.text}
                                                    </span>
                                                    {dev.corroborated && (
                                                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                                                            ✓ {dev.source_count} SOURCES
                                                        </span>
                                                    )}
                                                    {!dev.corroborated && (
                                                        <span className="text-[9px] font-mono text-slate-600">
                                                            1 SOURCE
                                                        </span>
                                                    )}
                                                    <span className="text-[9px] font-mono text-slate-600">
                                                        {dev.article_count} article{dev.article_count > 1 ? "s" : ""}
                                                    </span>
                                                </div>
                                                <p className="text-[13px] text-slate-200 font-medium leading-snug">{dev.headline}</p>
                                                <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{cleanSnippet(dev.summary, 150)}</p>
                                                <div className="flex items-center gap-3 mt-2">
                                                    <span className={`text-[10px] font-mono ${sentColor}`}>
                                                        {dev.dominant_sentiment}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-slate-600">
                                                        imp: {dev.avg_importance}/10
                                                    </span>
                                                    {dev.latest && (
                                                        <span className="text-[10px] font-mono text-slate-600">
                                                            {timeAgo(dev.latest)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <ChevronDown size={14} className={`text-slate-600 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                        </div>
                                    </button>
                                    {isExpanded && (
                                        <div className="px-4 pb-3 border-t border-slate-800/30 space-y-3 animate-in slide-in-from-top-1">
                                            {/* Entities involved */}
                                            {dev.top_entities.length > 0 && (
                                                <div className="pt-3">
                                                    <span className="text-[9px] font-mono text-slate-600 tracking-wider">ENTITIES INVOLVED</span>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {dev.top_entities.map(e => (
                                                            <span key={e.name} className="text-[9px] font-mono bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">
                                                                {e.name} ({e.mentions})
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {/* Source Articles */}
                                            <div>
                                                <span className="text-[9px] font-mono text-slate-600 tracking-wider">SOURCE ARTICLES</span>
                                                <div className="mt-1 space-y-1.5">
                                                    {dev.articles.map(art => (
                                                        <div key={art.id} className="flex items-start gap-2">
                                                            <span className={`text-[10px] font-mono mt-0.5 shrink-0 ${art.importance >= 8 ? "text-red-400" : art.importance >= 6 ? "text-amber-400" : "text-slate-500"}`}>
                                                                [{art.importance}]
                                                            </span>
                                                            <a href={art.url} target="_blank" rel="noopener" className="text-[11px] text-slate-300 hover:text-teal-300 transition-colors flex-1 leading-snug">
                                                                {art.title}
                                                                <ExternalLink size={9} className="inline ml-1 opacity-40" />
                                                            </a>
                                                            <span className="text-[9px] font-mono text-slate-600 shrink-0">{art.timestamp ? timeAgo(art.timestamp) : ""}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* ── RIGHT: Entity Watchlist ── */}
                    <div className="lg:col-span-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Users size={14} className="text-violet-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">ENTITY WATCHLIST</span>
                        </div>
                        <div className="rounded-lg border border-slate-800/40 bg-[#0c0e14] overflow-hidden">
                            <div className="overflow-y-auto max-h-[600px] custom-scrollbar">
                                {brief.entity_watchlist.length === 0 ? (
                                    <div className="p-6 text-center">
                                        <p className="text-xs text-slate-600 font-mono">Entity data will appear after batch intelligence runs.</p>
                                    </div>
                                ) : brief.entity_watchlist.map((entity, i) => {
                                    const es = ENTITY_STATUS[entity.status] || ENTITY_STATUS.stable;
                                    const cb = CHANGE_BADGE[entity.change] || CHANGE_BADGE.no_change;

                                    return (
                                        <div key={i} className="px-3 py-2.5 border-b border-slate-800/20 hover:bg-slate-800/20 transition-colors group">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${es.dot}`} />
                                                <span className="text-[12px] text-slate-200 font-medium flex-1 truncate">{entity.name}</span>
                                                {entity.change !== "no_change" && (
                                                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${cb.color}`}>
                                                        {cb.text}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 ml-4">
                                                <span className="text-[9px] font-mono text-slate-600">{entity.type}</span>
                                                <span className="text-[9px] font-mono text-slate-600">{entity.mentions} mentions</span>
                                                {/* Mini sentiment bar */}
                                                <div className="flex gap-px h-[3px] rounded-sm overflow-hidden flex-1 max-w-[60px]">
                                                    {entity.sentiment.negative > 0 && <div className="bg-red-500/60" style={{ width: `${(entity.sentiment.negative / (entity.sentiment.positive + entity.sentiment.negative + entity.sentiment.neutral || 1)) * 100}%` }} />}
                                                    {entity.sentiment.neutral > 0 && <div className="bg-slate-500/40" style={{ width: `${(entity.sentiment.neutral / (entity.sentiment.positive + entity.sentiment.negative + entity.sentiment.neutral || 1)) * 100}%` }} />}
                                                    {entity.sentiment.positive > 0 && <div className="bg-teal-500/60" style={{ width: `${(entity.sentiment.positive / (entity.sentiment.positive + entity.sentiment.negative + entity.sentiment.neutral || 1)) * 100}%` }} />}
                                                </div>
                                            </div>
                                            {entity.changeDetail && (
                                                <p className="text-[10px] text-slate-500 mt-1 ml-4">{entity.changeDetail}</p>
                                            )}
                                            {entity.relevance_reason && (
                                                <p className="text-[10px] text-slate-500/80 mt-1 ml-4 italic line-clamp-2">{entity.relevance_reason}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════
                    SECTION 4: ACTIVE SIGNALS + THREAT DIMENSIONS
                   ═══════════════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                    {/* ── LEFT: Active Signals ── */}
                    <div className="lg:col-span-2 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle size={14} className="text-amber-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">ACTIVE SIGNALS</span>
                            <span className="text-[10px] font-mono text-slate-600">{brief.active_signals.length}</span>
                        </div>

                        {brief.active_signals.length === 0 ? (
                            <div className="rounded-lg border border-slate-800/40 bg-[#0c0e14] p-6 text-center">
                                <p className="text-xs text-slate-600 font-mono">No active signals. Run batch intelligence to detect patterns.</p>
                            </div>
                        ) : brief.active_signals.slice(0, 8).map((signal) => {
                            const sev = SEV_STYLES[signal.severity] || SEV_STYLES.watch;
                            const isExpanded = expandedSignal === signal.id;
                            const confPct = Math.round(signal.confidence * 100);

                            return (
                                <div key={signal.id} className="rounded-lg border border-slate-800/40 bg-[#0c0e14] overflow-hidden">
                                    <button
                                        onClick={() => setExpandedSignal(isExpanded ? null : signal.id)}
                                        className="w-full text-left p-3 hover:bg-white/[0.01] transition-colors"
                                    >
                                        <div className="flex items-start gap-2">
                                            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${sev.pill}`}>
                                                        {signal.severity.toUpperCase()}
                                                    </span>
                                                    <span className="text-[9px] font-mono text-slate-600">Confidence: {confPct}%</span>
                                                    <span className="text-[9px] font-mono text-slate-600">{signal.type.replace(/_/g, " ")}</span>
                                                </div>
                                                <p className="text-[12px] text-slate-200 font-medium">{signal.title}</p>
                                                <p className="text-[11px] text-slate-500 mt-0.5">{signal.description}</p>
                                            </div>
                                            <ChevronDown size={14} className={`text-slate-600 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                        </div>
                                    </button>
                                    {isExpanded && (
                                        <div className="px-4 pb-3 border-t border-slate-800/30 space-y-3 animate-in slide-in-from-top-1">
                                            {signal.relevance_reason && (
                                                <div className="pt-3">
                                                    <span className="text-[9px] font-mono text-slate-600 tracking-wider">WHY THIS MATTERS</span>
                                                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{signal.relevance_reason}</p>
                                                </div>
                                            )}
                                            {signal.recommended_actions.length > 0 && (
                                                <div>
                                                    <span className="text-[9px] font-mono text-slate-600 tracking-wider">RECOMMENDED ACTIONS</span>
                                                    <div className="mt-1 space-y-1">
                                                        {signal.recommended_actions.map((a, i) => (
                                                            <div key={i} className="flex items-start gap-2">
                                                                <span className={`text-[9px] font-mono px-1 py-0.5 rounded shrink-0 ${a.priority === "urgent" ? "bg-red-500/15 text-red-400" : a.priority === "watch" ? "bg-amber-500/15 text-amber-400" : "bg-slate-500/15 text-slate-400"}`}>
                                                                    {a.priority.toUpperCase()}
                                                                </span>
                                                                <span className="text-[11px] text-slate-400">{a.action}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {signal.source_breakdown.length > 0 && (
                                                <div>
                                                    <span className="text-[9px] font-mono text-slate-600 tracking-wider">SOURCE BREAKDOWN</span>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {signal.source_breakdown.map((sb, i) => (
                                                            <span key={i} className="text-[9px] font-mono bg-slate-800/60 text-slate-400 px-2 py-0.5 rounded">
                                                                {sb.source}: {sb.count} article{sb.count > 1 ? "s" : ""}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* ── RIGHT: Threat Radar + Actions ── */}
                    <div className="space-y-4">
                        {/* Threat Dimensions */}
                        {brief.threat_dimensions && (
                            <div className="rounded-lg border border-slate-800/40 bg-[#0c0e14] p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Shield size={14} className="text-red-500/70" />
                                    <span className="text-[11px] font-mono text-slate-500 tracking-wider">THREAT RADAR</span>
                                </div>
                                <div className="space-y-2">
                                    {Object.entries(brief.threat_dimensions.dimensions).map(([dim, score]) => {
                                        const pct = typeof score === "number" ? score : 0;
                                        return (
                                            <div key={dim}>
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <span className="text-[10px] text-slate-400 capitalize">{dim}</span>
                                                    <span className={`text-[10px] font-mono ${pct >= 70 ? "text-red-400" : pct >= 40 ? "text-amber-400" : "text-slate-500"}`}>
                                                        {pct}
                                                    </span>
                                                </div>
                                                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-700 ${pct >= 70 ? "bg-red-500/70" : pct >= 40 ? "bg-amber-500/60" : "bg-teal-500/50"}`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {brief.threat_dimensions.velocity?.direction && (
                                    <div className="mt-3 pt-2 border-t border-slate-800/30">
                                        <span className="text-[9px] font-mono text-slate-600">VELOCITY: </span>
                                        <span className={`text-[10px] font-mono ${brief.threat_dimensions.velocity.direction === "accelerating" ? "text-red-400" : brief.threat_dimensions.velocity.direction === "decelerating" ? "text-emerald-400" : "text-slate-400"}`}>
                                            {brief.threat_dimensions.velocity.direction?.toUpperCase()}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Recommended Actions */}
                        {brief.recommended_actions.length > 0 && (
                            <div className="rounded-lg border border-slate-800/40 bg-[#0c0e14] p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap size={14} className="text-amber-500" />
                                    <span className="text-[11px] font-mono text-slate-500 tracking-wider">ACTIONS</span>
                                </div>
                                <div className="space-y-2">
                                    {brief.recommended_actions.map((action, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${action.priority === "urgent" ? "bg-red-500/15 text-red-400" : action.priority === "watch" ? "bg-amber-500/15 text-amber-400" : "bg-slate-500/15 text-slate-400"}`}>
                                                {action.priority.toUpperCase()}
                                            </span>
                                            <span className="text-[11px] text-slate-300 leading-snug">{action.action}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════
                    SECTION 5: COLLECTION GAPS + INFERENCE CHAINS
                   ═══════════════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                    {/* ── Collection Gaps ── */}
                    <div className="rounded-lg border border-slate-800/40 bg-[#0c0e14] p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Eye size={14} className="text-sky-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">COLLECTION INTEGRITY</span>
                            <span className={`text-[10px] font-mono ml-auto px-1.5 py-0.5 rounded ${brief.collection_gaps.health_score >= 70 ? "bg-teal-500/15 text-teal-400" : brief.collection_gaps.health_score >= 40 ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"}`}>
                                {brief.collection_gaps.health_score}% HEALTH
                            </span>
                        </div>

                        <div className="space-y-3">
                            {/* Source Health */}
                            <div className="flex items-center gap-2 text-[11px]">
                                <CheckCircle2 size={12} className="text-teal-500" />
                                <span className="text-slate-400">
                                    {brief.collection_gaps.active_sources}/{brief.collection_gaps.total_sources} sources active
                                </span>
                            </div>

                            {/* Stale Sources */}
                            {brief.collection_gaps.stale_sources.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 text-[11px] mb-1">
                                        <AlertCircle size={12} className="text-amber-500" />
                                        <span className="text-amber-400">{brief.collection_gaps.stale_sources.length} stale source{brief.collection_gaps.stale_sources.length > 1 ? "s" : ""} (48h+ silent)</span>
                                    </div>
                                    <div className="ml-5 space-y-0.5">
                                        {brief.collection_gaps.stale_sources.slice(0, 5).map((s, i) => (
                                            <div key={i} className="text-[10px] text-slate-500 font-mono">
                                                {s.name} <span className="text-slate-600">({s.type})</span>
                                                {s.hours_stale && <span className="text-amber-500/60 ml-1">{s.hours_stale}h</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Failing Sources */}
                            {brief.collection_gaps.failing_sources.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 text-[11px] mb-1">
                                        <XCircle size={12} className="text-red-500" />
                                        <span className="text-red-400">{brief.collection_gaps.failing_sources.length} failing source{brief.collection_gaps.failing_sources.length > 1 ? "s" : ""}</span>
                                    </div>
                                    <div className="ml-5 space-y-0.5">
                                        {brief.collection_gaps.failing_sources.slice(0, 3).map((s, i) => (
                                            <div key={i} className="text-[10px] text-slate-500 font-mono">
                                                {s.name} <span className="text-red-500/60">{s.fail_count} failures</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Blind Spots */}
                            {brief.collection_gaps.blind_keywords.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 text-[11px] mb-1">
                                        <Search size={12} className="text-slate-500" />
                                        <span className="text-slate-400">{brief.collection_gaps.blind_keywords.length} keyword{brief.collection_gaps.blind_keywords.length > 1 ? "s" : ""} with zero hits</span>
                                    </div>
                                    <div className="ml-5 flex flex-wrap gap-1">
                                        {brief.collection_gaps.blind_keywords.slice(0, 8).map((k, i) => (
                                            <span key={i} className="text-[9px] font-mono bg-slate-800/60 text-slate-500 px-1.5 py-0.5 rounded">
                                                {k.keyword}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {brief.collection_gaps.stale_sources.length === 0 && brief.collection_gaps.failing_sources.length === 0 && brief.collection_gaps.blind_keywords.length === 0 && (
                                <div className="flex items-center gap-2 text-[11px]">
                                    <CheckCircle2 size={12} className="text-teal-500" />
                                    <span className="text-teal-400">All sources healthy. No blind spots detected.</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Inference Chains ── */}
                    <div className="rounded-lg border border-slate-800/40 bg-[#0c0e14] p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <GitBranch size={14} className="text-violet-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">INFERENCE CHAINS</span>
                        </div>

                        {brief.inference_chains.length === 0 ? (
                            <p className="text-xs text-slate-600 font-mono">No inference chains generated yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {brief.inference_chains.slice(0, 5).map((chain) => {
                                    const isExpanded = expandedChain === chain.id;
                                    const confPct = Math.round((chain.conclusion_confidence || 0) * 100);
                                    const sevStyle = SEV_STYLES[chain.severity] || SEV_STYLES.watch;

                                    return (
                                        <div key={chain.id} className="border border-slate-800/30 rounded-md overflow-hidden">
                                            <button
                                                onClick={() => setExpandedChain(isExpanded ? null : chain.id)}
                                                className="w-full text-left px-3 py-2 hover:bg-white/[0.01] transition-colors"
                                            >
                                                <div className="flex items-start gap-2">
                                                    <span className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${sevStyle.dot}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] text-slate-200 font-medium truncate">{chain.title}</p>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[9px] font-mono text-slate-600">Confidence: {confPct}%</span>
                                                            <span className={`text-[9px] font-mono ${sevStyle.pill.split(" ")[1]}`}>{chain.severity}</span>
                                                            {chain.priority_action && (
                                                                <span className={`text-[9px] font-mono ${chain.priority_action.urgency === 'immediate' ? 'text-red-400' : chain.priority_action.urgency === 'soon' ? 'text-amber-400' : 'text-slate-400'}`}>
                                                                    {chain.priority_action.urgency?.toUpperCase()}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <ChevronRight size={12} className={`text-slate-600 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                                </div>
                                            </button>
                                            {isExpanded && (
                                                <div className="px-3 pb-3 border-t border-slate-800/20 animate-in slide-in-from-top-1">
                                                    {/* Chain Steps */}
                                                    {chain.chain_steps?.length > 0 && (
                                                        <div className="mt-2 space-y-1.5">
                                                            <span className="text-[9px] font-mono text-slate-600 tracking-wider">REASONING CHAIN</span>
                                                            {chain.chain_steps.map((step, i) => (
                                                                <div key={i} className="flex items-start gap-2 text-[10px] pl-2 border-l border-slate-700/30">
                                                                    <span className="text-teal-500 font-mono shrink-0">{step.step_num || i + 1}.</span>
                                                                    <div>
                                                                        <span className="text-slate-300">{step.event || step.chain}</span>
                                                                        {step.evidence && <span className="text-slate-600 ml-1">— {step.evidence}</span>}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {/* Conclusion */}
                                                    <div className="mt-2 pt-2 border-t border-slate-800/20">
                                                        <span className="text-[9px] font-mono text-amber-500/70 tracking-wider">CONCLUSION</span>
                                                        <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">{chain.conclusion}</p>
                                                    </div>
                                                    {/* Scenarios */}
                                                    {chain.scenario_7d?.length > 0 && (
                                                        <div className="mt-2">
                                                            <span className="text-[9px] font-mono text-sky-500/70 tracking-wider">7-DAY SCENARIOS</span>
                                                            {chain.scenario_7d.map((s, i) => (
                                                                <div key={i} className="text-[10px] text-slate-400 mt-0.5">
                                                                    <span className={`font-mono ${s.probability === 'high' ? 'text-red-400' : s.probability === 'medium' ? 'text-amber-400' : 'text-slate-500'}`}>[{s.probability}]</span>
                                                                    {' '}{s.scenario}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {/* Priority Action */}
                                                    {chain.priority_action && (
                                                        <div className="mt-2 pt-2 border-t border-slate-800/20">
                                                            <span className="text-[9px] font-mono text-violet-500/70 tracking-wider">ACTION</span>
                                                            <p className="text-[10px] text-slate-300 mt-0.5">{chain.priority_action.title}</p>
                                                            <p className="text-[10px] text-slate-500 mt-0.5 italic">{chain.priority_action.rationale}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="text-center py-2">
                    <span className="text-[9px] font-mono text-slate-700">
                        ROBIN Intelligence Brief · Generated {brief.generated_at ? new Date(brief.generated_at).toLocaleString() : "—"}
                    </span>
                </div>
            </div>
        </div>
    );
}
