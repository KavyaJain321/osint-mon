"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { useState } from "react";
import Link from "next/link";
import {
    Shield, AlertTriangle, Radio,
    ChevronDown, ExternalLink, Users, Activity,
    Target, Minus, Zap, ArrowUpRight, ArrowDownRight,
    AlertCircle, CheckCircle2, GitBranch, Clock,
} from "lucide-react";
import { useIntelligenceBrief } from "@/lib/hooks/useIntelligence";
import { cleanSnippet } from "@/lib/utils";

function safeTitle(title_en?: string | null, title?: string): string {
    const en = (title_en || "").trim();
    const raw = (title || "").trim();
    const NON_LATIN = /[\u0B00-\u0B7F\u0900-\u097F]/;
    if (en && /[a-zA-Z]/.test(en) && !NON_LATIN.test(en)) return en;
    if (raw && /[a-zA-Z]/.test(raw) && !NON_LATIN.test(raw)) return raw;
    return "[ Translation pending ]";
}

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
    id: string; title: string; title_en?: string | null; url: string; timestamp: string;
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
    const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");

    const [showFullNarrative, setShowFullNarrative] = useState(false);

    if (isLoading || !data) {
        return (
            <div className="h-[calc(100vh-48px)] flex items-center justify-center bg-base">
                <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-mono tracking-wider">COMPILING SITUATION BRIEF...</p>
                </div>
            </div>
        );
    }

    const brief = data as BriefData;
    const p = brief.posture;
    const ps = POSTURE_STYLES[p.color] || POSTURE_STYLES.green;

    return (
        <div className="h-[calc(100vh-48px)] overflow-y-auto overflow-x-hidden custom-scrollbar bg-base">
            <div className="w-full max-w-[1400px] mx-auto px-4 py-4 space-y-4">

                {/* ═══════════════════════════════════════════════════════
                    SECTION 1: POSTURE HEADER — The 5-second answer
                   ═══════════════════════════════════════════════════════ */}
                <div className={`rounded-lg border ${ps.border} ${ps.bg} shadow-lg ${ps.glow} p-4`}>
                    <div className="flex items-center gap-3 min-w-0">
                        {/* Left: level badge + mission title */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <Shield size={18} className={ps.text} />
                                <span className={`text-lg font-bold font-mono tracking-wider ${ps.text}`}>
                                    {p.level}
                                </span>
                            </div>
                            {brief.mission && (
                                <div className="flex items-center gap-2 pl-3 border-l border-slate-700/50 min-w-0">
                                    <span className="text-[10px] font-mono text-slate-500 tracking-wider flex-shrink-0">MONITORING BRIEF</span>
                                    <span className="text-sm font-medium text-slate-200 truncate">
                                        {brief.mission.title}
                                    </span>
                                </div>
                            )}
                        </div>
                        {/* Right: metrics — always visible, never squashed */}
                        <div className="flex items-center gap-4 flex-shrink-0">
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
                    {/* Time range selector */}
                    <div className="flex items-center gap-1 mt-3 pt-3 border-t border-slate-700/40">
                        <Clock size={11} className="text-slate-600 mr-1" />
                        <span className="text-[10px] font-mono text-slate-600 mr-2">ANALYSIS WINDOW:</span>
                        {(["7d", "30d", "90d"] as const).map(r => (
                            <button
                                key={r}
                                onClick={() => setTimeRange(r)}
                                className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${timeRange === r ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "text-slate-500 hover:text-slate-300 border border-transparent"}`}
                            >
                                {r === "7d" ? "LAST 7 DAYS" : r === "30d" ? "LAST 30 DAYS" : "LAST 90 DAYS"}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════
                    SECTION 2: SITUATION SUMMARY — The daily narrative
                   ═══════════════════════════════════════════════════════ */}
                {brief.situation_summary?.executive_summary && (
                    <div className="rounded-lg border border-border bg-surface p-5">
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
                                <div className="text-[13px] text-slate-200 leading-relaxed prose prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 max-w-none [&_table]:min-w-full [&_table]:text-left [&_table]:border-collapse [&_table]:my-3 [&_th]:border-b [&_th]:border-slate-800/80 [&_th]:p-2 [&_th]:text-slate-300 [&_th]:bg-slate-900/50 [&_th]:font-semibold [&_td]:border-b [&_td]:border-slate-800/50 [&_td]:p-2 [&_td]:align-top [&_tr:last-child_td]:border-0 [&_table]:block [&_table]:overflow-x-auto">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.situation_summary.executive_summary || ''}</ReactMarkdown>
                                </div>

                                {/* Key Developments */}
                                {brief.situation_summary.key_developments && (
                                    <div>
                                        <h4 className="text-[10px] font-mono text-amber-500/70 tracking-wider mb-2">KEY DEVELOPMENTS</h4>
                                        <div className="text-[12px] text-slate-400 leading-relaxed prose prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 max-w-none [&_table]:min-w-full [&_table]:text-left [&_table]:border-collapse [&_table]:my-3 [&_th]:border-b [&_th]:border-slate-800/80 [&_th]:p-2 [&_th]:text-slate-300 [&_th]:bg-slate-900/50 [&_th]:font-semibold [&_td]:border-b [&_td]:border-slate-800/50 [&_td]:p-2 [&_td]:align-top [&_tr:last-child_td]:border-0 [&_table]:block [&_table]:overflow-x-auto">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.situation_summary.key_developments}</ReactMarkdown>
                                        </div>
                                    </div>
                                )}

                                {/* Watch List */}
                                {brief.situation_summary.watch_list && (
                                    <div className="border-t border-border pt-3">
                                        <h4 className="text-[10px] font-mono text-sky-500/70 tracking-wider mb-2">WATCH LIST — NEXT 7 DAYS</h4>
                                        <div className="text-[12px] text-slate-400 leading-relaxed prose prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 max-w-none [&_table]:min-w-full [&_table]:text-left [&_table]:border-collapse [&_table]:my-3 [&_th]:border-b [&_th]:border-slate-800/80 [&_th]:p-2 [&_th]:text-slate-300 [&_th]:bg-slate-900/50 [&_th]:font-semibold [&_td]:border-b [&_td]:border-slate-800/50 [&_td]:p-2 [&_td]:align-top [&_tr:last-child_td]:border-0 [&_table]:block [&_table]:overflow-x-auto">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.situation_summary.watch_list}</ReactMarkdown>
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
                                        <div className="text-[12px] text-slate-400 leading-relaxed prose prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 max-w-none [&_table]:min-w-full [&_table]:text-left [&_table]:border-collapse [&_table]:my-3 [&_th]:border-b [&_th]:border-slate-800/80 [&_th]:p-2 [&_th]:text-slate-300 [&_th]:bg-slate-900/50 [&_th]:font-semibold [&_td]:border-b [&_td]:border-slate-800/50 [&_td]:p-2 [&_td]:align-top [&_tr:last-child_td]:border-0 [&_table]:block [&_table]:overflow-x-auto">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content || ''}</ReactMarkdown>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    SECTION 3 (NEW): INFERENCE CHAINS — Analytical reasoning
                   ═══════════════════════════════════════════════════════ */}
                {brief.inference_chains && brief.inference_chains.length > 0 && (
                    <div className="rounded-lg border border-border bg-surface p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <GitBranch size={14} className="text-violet-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">INFERENCE CHAINS — ANALYTICAL REASONING</span>
                            <span className="text-[10px] font-mono text-violet-600 ml-auto">{brief.inference_chains.length} chain{brief.inference_chains.length > 1 ? "s" : ""} · {timeRange}</span>
                        </div>
                        <div className="space-y-2">
                            {brief.inference_chains.slice(0, 5).map((chain, i) => {
                                const isExp = expandedChain === `${i}`;
                                const sevColor = chain.severity === "critical" ? "text-red-400 bg-red-500/10 border-red-500/20" : chain.severity === "warning" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" : "text-teal-400 bg-teal-500/10 border-teal-500/20";
                                const confPct = Math.round((chain.conclusion_confidence || 0) * 100);
                                return (
                                    <div key={i} className="rounded-lg border border-slate-800/60 overflow-hidden">
                                        <button
                                            onClick={() => setExpandedChain(isExp ? null : `${i}`)}
                                            className="w-full text-left p-3 hover:bg-raised transition-colors"
                                        >
                                            <div className="flex items-start gap-3">
                                                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 ${sevColor}`}>
                                                    {(chain.severity || "watch").toUpperCase()}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] text-slate-200 font-medium leading-snug">{chain.title}</p>
                                                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{chain.conclusion}</p>
                                                </div>
                                                <div className="flex items-center gap-3 flex-shrink-0">
                                                    <div className="text-right">
                                                        <div className="text-[9px] font-mono text-slate-600">CONFIDENCE</div>
                                                        <div className={`text-[13px] font-bold font-mono ${confPct >= 70 ? "text-red-400" : confPct >= 50 ? "text-amber-400" : "text-slate-500"}`}>{confPct}%</div>
                                                    </div>
                                                    <ChevronDown size={14} className={`text-slate-600 transition-transform ${isExp ? "rotate-180" : ""}`} />
                                                </div>
                                            </div>
                                        </button>
                                        {isExp && (
                                            <div className="px-4 pb-4 border-t border-slate-800/30 space-y-3 pt-3">
                                                {/* Evidence chain */}
                                                {chain.chain_steps && chain.chain_steps.length > 0 && (
                                                    <div>
                                                        <div className="text-[9px] font-mono text-slate-600 tracking-wider mb-2">EVIDENCE CHAIN</div>
                                                        <div className="space-y-1.5">
                                                            {chain.chain_steps.map((step, si) => (
                                                                <div key={si} className="flex items-start gap-2">
                                                                    <span className="text-[9px] font-mono text-violet-500/60 w-4 shrink-0">{"step" in step ? `${step.step_num}.` : `${si + 1}.`}</span>
                                                                    <span className="text-[11px] text-slate-400">{("event" in step ? step.event : undefined) || ("chain" in step ? step.chain : undefined) || ""}</span>
                                                                    {step.confidence != null && (
                                                                        <span className="text-[9px] font-mono text-slate-600 ml-auto shrink-0">{Math.round(step.confidence * 100)}%</span>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {/* 7-day scenario */}
                                                {chain.scenario_7d && chain.scenario_7d.length > 0 && (
                                                    <div>
                                                        <div className="text-[9px] font-mono text-amber-500/60 tracking-wider mb-2">7-DAY SCENARIOS</div>
                                                        <div className="space-y-1.5">
                                                            {chain.scenario_7d.slice(0, 2).map((sc, si) => (
                                                                <div key={si} className="flex items-start gap-2">
                                                                    <span className="text-[10px] font-mono text-amber-400/70">{sc.probability}</span>
                                                                    <span className="text-[11px] text-slate-400">{sc.scenario}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Priority action */}
                                                {chain.priority_action && (
                                                    <div className="bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2">
                                                        <div className="text-[9px] font-mono text-amber-500/70 tracking-wider mb-1">PRIORITY ACTION · {chain.priority_action.urgency?.toUpperCase()}</div>
                                                        <p className="text-[12px] text-slate-300 font-medium">{chain.priority_action.title}</p>
                                                        <p className="text-[11px] text-slate-500 mt-0.5">{chain.priority_action.rationale}</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    SECTION 4: DEVELOPMENTS + ENTITY WATCHLIST (side by side)
                   ═══════════════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

                    {/* ── LEFT: Developments ── */}
                    <div className="lg:col-span-3 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Target size={14} className="text-teal-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">ACTIVE DEVELOPMENTS</span>
                            <span className="text-[10px] font-mono text-slate-600">{brief.developments.length} pattern{brief.developments.length !== 1 ? "s" : ""} detected</span>
                            <Link href="/dashboard/daily-intel" className="ml-auto text-[10px] font-mono text-teal-500 hover:text-teal-400 transition-colors flex items-center gap-1">
                                <ExternalLink size={9} />source articles →
                            </Link>
                        </div>

                        {brief.developments.length === 0 ? (
                            <div className="rounded-lg border border-border bg-surface p-6 text-center">
                                <p className="text-xs text-slate-600 font-mono">No developments detected. Run batch analysis after scraping articles.</p>
                            </div>
                        ) : brief.developments.map((dev, i) => {
                            const isExpanded = expandedDev === `${i}`;
                            const trend = TREND_LABEL[dev.trend] || TREND_LABEL.stable;
                            const sentColor = dev.dominant_sentiment === "negative" ? "text-red-400" : dev.dominant_sentiment === "positive" ? "text-emerald-400" : "text-slate-400";

                            return (
                                <div key={i} className="rounded-lg border border-border bg-surface overflow-hidden hover:border-slate-700/60 transition-colors">
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
                                                                {safeTitle(art.title_en, art.title)}
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
                        {/* Threat Dimensions Radar */}
                        {brief.threat_dimensions?.dimensions && Object.keys(brief.threat_dimensions.dimensions).length > 0 && (
                            <div className="rounded-lg border border-border bg-surface p-4 mb-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Activity size={14} className="text-violet-500" />
                                    <span className="text-[11px] font-mono text-slate-500 tracking-wider">THREAT DIMENSIONS</span>
                                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ml-auto ${brief.threat_dimensions.risk_level === 'critical' ? 'bg-red-500/15 text-red-400' : brief.threat_dimensions.risk_level === 'elevated' ? 'bg-amber-500/15 text-amber-400' : 'bg-teal-500/15 text-teal-400'}`}>
                                        {brief.threat_dimensions.risk_level?.toUpperCase()}
                                    </span>
                                </div>
                                {/* Fixed-size wrapper prevents recharts from getting width=-1 in flex containers */}
                                <div style={{ width: '100%', height: '180px', minHeight: '180px' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart data={Object.entries(brief.threat_dimensions.dimensions).map(([subject, value]) => ({ subject: subject.toUpperCase(), value: Math.round(value), fullMark: 100 }))}>
                                            <PolarGrid stroke="var(--color-border)" />
                                            <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'monospace' }} />
                                            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 8, fill: 'var(--color-text-muted)' }} tickCount={3} />
                                            <Radar name="Threat" dataKey="value" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.25} strokeWidth={1.5} dot={{ r: 3, fill: '#7c3aed' }} />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {Object.entries(brief.threat_dimensions.dimensions).map(([dim, score]) => (
                                        <div key={dim} className="flex items-center gap-1">
                                            <span className="text-[9px] font-mono text-slate-500">{dim}:</span>
                                            <span className={`text-[9px] font-bold font-mono ${Number(score) >= 70 ? 'text-red-400' : Number(score) >= 40 ? 'text-amber-400' : 'text-teal-400'}`}>{Math.round(Number(score))}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="flex items-center gap-2 mb-1">
                            <Users size={14} className="text-violet-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">ENTITY WATCHLIST</span>
                        </div>
                        <div className="rounded-lg border border-border bg-surface overflow-hidden">
                            <div className="overflow-y-auto max-h-[600px] custom-scrollbar">
                                {brief.entity_watchlist.length === 0 ? (
                                    <div className="p-6 text-center">
                                        <p className="text-xs text-slate-600 font-mono">Entity data will appear after batch analysis runs.</p>
                                    </div>
                                ) : brief.entity_watchlist.map((entity, i) => {
                                    const es = ENTITY_STATUS[entity.status] || ENTITY_STATUS.stable;
                                    const cb = CHANGE_BADGE[entity.change] || CHANGE_BADGE.no_change;

                                    return (
                                        <div key={i} className="px-3 py-2.5 border-b border-slate-800/20 hover:bg-slate-800/20 transition-colors group">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${es.dot}`} />
                                                <span className="text-[12px] text-slate-200 font-medium flex-1 truncate">{entity.name}</span>
                                                {entity.mentions > 0 && (
                                                    <span className="text-[9px] font-mono text-slate-500 flex-shrink-0">{entity.mentions}×</span>
                                                )}
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

                    {/* ── LEFT: Active Signals grouped by domain ── */}
                    <div className="lg:col-span-2 space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle size={14} className="text-amber-500" />
                            <span className="text-[11px] font-mono text-slate-500 tracking-wider">ACTIVE SIGNALS</span>
                            <span className="text-[10px] font-mono text-slate-600">{brief.active_signals.length}</span>
                        </div>

                        {brief.active_signals.length === 0 ? (
                            <div className="rounded-lg border border-border bg-surface p-6 text-center">
                                <p className="text-xs text-slate-600 font-mono">No active signals. Run batch analysis to detect patterns.</p>
                            </div>
                        ) : (() => {
                            // Group signals by domain
                            const DOMAINS: Record<string, { label: string; color: string; dot: string; keywords: string[] }> = {
                                security: { label: "SECURITY & LAW ORDER", color: "text-red-400", dot: "bg-red-500", keywords: ["crime","naxal","maoist","police","arrest","murder","violence","security","protest","riot","gang","drug"] },
                                political: { label: "POLITICAL", color: "text-violet-400", dot: "bg-violet-500", keywords: ["election","political","party","minister","government","cm","bjp","congress","bjd","assembly","mla","mp"] },
                                economic: { label: "ECONOMIC", color: "text-amber-400", dot: "bg-amber-500", keywords: ["economic","industry","investment","mining","tender","corruption","fraud","financial","budget","revenue"] },
                                environmental: { label: "ENVIRONMENTAL", color: "text-teal-400", dot: "bg-teal-500", keywords: ["cyclone","flood","heatwave","drought","disaster","weather","rainfall","fire","landslide","pollution"] },
                            };
                            const grouped: Record<string, typeof brief.active_signals> = { security: [], political: [], economic: [], environmental: [], other: [] };
                            for (const signal of brief.active_signals.slice(0, 12)) {
                                const text = (signal.title + " " + signal.description).toLowerCase();
                                let matched = false;
                                for (const [domain, cfg] of Object.entries(DOMAINS)) {
                                    if (cfg.keywords.some(kw => text.includes(kw))) {
                                        grouped[domain].push(signal);
                                        matched = true;
                                        break;
                                    }
                                }
                                if (!matched) grouped.other.push(signal);
                            }
                            return Object.entries(grouped)
                                .filter(([, sigs]) => sigs.length > 0)
                                .map(([domain, sigs]) => {
                                    const cfg = DOMAINS[domain] || { label: "OTHER", color: "text-slate-400", dot: "bg-slate-500" };
                                    return (
                                        <div key={domain} className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-sm ${cfg.dot}`} />
                                                <span className={`text-[9px] font-mono tracking-wider ${cfg.color}`}>{cfg.label}</span>
                                                <span className="text-[9px] font-mono text-slate-600">({sigs.length})</span>
                                            </div>
                                            {sigs.map(signal => {
                                                const sev = SEV_STYLES[signal.severity] || SEV_STYLES.watch;
                                                const isExpanded = expandedSignal === signal.id;
                                                return (
                                                    <div key={signal.id} className="rounded-lg border border-border bg-surface overflow-hidden">
                                                        <button
                                                            onClick={() => setExpandedSignal(isExpanded ? null : signal.id)}
                                                            className="w-full text-left p-3 hover:bg-raised transition-colors"
                                                        >
                                                            <div className="flex items-start gap-2">
                                                                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${sev.pill}`}>
                                                                            {signal.severity.toUpperCase()}
                                                                        </span>
                                                                        <span className="text-[9px] font-mono text-slate-600">{Math.round(signal.confidence * 100)}% confidence</span>
                                                                    </div>
                                                                    <p className="text-[12px] text-slate-200 font-medium">{signal.title}</p>
                                                                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{signal.description}</p>
                                                                </div>
                                                                <ChevronDown size={14} className={`text-slate-600 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                                            </div>
                                                        </button>
                                                        {isExpanded && (
                                                            <div className="px-4 pb-3 border-t border-border space-y-3 animate-in slide-in-from-top-1">
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
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                });
                        })()}
                    </div>

                    {/* ── RIGHT: Government Actions ── */}
                    <div className="space-y-4">
                        {brief.recommended_actions.length > 0 ? (
                            <div className="rounded-lg border border-border bg-surface p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap size={14} className="text-amber-500" />
                                    <span className="text-[11px] font-mono text-slate-500 tracking-wider">PENDING GOVERNMENT ACTIONS</span>
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
                        ) : (
                            <div className="rounded-lg border border-border bg-surface p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Zap size={14} className="text-amber-500" />
                                    <span className="text-[11px] font-mono text-slate-500 tracking-wider">PENDING GOVERNMENT ACTIONS</span>
                                </div>
                                <p className="text-xs text-slate-600 font-mono">No urgent actions flagged. Run batch analysis to generate recommendations.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="text-center py-2">
                    <span className="text-[9px] font-mono text-slate-700">
                        ROBIN Situation Brief · Generated {brief.generated_at ? new Date(brief.generated_at).toLocaleString() : "—"}
                    </span>
                </div>
            </div>
        </div>
    );
}
