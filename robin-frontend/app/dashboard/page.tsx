"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    AlertTriangle, ChevronRight, ChevronDown, Clock,
    Radio, Shield, Target, Activity, Eye, Zap,
    ExternalLink, X, TrendingUp, MapPin,
} from "lucide-react";
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import dynamic from "next/dynamic";

/* ── Lazy-load map (Leaflet needs window) ────────────────── */
const GeoMap = dynamic(() => import("@/components/dashboard/GeoMap"), { ssr: false });

/* ── Types ─────────────────────────────────────────────── */
interface GeoNode {
    label: string; lat: number; lng: number; events: number;
    avgImportance: number; sentiments: { positive: number; negative: number; neutral: number };
    articles: { id: string; title: string; importance: number; sentiment: string }[];
}
interface FeedItem {
    id: string; title: string; url: string; timestamp: string;
    severity: string; importance: number; sentiment: string;
    summary: string; matchedKeywords: string[]; riskIndicators: string[];
}
interface KeywordItem {
    keyword: string; category: string; priority: number; rationale: string;
    hits: number; sentiments: { positive: number; negative: number; neutral: number };
    articles: { id: string; title: string; importance: number; sentiment: string; summary: string; timestamp: string }[];
}
interface Alert {
    id: string; title: string; url: string; severity: string;
    importance: number; confidence: number; summary: string;
    sentiment: string; matchedKeywords: string[]; claims: string[];
    entities: { orgs?: string[]; people?: string[]; locations?: string[] };
    timestamp: string;
}
interface TimelinePoint { hour: string; avgImportance: number; count: number }
interface OverviewData {
    mission: { id: string; title: string; objective: string; status: string } | null;
    metrics: {
        totalArticles: number; avgImportance: number; riskLevel: string;
        riskIndex: number; sentiment: { positive: number; negative: number; neutral: number };
        totalSources: number; activeSources: number;
    };
    geoNodes: GeoNode[]; situationFeed: FeedItem[]; riskTimeline: TimelinePoint[];
    keywords: KeywordItem[]; criticalAlerts: Alert[];
}

/* ── Severity config ──────────────────────────────────── */
const SEV = {
    critical: { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-400", pill: "bg-red-500/20 text-red-400", dot: "bg-red-500" },
    high: { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-400", pill: "bg-amber-500/20 text-amber-400", dot: "bg-amber-500" },
    elevated: { bg: "bg-yellow-500/10", border: "border-yellow-500/40", text: "text-yellow-400", pill: "bg-yellow-500/20 text-yellow-300", dot: "bg-yellow-500" },
    routine: { bg: "bg-slate-500/10", border: "border-slate-500/30", text: "text-slate-400", pill: "bg-slate-500/20 text-slate-400", dot: "bg-slate-500" },
};

function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

import apiFetch from "@/lib/api";

/* ── Main Page ────────────────────────────────────────── */
export default function StrategicMonitor() {
    const { data, isLoading } = useQuery<OverviewData>({
        queryKey: ["overview"],
        queryFn: () => apiFetch<OverviewData>(`/api/test/overview`),
        refetchInterval: 60000,
        staleTime: 30000,
    });

    const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
    const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

    // Filtered feed when keyword is selected
    const filteredFeed = useMemo(() => {
        if (!data) return [];
        if (!selectedKeyword) return data.situationFeed;
        return data.situationFeed.filter(f => f.matchedKeywords.includes(selectedKeyword));
    }, [data, selectedKeyword]);

    // Selected keyword data
    const kwData = useMemo(() => {
        if (!selectedKeyword || !data) return null;
        return data.keywords.find(k => k.keyword === selectedKeyword) || null;
    }, [data, selectedKeyword]);

    if (isLoading || !data) {
        return (
            <div className="h-screen flex items-center justify-center" style={{ background: "#080a0e" }}>
                <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-mono tracking-wider">LOADING STRATEGIC OVERVIEW...</p>
                </div>
            </div>
        );
    }

    const m = data.metrics;
    const riskColor = m.riskLevel === "critical" ? "text-red-400" : m.riskLevel === "elevated" ? "text-amber-400" : "text-teal-400";
    const totalSent = m.sentiment.positive + m.sentiment.negative + m.sentiment.neutral || 1;

    return (
        <div className="h-[calc(100vh-48px)] flex flex-col overflow-hidden" style={{ background: "#080a0e" }}>

            {/* ── MISSION RIBBON ─────────────────────────── */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/60" style={{ background: "#0c0e14" }}>
                <div className="flex items-center gap-3">
                    <Shield size={14} className="text-teal-500" />
                    <span className="text-[11px] font-mono text-slate-500 tracking-wider">MISSION</span>
                    <span className="text-[12px] font-semibold text-slate-200 truncate max-w-[300px]">
                        {data.mission?.title?.toUpperCase() || "NO ACTIVE MISSION"}
                    </span>
                </div>
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500">RISK INDEX</span>
                        <span className={`text-[13px] font-bold font-mono ${riskColor}`}>
                            {m.riskIndex.toFixed(1)}
                        </span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${m.riskLevel === "critical" ? "bg-red-500/20 text-red-400" : m.riskLevel === "elevated" ? "bg-amber-500/20 text-amber-400" : "bg-teal-500/20 text-teal-400"}`}>
                            {m.riskLevel.toUpperCase()}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500">SENSORS</span>
                        <span className="text-[12px] font-mono text-teal-400">{m.activeSources}/{m.totalSources}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500">INTEL</span>
                        <span className="text-[12px] font-mono text-slate-300">{m.totalArticles}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                        <span className="text-[10px] font-mono text-teal-500">LIVE</span>
                    </div>
                </div>
            </div>

            {/* ── MAIN CONTENT ──────────────────────────── */}
            <div className="flex-1 flex overflow-hidden">

                {/* ── LEFT: OPERATIONAL TARGETS ─────────── */}
                <div className="w-[220px] border-r border-slate-800/50 flex flex-col overflow-hidden" style={{ background: "#0a0c12" }}>
                    <div className="px-3 py-2 border-b border-slate-800/40">
                        <div className="flex items-center gap-2">
                            <Target size={12} className="text-teal-500" />
                            <span className="text-[10px] font-mono text-slate-500 tracking-wider">OPERATIONAL TARGETS</span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {selectedKeyword && (
                            <button
                                onClick={() => setSelectedKeyword(null)}
                                className="w-full px-3 py-1.5 flex items-center gap-2 text-[10px] font-mono text-teal-400 hover:bg-teal-500/10 border-b border-slate-800/30"
                            >
                                <X size={10} /> CLEAR FILTER
                            </button>
                        )}
                        {data.keywords.filter(k => k.hits > 0).map(kw => (
                            <button
                                key={kw.keyword}
                                onClick={() => setSelectedKeyword(selectedKeyword === kw.keyword ? null : kw.keyword)}
                                className={`w-full text-left px-3 py-2 border-b border-slate-800/20 transition-all group ${selectedKeyword === kw.keyword ? "bg-teal-500/10 border-l-2 border-l-teal-500" : "hover:bg-slate-800/30 border-l-2 border-l-transparent"}`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className={`text-[11px] truncate ${selectedKeyword === kw.keyword ? "text-teal-300 font-medium" : "text-slate-300"}`}>
                                        {kw.keyword}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-500 ml-2">{kw.hits}</span>
                                </div>
                                {/* Mini sentiment bar */}
                                <div className="flex gap-px mt-1 h-[3px] rounded-sm overflow-hidden">
                                    {kw.sentiments.negative > 0 && <div className="bg-red-500/60" style={{ width: `${(kw.sentiments.negative / kw.hits) * 100}%` }} />}
                                    {kw.sentiments.neutral > 0 && <div className="bg-slate-500/40" style={{ width: `${(kw.sentiments.neutral / kw.hits) * 100}%` }} />}
                                    {kw.sentiments.positive > 0 && <div className="bg-teal-500/60" style={{ width: `${(kw.sentiments.positive / kw.hits) * 100}%` }} />}
                                </div>
                            </button>
                        ))}
                        {/* Zero-hit keywords collapsed */}
                        {data.keywords.filter(k => k.hits === 0).length > 0 && (
                            <div className="px-3 py-2 border-b border-slate-800/20">
                                <span className="text-[9px] font-mono text-slate-600">{data.keywords.filter(k => k.hits === 0).length} DORMANT TARGETS</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── CENTER ───────────────────────────── */}
                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* ── GEO MAP (top center) ─────────── */}
                    <div className="h-[45%] border-b border-slate-800/50 relative">
                        <div className="absolute top-2 left-3 z-[1000] flex items-center gap-2">
                            <MapPin size={12} className="text-teal-500" />
                            <span className="text-[10px] font-mono text-slate-500 tracking-wider">GEOGRAPHIC INTELLIGENCE</span>
                            {selectedKeyword && <span className="text-[9px] font-mono bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded">FILTERED: {selectedKeyword}</span>}
                        </div>
                        <GeoMap nodes={data.geoNodes} />
                    </div>

                    {/* ── SITUATION FEED (bottom center) ── */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-3 py-2 border-b border-slate-800/40 flex items-center justify-between" style={{ background: "#0a0c12" }}>
                            <div className="flex items-center gap-2">
                                <Radio size={12} className="text-teal-500" />
                                <span className="text-[10px] font-mono text-slate-500 tracking-wider">SITUATION ROOM</span>
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-[9px] font-mono text-green-500">LIVE</span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-600">{filteredFeed.length} ENTRIES</span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ background: "#080a0e" }}>
                            {filteredFeed.map(item => {
                                const sev = SEV[item.severity as keyof typeof SEV] || SEV.routine;
                                return (
                                    <div key={item.id} className={`px-3 py-2.5 border-b border-slate-800/20 hover:bg-slate-800/20 transition-colors group`}>
                                        <div className="flex items-start gap-2">
                                            <span className="text-[10px] font-mono text-slate-600 mt-0.5 shrink-0 w-[48px]">
                                                {new Date(item.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                                            </span>
                                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${sev.pill}`}>
                                                {item.severity.toUpperCase()}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <a href={item.url} target="_blank" rel="noopener" className="text-[12px] text-slate-200 font-medium hover:text-teal-300 transition-colors leading-tight block">
                                                    {item.title}
                                                    <ExternalLink size={9} className="inline ml-1 opacity-0 group-hover:opacity-50" />
                                                </a>
                                                <p className="text-[11px] text-slate-500 leading-relaxed mt-1 line-clamp-2">{item.summary}</p>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <span className="text-[9px] font-mono text-slate-600">{timeAgo(item.timestamp)}</span>
                                                    {item.matchedKeywords.slice(0, 3).map(kw => (
                                                        <button
                                                            key={kw}
                                                            onClick={() => setSelectedKeyword(kw)}
                                                            className="text-[9px] font-mono text-teal-500/60 hover:text-teal-400 transition-colors"
                                                        >
                                                            #{kw.replace(/\s+/g, "_")}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <span className={`text-[11px] font-mono font-bold shrink-0 ${item.importance >= 9 ? "text-red-400" : item.importance >= 7 ? "text-amber-400" : "text-slate-500"}`}>
                                                {item.importance}/10
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* ── RIGHT PANEL ──────────────────────── */}
                <div className="w-[320px] border-l border-slate-800/50 flex flex-col overflow-hidden" style={{ background: "#0a0c12" }}>

                    {/* ── RISK PULSE (top right) ─────── */}
                    <div className="h-[200px] border-b border-slate-800/40 flex flex-col">
                        <div className="px-3 py-2 flex items-center gap-2">
                            <Activity size={12} className="text-amber-500" />
                            <span className="text-[10px] font-mono text-slate-500 tracking-wider">RISK PULSE — 24H</span>
                        </div>
                        <div className="flex-1 px-2 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data.riskTimeline} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis
                                        dataKey="hour"
                                        tick={{ fill: "#475569", fontSize: 9 }}
                                        tickFormatter={(h: string) => h?.slice(11, 16) || ""}
                                        axisLine={false} tickLine={false}
                                    />
                                    <YAxis hide domain={[0, 10]} />
                                    <Tooltip
                                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "2px", fontSize: "11px", color: "#e2e8f0" }}
                                        formatter={(v: any) => [`${v ?? 0}/10`, "Risk"]}
                                        labelFormatter={(l: any) => String(l)?.slice(11, 16) || ""}
                                    />
                                    <Area type="monotone" dataKey="avgImportance" stroke="#f59e0b" fill="url(#riskGrad)" strokeWidth={1.5} dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        {/* Metrics row */}
                        <div className="flex border-t border-slate-800/30 divide-x divide-slate-800/30">
                            <div className="flex-1 py-1.5 text-center">
                                <div className="text-[14px] font-mono font-bold text-slate-200">{m.totalArticles}</div>
                                <div className="text-[8px] font-mono text-slate-600 tracking-wider">ARTICLES</div>
                            </div>
                            <div className="flex-1 py-1.5 text-center">
                                <div className={`text-[14px] font-mono font-bold ${riskColor}`}>{m.avgImportance.toFixed(1)}</div>
                                <div className="text-[8px] font-mono text-slate-600 tracking-wider">AVG THREAT</div>
                            </div>
                            <div className="flex-1 py-1.5 text-center">
                                <div className="text-[14px] font-mono font-bold text-red-400">{Math.round((m.sentiment.negative / totalSent) * 100)}%</div>
                                <div className="text-[8px] font-mono text-slate-600 tracking-wider">NEGATIVE</div>
                            </div>
                        </div>
                    </div>

                    {/* ── CRITICAL ALERTS (bottom right) ── */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-800/40">
                            <AlertTriangle size={12} className="text-red-500" />
                            <span className="text-[10px] font-mono text-slate-500 tracking-wider">CRITICAL ALERTS</span>
                            <span className="text-[9px] font-mono text-red-500/60 ml-auto">{data.criticalAlerts.length}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {data.criticalAlerts.map(alert => {
                                const sev = SEV[alert.severity as keyof typeof SEV] || SEV.high;
                                const isExpanded = expandedAlert === alert.id;
                                return (
                                    <div key={alert.id} className={`border-b border-slate-800/20 ${sev.bg}`}>
                                        <button
                                            onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                                            className="w-full text-left px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
                                        >
                                            <div className="flex items-start gap-2">
                                                <span className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-0.5">
                                                        <span className={`text-[9px] font-mono px-1 py-0.5 ${sev.pill} rounded`}>{alert.severity.toUpperCase()}</span>
                                                        <span className="text-[9px] font-mono text-slate-600">CONF: {alert.confidence}%</span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-200 font-medium leading-tight">{alert.title}</p>
                                                    <p className="text-[10px] text-slate-500 text-slate-400 mt-1 line-clamp-2">{alert.summary}</p>
                                                </div>
                                                <ChevronDown size={12} className={`text-slate-600 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                                            </div>
                                        </button>
                                        {isExpanded && (
                                            <div className="px-3 pb-3 space-y-2 animate-in slide-in-from-top-1">
                                                {/* Claims */}
                                                {alert.claims?.length > 0 && (
                                                    <div>
                                                        <span className="text-[9px] font-mono text-slate-600 tracking-wider">KEY CLAIMS</span>
                                                        <ul className="mt-1 space-y-1">
                                                            {alert.claims.map((c, i) => (
                                                                <li key={i} className="text-[10px] text-slate-400 pl-2 border-l border-slate-700">
                                                                    {c}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                                {/* Entities */}
                                                {alert.entities && (
                                                    <div className="flex flex-wrap gap-1">
                                                        {(alert.entities.people || []).map(p => (
                                                            <span key={p} className="text-[9px] font-mono bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{p}</span>
                                                        ))}
                                                        {(alert.entities.orgs || []).map(o => (
                                                            <span key={o} className="text-[9px] font-mono bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">{o}</span>
                                                        ))}
                                                        {(alert.entities.locations || []).map(l => (
                                                            <span key={l} className="text-[9px] font-mono bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded">{l}</span>
                                                        ))}
                                                    </div>
                                                )}
                                                <a href={alert.url} target="_blank" rel="noopener" className="text-[10px] text-teal-500 hover:text-teal-400 flex items-center gap-1">
                                                    View source <ExternalLink size={9} />
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── KEYWORD DRILL-DOWN (if selected) ── */}
                    {kwData && (
                        <div className="border-t border-slate-800/40 max-h-[250px] overflow-y-auto custom-scrollbar" style={{ background: "#0d0f16" }}>
                            <div className="px-3 py-2 flex items-center justify-between sticky top-0" style={{ background: "#0d0f16" }}>
                                <div className="flex items-center gap-2">
                                    <Eye size={12} className="text-teal-500" />
                                    <span className="text-[10px] font-mono text-teal-400">{kwData.keyword}</span>
                                </div>
                                <button onClick={() => setSelectedKeyword(null)} className="text-slate-600 hover:text-slate-400">
                                    <X size={12} />
                                </button>
                            </div>
                            <div className="px-3 pb-2">
                                <p className="text-[10px] text-slate-500 mb-2">{kwData.rationale}</p>
                                <div className="space-y-1.5">
                                    {kwData.articles.map(a => (
                                        <div key={a.id} className="text-[10px] text-slate-400 pl-2 border-l border-slate-700 py-1">
                                            <span className={`font-mono mr-1 ${a.importance >= 9 ? "text-red-400" : a.importance >= 7 ? "text-amber-400" : "text-slate-500"}`}>[{a.importance}]</span>
                                            {a.title}
                                            <span className="text-slate-600 ml-1">{timeAgo(a.timestamp)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
