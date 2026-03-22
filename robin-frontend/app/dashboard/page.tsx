"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    AlertTriangle, ChevronRight, ChevronDown, Clock,
    Radio, Shield, Target, Activity, Eye, Zap,
    ExternalLink, X, TrendingUp, MapPin, FileText,
    Filter, ChevronLeft, Map as MapIcon, PanelLeftOpen,
    MoreVertical, Plus, Trash2, Pause, Play, Edit2,
} from "lucide-react";
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cleanSnippet } from "@/lib/utils";

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
    addedAt?: number;
    paused?: boolean;
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
    critical: { bg: "bg-red-500/10", border: "border-l-red-500", text: "text-red-400", pill: "bg-red-500/20 text-red-400", dot: "bg-red-500", label: "CRITICAL" },
    high: { bg: "bg-amber-500/10", border: "border-l-amber-500", text: "text-amber-400", pill: "bg-amber-500/20 text-amber-400", dot: "bg-amber-500", label: "HIGH" },
    elevated: { bg: "bg-yellow-500/10", border: "border-l-yellow-500", text: "text-yellow-400", pill: "bg-yellow-500/20 text-yellow-300", dot: "bg-yellow-500", label: "ELEVATED" },
    routine: { bg: "", border: "border-l-slate-700", text: "text-slate-400", pill: "bg-slate-700/60 text-slate-400", dot: "bg-slate-600", label: "ROUTINE" },
};

type SeverityFilter = "all" | "critical" | "high" | "location";

function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function fmtTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

import apiFetch from "@/lib/api";
import { InfoTooltip, ALERT_LEVEL_TOOLTIP, SENTIMENT_TOOLTIP } from "@/components/dashboard/InfoTooltip";

/* ── Score Breakdown Utility ────────────────────────────── */
function getScoreBreakdown(item: FeedItem) {
    let sourcePts = 1;
    let topicPts = 1;
    let timePts = 1;
    let sentPts = 1;

    let remaining = item.importance - 4;

    if (remaining > 0 && item.url) {
        if (item.url.includes("ndtv") || item.url.includes("timesofindia") || item.url.includes("indianexpress")) {
            const add = Math.min(2, remaining);
            sourcePts += add;
            remaining -= add;
        } else if (remaining > 0) {
            const add = Math.min(1, remaining);
            sourcePts += add;
            remaining -= add;
        }
    }

    if (remaining > 0) {
        const add = Math.min(2, Math.min(remaining, item.matchedKeywords?.length || 0));
        topicPts += add;
        remaining -= add;
    }

    if (remaining > 0) {
        const hrs = (Date.now() - new Date(item.timestamp).getTime()) / 3600000;
        if (hrs < 24) {
            const add = Math.min(1, remaining);
            timePts += add;
            remaining -= add;
        }
    }

    if (remaining > 0) {
        if ((item.sentiment || '').toUpperCase() === 'NEGATIVE' || (item.riskIndicators && item.riskIndicators.length > 0)) {
            const add = Math.min(1, remaining);
            sentPts += add;
            remaining -= add;
        }
    }

    while (remaining > 0) {
        if (sourcePts < 3) { sourcePts++; remaining--; continue; }
        if (topicPts < 3) { topicPts++; remaining--; continue; }
        if (timePts < 2) { timePts++; remaining--; continue; }
        if (sentPts < 2) { sentPts++; remaining--; continue; }
        break; 
    }
    
    return { sourcePts, topicPts, timePts, sentPts };
}

/* ── Watch Topic Modal (portal) ─────────────────────── */
function WatchTopicModal({
    open, onClose, onSave, initialData
}: {
    open: boolean;
    onClose: () => void;
    onSave: (topic: Partial<KeywordItem>) => void;
    initialData?: KeywordItem | null;
}) {
    const [mounted, setMounted] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("Person");
    const [isActive, setIsActive] = useState(true);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (open) {
            setKeyword(initialData?.keyword || "");
            setCategory(initialData?.category || "Person");
            setIsActive(!initialData?.paused);
        }
    }, [open, initialData]);

    if (!mounted || !open) return null;

    const handleSave = () => {
        if (!keyword.trim()) return;
        onSave({
            keyword: keyword.trim(),
            category,
            paused: !isActive,
            priority: initialData?.priority || 50,
        });
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card-bg border border-slate-700/60 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 bg-slate-900/50">
                    <span className="text-sm font-medium text-slate-200">{initialData ? "Edit Watch Topic" : "Add Watch Topic"}</span>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
                        <X size={16} />
                    </button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-xs font-mono text-slate-400 mb-1.5">TOPIC / KEYWORD</label>
                        <input
                            autoFocus
                            type="text"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            placeholder="e.g. Naveen, Odisha budget"
                            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-teal-500/50 transition-colors"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-mono text-slate-400 mb-1.5">CATEGORY</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-teal-500/50 transition-colors appearance-none"
                        >
                            {["Person", "Location", "Organisation", "Theme"].map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                        <label className="text-xs font-mono text-slate-400">STATUS</label>
                        <button
                            onClick={() => setIsActive(!isActive)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none ${isActive ? 'bg-teal-500' : 'bg-slate-700'}`}
                        >
                            <span className="sr-only">Toggle active status</span>
                            <span className={`pointer-events-none absolute left-0 inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800/60 bg-slate-900/50">
                    <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">
                        Cancel
                    </button>
                    <button 
                        onClick={handleSave} 
                        disabled={!keyword.trim()}
                        className="px-4 py-1.5 text-xs font-medium bg-teal-500 hover:bg-teal-400 text-slate-950 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

/* ── Watch Topics Drawer (portal) ─────────────────────── */
function WatchTopicsDrawer({
    open, onClose, keywords, selectedKeyword, onSelectKeyword,
    onAddTopic, onEditTopic, onPauseTopic, onDeleteTopic
}: {
    open: boolean;
    onClose: () => void;
    keywords: KeywordItem[];
    selectedKeyword: string | null;
    onSelectKeyword: (kw: string | null) => void;
    onAddTopic: () => void;
    onEditTopic: (kw: KeywordItem) => void;
    onPauseTopic: (kw: string) => void;
    onDeleteTopic: (kw: string) => void;
}) {
    const [mounted, setMounted] = useState(false);
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    useEffect(() => setMounted(true), []);

    if (!mounted || !open) return null;

    return createPortal(
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-[8000] bg-black/40 backdrop-blur-sm" onClick={onClose} />
            {/* Drawer */}
            <div className="fixed left-0 top-0 bottom-0 z-[8001] w-[260px] flex flex-col shadow-2xl animate-slide-in-from-left bg-panel-bg border-r border-app-border">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
                    <div className="flex items-center gap-2">
                        <Target size={13} className="text-teal-500" />
                        <span className="text-[11px] font-mono text-slate-400 tracking-wider">WATCH TOPICS</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onAddTopic} className="text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1 text-[10px] font-mono bg-teal-500/10 hover:bg-teal-500/20 px-2 py-1 rounded">
                            <Plus size={12} /> ADD TOPIC
                        </button>
                        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
                            <X size={14} />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto pb-6 relative">
                    {selectedKeyword && (
                        <button
                            onClick={() => onSelectKeyword(null)}
                            className="w-full px-4 py-2 flex items-center gap-2 text-[10px] font-mono text-teal-400 hover:bg-teal-500/10 border-b border-slate-800/30"
                        >
                            <X size={10} /> CLEAR FILTER
                        </button>
                    )}
                    {keywords.filter(k => k.hits > 0 || k.addedAt).map(kw => {
                        const isNew = kw.addedAt && Date.now() - kw.addedAt < 86400000;
                        return (
                        <div key={kw.keyword} className={`relative border-b border-slate-800/20 transition-all ${selectedKeyword === kw.keyword ? "bg-teal-500/10 border-l-2 border-l-teal-500" : "hover:bg-slate-800/30 border-l-2 border-l-transparent"}`}>
                            <button
                                onClick={() => { onSelectKeyword(selectedKeyword === kw.keyword ? null : kw.keyword); onClose(); }}
                                className="w-full text-left px-4 py-2.5 pr-8"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flexItems-center gap-2 min-w-0">
                                        <span className={`text-[12px] truncate ${selectedKeyword === kw.keyword ? "text-teal-300 font-medium" : kw.paused ? "text-slate-500 line-through" : "text-slate-300"}`}>
                                            {kw.keyword}
                                        </span>
                                        {isNew && <span className="text-[8px] font-mono bg-amber-500/20 text-amber-500 px-1 rounded flex-shrink-0">NEW</span>}
                                        {kw.paused && <span className="text-[8px] font-mono bg-slate-800 text-slate-400 px-1 rounded flex-shrink-0">PAUSED</span>}
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-500 ml-2">{kw.hits}</span>
                                </div>
                                {!kw.paused && kw.hits > 0 && (
                                    <div className="flex gap-px h-[3px] rounded-sm overflow-hidden">
                                        {kw.sentiments.negative > 0 && <div className="bg-red-500/60" style={{ width: `${(kw.sentiments.negative / kw.hits) * 100}%` }} />}
                                        {kw.sentiments.neutral > 0 && <div className="bg-slate-500/40" style={{ width: `${(kw.sentiments.neutral / kw.hits) * 100}%` }} />}
                                        {kw.sentiments.positive > 0 && <div className="bg-teal-500/60" style={{ width: `${(kw.sentiments.positive / kw.hits) * 100}%` }} />}
                                    </div>
                                )}
                            </button>
                            
                            {/* 3-dot menu */}
                            <div className="absolute top-2.5 right-2">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === kw.keyword ? null : kw.keyword); }}
                                    className="p-1 text-slate-500 hover:text-slate-300 rounded hover:bg-slate-800 transition-colors"
                                >
                                    <MoreVertical size={12} />
                                </button>
                                {openMenu === kw.keyword && (
                                    <div className="absolute right-0 top-6 w-32 bg-slate-900 border border-slate-700/60 rounded shadow-xl z-10 py-1 overflow-hidden animate-in fade-in zoom-in-95">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onEditTopic(kw); setOpenMenu(null); }}
                                            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 flex items-center gap-2"
                                        >
                                            <Edit2 size={10} /> Edit
                                        </button>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onPauseTopic(kw.keyword); setOpenMenu(null); }}
                                            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 flex items-center gap-2"
                                        >
                                            {kw.paused ? <Play size={10} /> : <Pause size={10} />} {kw.paused ? "Resume" : "Pause Monitoring"}
                                        </button>
                                        <div className="h-px bg-slate-800 my-1" />
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onDeleteTopic(kw.keyword); setOpenMenu(null); }}
                                            className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-slate-800 flex items-center gap-2"
                                        >
                                            <Trash2 size={10} /> Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )})}
                    {keywords.filter(k => k.hits === 0 && !k.addedAt).length > 0 && (
                        <div className="px-4 py-2">
                            <span className="text-[9px] font-mono text-slate-600">
                                {keywords.filter(k => k.hits === 0 && !k.addedAt).length} UNSEEN TOPICS
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </>,
        document.body
    );
}

/* ── Map View Tab (full overlay) ─────────────────────── */
function MapViewPanel({ nodes, onClose }: { nodes: GeoNode[]; onClose: () => void }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    return createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-base" style={{ zIndex: 99999 }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/60 bg-card-bg">
                <div className="flex items-center gap-2">
                    <MapPin size={13} className="text-teal-500" />
                    <span className="text-[11px] font-mono text-slate-400 tracking-wider">GEOGRAPHIC INTELLIGENCE — MAP VIEW</span>
                </div>
                <button
                    onClick={onClose}
                    className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-700/60 px-3 py-1.5 rounded transition-all"
                >
                    <X size={12} /> CLOSE MAP
                </button>
            </div>
            <div className="flex-1">
                <GeoMap nodes={nodes} />
            </div>
        </div>,
        document.body
    );
}

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
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [mapOpen, setMapOpen] = useState(false);
    const [sevFilter, setSevFilter] = useState<SeverityFilter>("all");
    const [expandedItem, setExpandedItem] = useState<string | null>(null);
    const [, setTick] = useState(0);

    // Watch Topics Local Mutations
    const [customTopics, setCustomTopics] = useState<KeywordItem[]>([]);
    const [topicMutations, setTopicMutations] = useState<Record<string, { paused?: boolean, deleted?: boolean, edited?: boolean, category?: string, priority?: number }>>({});
    const [isTopicModalOpen, setIsTopicModalOpen] = useState(false);
    const [editingTopic, setEditingTopic] = useState<KeywordItem | null>(null);
    const [popoverScoreId, setPopoverScoreId] = useState<string | null>(null);

    // Global click listener to close popover
    useEffect(() => {
        const onClick = () => setPopoverScoreId(null);
        if (popoverScoreId) {
            window.addEventListener('click', onClick);
            return () => window.removeEventListener('click', onClick);
        }
    }, [popoverScoreId]);

    // Merge backend keywords with local UI state mutations
    const displayKeywords = useMemo(() => {
        if (!data) return [];
        let merged = [...data.keywords];
        
        // Handle edits, pauses, and deletions
        merged = merged
            .filter(kw => !topicMutations[kw.keyword]?.deleted)
            .map(kw => {
                const mut = topicMutations[kw.keyword];
                if (mut) {
                    return { ...kw, ...mut };
                }
                return kw;
            });
            
        // Add new custom topics
        const customActive = customTopics
            .filter(kw => !topicMutations[kw.keyword]?.deleted)
            .map(kw => {
                const mut = topicMutations[kw.keyword];
                if (mut) {
                    return { ...kw, ...mut };
                }
                return kw;
            });
            
        return [...merged, ...customActive].sort((a, b) => b.priority - a.priority);
    }, [data, customTopics, topicMutations]);

    const handleSaveTopic = (topicData: Partial<KeywordItem>) => {
        if (editingTopic) {
            // Edit existing
            if (editingTopic.keyword === topicData.keyword) {
                setTopicMutations(prev => ({
                    ...prev,
                    [topicData.keyword!]: { ...prev[topicData.keyword!], ...topicData }
                }));
            } else {
                // Topic name changed - mark old as deleted, add new as custom
                setTopicMutations(prev => ({ ...prev, [editingTopic.keyword]: { deleted: true } }));
                setCustomTopics(prev => [...prev, {
                    keyword: topicData.keyword!,
                    category: topicData.category || "Person",
                    priority: topicData.priority || 50,
                    rationale: "Manually added",
                    hits: 0,
                    sentiments: { positive: 0, negative: 0, neutral: 0 },
                    articles: [],
                    addedAt: Date.now(),
                    paused: topicData.paused
                }]);
            }
        } else {
            // Add new
            setCustomTopics(prev => [...prev.filter(t => t.keyword !== topicData.keyword), {
                keyword: topicData.keyword!,
                category: topicData.category || "Person",
                priority: topicData.priority || 50,
                rationale: "Manually added",
                hits: 0,
                sentiments: { positive: 0, negative: 0, neutral: 0 },
                articles: [],
                addedAt: Date.now(),
                paused: topicData.paused
            }]);
            // Clear any potential previous deletion flag for this newly added keyword
            setTopicMutations(prev => {
                const newMut = { ...prev };
                delete newMut[topicData.keyword!];
                return newMut;
            });
        }
    };

    // Force re-render every minute to update relative time labels
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(interval);
    }, []);

    // Filtered and sorted timeline feed
    const filteredFeed = useMemo(() => {
        if (!data) return [];
        let feed = selectedKeyword
            ? data.situationFeed.filter(f => f.matchedKeywords.includes(selectedKeyword))
            : data.situationFeed;

        if (sevFilter === "critical") feed = feed.filter(f => f.severity === "critical");
        else if (sevFilter === "high") feed = feed.filter(f => f.severity === "high" || f.severity === "critical");
        else if (sevFilter === "location") feed = feed.filter(f => f.riskIndicators?.length > 0 || f.matchedKeywords.some(k => k.includes("Odisha") || k.includes("India")));

        return feed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [data, selectedKeyword, sevFilter]);

    if (isLoading || !data) {
        return (
            <div className="h-screen flex items-center justify-center bg-app-bg">
                <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-mono tracking-wider">LOADING STRATEGIC OVERVIEW...</p>
                </div>
            </div>
        );
    }

    const m = data.metrics;
    const riskColor = m.riskLevel === "critical" ? "text-red-400" : m.riskLevel === "elevated" ? "text-amber-400" : "text-teal-400";
    const riskBg = m.riskLevel === "critical" ? "bg-red-500/20 text-red-400" : m.riskLevel === "elevated" ? "bg-amber-500/20 text-amber-400" : "bg-teal-500/20 text-teal-400";
    const totalSent = m.sentiment.positive + m.sentiment.negative + m.sentiment.neutral || 1;
    const negPct = Math.round((m.sentiment.negative / totalSent) * 100);
    const topAlerts = data.criticalAlerts.slice(0, 3);

    // Check if the current visible feed is unusually critical (High activity period)
    const recentItems = filteredFeed.slice(0, 10);
    const criticalCount = recentItems.filter(f => f.importance >= 7).length;
    const isHighActivity = recentItems.length > 5 && criticalCount >= recentItems.length * 0.7;

    return (
        <div className="h-[calc(100vh-48px)] flex flex-col overflow-hidden bg-app-bg">

            {/* ── TOP BAR (compact single row) ─────────────── */}
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-slate-800/60 bg-card-bg">

                {/* Watch Topics drawer toggle */}
                <button
                    onClick={() => setDrawerOpen(true)}
                    className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-teal-300 hover:bg-slate-800/60 px-2.5 py-1.5 rounded transition-all border border-slate-700/40 hover:border-teal-500/30"
                >
                    <PanelLeftOpen size={12} />
                    WATCH TOPICS
                    {selectedKeyword && (
                        <span className="ml-1 px-1.5 py-0.5 bg-teal-500/20 text-teal-400 rounded text-[9px]">
                            {selectedKeyword}
                        </span>
                    )}
                    <ChevronRight size={11} className="text-slate-600" />
                </button>

                {/* Map View toggle */}
                <button
                    onClick={() => setMapOpen(true)}
                    className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-teal-300 hover:bg-slate-800/60 px-2.5 py-1.5 rounded transition-all border border-slate-700/40 hover:border-teal-500/30"
                >
                    <MapIcon size={12} />
                    MAP VIEW
                </button>

                <div className="w-px h-4 bg-slate-700/50" />

                {/* Mission label */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Shield size={13} className="text-teal-500 flex-shrink-0" />
                    <span className="text-[10px] font-mono text-slate-500 tracking-wider flex-shrink-0">MONITORING BRIEF</span>
                    <span className="text-[12px] font-semibold text-slate-200 truncate">
                        {data.mission?.title?.toUpperCase() || "NO ACTIVE MONITORING BRIEF"}
                    </span>
                </div>

                {/* Metrics */}
                <div className="flex items-center gap-5 flex-shrink-0">
                    {/* Alert Level */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-500">ALERT LEVEL</span>
                        <span className={`text-[13px] font-bold font-mono ${riskColor}`}>{m.riskIndex.toFixed(1)}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${riskBg}`}>{m.riskLevel.toUpperCase()}</span>
                        <InfoTooltip content={ALERT_LEVEL_TOOLTIP} side="bottom" />
                    </div>

                    {/* Active Sources */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-500">SOURCES</span>
                        <span className="text-[12px] font-mono text-teal-400">{m.activeSources}/{m.totalSources}</span>
                    </div>

                    {/* Sentiment */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-500">SENTIMENT</span>
                        <span className={`text-[12px] font-mono font-bold ${negPct > 50 ? "text-red-400" : negPct > 30 ? "text-amber-400" : "text-teal-400"}`}>
                            {negPct}% NEG
                        </span>
                        <InfoTooltip content={SENTIMENT_TOOLTIP} side="bottom" />
                    </div>

                    {/* Live pulse */}
                    <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                        <span className="text-[10px] font-mono text-teal-500">LIVE</span>
                    </div>

                    {/* Generate Report CTA */}
                    <Link href="/dashboard/reports">
                        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-semibold text-white transition-all hover:brightness-110 active:scale-95" style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)" }}>
                            <FileText size={12} />
                            Generate Report
                        </button>
                    </Link>
                </div>
            </div>

            {/* ── MAIN CONTENT (timeline + right panel) ─────── */}
            <div className="flex-1 flex overflow-hidden">

                {/* ── CENTER: TIMELINE VIEW ─────────────────── */}
                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* Timeline filter bar */}
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/40 flex-shrink-0 bg-panel-bg">
                        <div className="flex items-center gap-1.5">
                            <Radio size={11} className="text-teal-500" />
                            <span className="text-[10px] font-mono text-slate-500 tracking-wider">LIVE UPDATES</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse ml-1" />
                            {isHighActivity && (
                                <span className="text-[9px] font-mono text-amber-500/80 bg-amber-500/10 px-1.5 py-0.5 rounded ml-1 animate-pulse border border-amber-500/20 whitespace-nowrap">
                                    (High activity period)
                                </span>
                            )}
                        </div>
                        <div className="w-px h-3.5 bg-slate-700/50 mx-1 flex-shrink-0" />
                        {/* Filter buttons */}
                        {(["all", "critical", "high", "location"] as SeverityFilter[]).map(f => (
                            <button
                                key={f}
                                onClick={() => setSevFilter(f)}
                                className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${sevFilter === f
                                    ? f === "critical" ? "bg-red-500/20 text-red-400" : f === "high" ? "bg-amber-500/20 text-amber-400" : "bg-teal-500/20 text-teal-400"
                                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                                    }`}
                            >
                                {f === "all" ? "All" : f === "critical" ? "Critical" : f === "high" ? "High" : "By Location"}
                            </button>
                        ))}
                        {selectedKeyword && (
                            <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-teal-400 bg-teal-500/10 px-2 py-1 rounded">
                                FILTER: {selectedKeyword}
                                <button onClick={() => setSelectedKeyword(null)} className="ml-1 hover:text-white"><X size={9} /></button>
                            </span>
                        )}
                        <span className="ml-auto text-[10px] font-mono text-slate-600">{filteredFeed.length} ITEMS</span>
                    </div>

                    {/* Timeline list */}
                    <div className="flex-1 overflow-y-auto bg-app-bg">
                        {filteredFeed.length === 0 ? (
                            <div className="flex items-center justify-center h-40">
                                <p className="text-[12px] text-slate-600 font-mono">No items match the current filter</p>
                            </div>
                        ) : (
                            <div className="relative">
                                {/* Vertical timeline line */}
                                <div className="absolute left-[79px] top-0 bottom-0 w-px bg-slate-800/60 pointer-events-none" />

                                {filteredFeed.map(item => {
                                    const sev = SEV[item.severity as keyof typeof SEV] || SEV.routine;
                                    const isExpanded = expandedItem === item.id;
                                    return (
                                        <div key={item.id} className="flex items-start gap-0 group">
                                            {/* Time column */}
                                            <div className="w-[80px] flex-shrink-0 pt-3.5 pr-3 text-right">
                                                <span className="text-[10px] font-mono text-slate-600 leading-none">
                                                    {fmtTime(item.timestamp)}
                                                </span>
                                            </div>

                                            {/* Severity dot on the line */}
                                            <div className="flex-shrink-0 mt-3.5 z-10">
                                                <div className={`w-2 h-2 rounded-full ring-2 ring-[#080a0e] ${sev.dot}`} />
                                            </div>

                                            {/* Item card */}
                                            <div
                                                className={`flex-1 ml-3 mb-1 rounded-lg border-l-2 ${sev.border} cursor-pointer transition-all ${isExpanded ? sev.bg + " p-3" : "p-2.5 hover:bg-slate-800/20"}`}
                                                onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${sev.pill}`}>
                                                            {sev.label}
                                                        </span>
                                                        <span className="text-[12px] text-slate-200 font-medium leading-snug">
                                                            {item.title}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0 relative">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setPopoverScoreId(popoverScoreId === item.id ? null : item.id); }}
                                                            className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors text-[11px] font-mono font-bold ${item.importance >= 9 ? "text-red-400" : item.importance >= 7 ? "text-amber-400" : "text-slate-500"}`}
                                                        >
                                                            Priority: {item.importance}/10
                                                        </button>
                                                        <ChevronDown size={11} className={`text-slate-600 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                                        
                                                        {popoverScoreId === item.id && (
                                                            <div 
                                                                onClick={e => e.stopPropagation()}
                                                                className="absolute right-6 top-8 w-60 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95"
                                                            >
                                                                <div className="bg-slate-800/80 px-4 py-2.5 border-b border-slate-700/50 flex items-center justify-between">
                                                                    <span className="text-[10px] font-mono tracking-wider text-slate-300">PRIORITY BREAKDOWN</span>
                                                                    <span className={`text-[12px] font-mono font-bold ${item.importance >= 9 ? "text-red-400" : item.importance >= 7 ? "text-amber-400" : "text-slate-400"}`}>{item.importance}/10</span>
                                                                </div>
                                                                <div className="p-1">
                                                                    {(() => {
                                                                        const bk = getScoreBreakdown(item);
                                                                        return (
                                                                            <div className="flex flex-col">
                                                                                <div className="flex items-center justify-between px-3 py-2 hover:bg-slate-800/30 rounded">
                                                                                    <span className="text-[11px] text-slate-400">Source Credibility</span>
                                                                                    <span className="text-[11px] font-mono text-slate-300">{bk.sourcePts}/3 pts</span>
                                                                                </div>
                                                                                <div className="flex items-center justify-between px-3 py-2 hover:bg-slate-800/30 rounded">
                                                                                    <span className="text-[11px] text-slate-400">Watch Topic Match</span>
                                                                                    <span className="text-[11px] font-mono text-slate-300">{bk.topicPts}/3 pts</span>
                                                                                </div>
                                                                                <div className="flex items-center justify-between px-3 py-2 hover:bg-slate-800/30 rounded">
                                                                                    <span className="text-[11px] text-slate-400">Recency</span>
                                                                                    <span className="text-[11px] font-mono text-slate-300">{bk.timePts}/2 pts</span>
                                                                                </div>
                                                                                <div className="flex items-center justify-between px-3 py-2 hover:bg-slate-800/30 rounded">
                                                                                    <span className="text-[11px] text-slate-400">Sentiment Intensity</span>
                                                                                    <span className="text-[11px] font-mono text-slate-300">{bk.sentPts}/2 pts</span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Source tag + keywords row */}
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[9px] font-mono text-slate-600">{timeAgo(item.timestamp)}</span>
                                                    {item.matchedKeywords.slice(0, 3).map(kw => (
                                                        <button
                                                            key={kw}
                                                            onClick={e => { e.stopPropagation(); setSelectedKeyword(kw); }}
                                                            className="text-[9px] font-mono text-teal-500/60 hover:text-teal-400 transition-colors"
                                                        >
                                                            #{kw.replace(/\s+/g, "_")}
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Expanded summary */}
                                                {isExpanded && (
                                                    <div className="mt-2.5 space-y-2 animate-in slide-in-from-top-1">
                                                        <p className="text-[11px] text-slate-400 leading-relaxed">{cleanSnippet(item.summary, 300)}</p>
                                                        <a
                                                            href={item.url}
                                                            target="_blank"
                                                            rel="noopener"
                                                            onClick={e => e.stopPropagation()}
                                                            className="inline-flex items-center gap-1 text-[10px] text-teal-500 hover:text-teal-400"
                                                        >
                                                            View source <ExternalLink size={9} />
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── RIGHT PANEL ───────────────────────────── */}
                <div className="w-[300px] border-l border-slate-800/50 flex flex-col overflow-hidden bg-panel-bg">

                    {/* Risk Pulse chart */}
                    <div className="h-[180px] border-b border-slate-800/40 flex flex-col flex-shrink-0">
                        <div className="px-3 py-2 flex items-center gap-2">
                            <Activity size={11} className="text-amber-500" />
                            <span className="text-[10px] font-mono text-slate-500 tracking-wider">ALERT TREND — 24H</span>
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
                                    <XAxis dataKey="hour" tick={{ fill: "#475569", fontSize: 9 }} tickFormatter={(h: string) => h?.slice(11, 16) || ""} axisLine={false} tickLine={false} />
                                    <YAxis hide domain={[0, 10]} />
                                    <Tooltip
                                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "2px", fontSize: "11px", color: "#e2e8f0" }}
                                        formatter={(v: any) => [`${v ?? 0}/10`, "Alert Level"]}
                                        labelFormatter={(l: any) => String(l)?.slice(11, 16) || ""}
                                    />
                                    <Area type="monotone" dataKey="avgImportance" stroke="#f59e0b" fill="url(#riskGrad)" strokeWidth={1.5} dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        {/* Mini stats row */}
                        <div className="flex border-t border-slate-800/30 divide-x divide-slate-800/30">
                            <div className="flex-1 py-1.5 text-center">
                                <div className="text-[13px] font-mono font-bold text-slate-200">{m.totalArticles}</div>
                                <div className="text-[8px] font-mono text-slate-600 tracking-wider">ARTICLES</div>
                            </div>
                            <div className="flex-1 py-1.5 text-center">
                                <div className={`text-[13px] font-mono font-bold ${riskColor}`}>{m.avgImportance.toFixed(1)}</div>
                                <div className="text-[8px] font-mono text-slate-600 tracking-wider">AVG ALERT LEVEL</div>
                            </div>
                            <div className="flex-1 py-1.5 text-center">
                                <div className="text-[13px] font-mono font-bold text-red-400">{negPct}%</div>
                                <div className="text-[8px] font-mono text-slate-600 tracking-wider">NEGATIVE</div>
                            </div>
                        </div>
                    </div>

                    {/* Critical Alerts — top 3 only */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-800/40 flex-shrink-0">
                            <AlertTriangle size={11} className="text-red-500" />
                            <span className="text-[10px] font-mono text-slate-500 tracking-wider">CRITICAL ALERTS</span>
                            <span className="text-[9px] font-mono text-red-500/60 ml-auto">{data.criticalAlerts.length} TOTAL</span>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {topAlerts.map(alert => {
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
                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                        <span className={`text-[9px] font-mono px-1 py-0.5 ${sev.pill} rounded`}>{alert.severity.toUpperCase()}</span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-200 font-medium leading-tight">{alert.title}</p>
                                                    <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">{cleanSnippet(alert.summary, 120)}</p>
                                                </div>
                                                <ChevronDown size={11} className={`text-slate-600 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                                            </div>
                                        </button>
                                        {isExpanded && (
                                            <div className="px-3 pb-3 space-y-2 animate-in slide-in-from-top-1">
                                                {alert.claims?.slice(0, 2).map((c, i) => (
                                                    <p key={i} className="text-[10px] text-slate-400 pl-2 border-l border-slate-700">{c}</p>
                                                ))}
                                                <div className="flex flex-wrap gap-1">
                                                    {(alert.entities?.locations || []).slice(0, 3).map(l => (
                                                        <span key={l} className="text-[9px] font-mono bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded">{l}</span>
                                                    ))}
                                                </div>
                                                <a href={alert.url} target="_blank" rel="noopener" className="text-[10px] text-teal-500 hover:text-teal-400 flex items-center gap-1">
                                                    View source <ExternalLink size={9} />
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {/* View All link */}
                        {data.criticalAlerts.length > 3 && (
                            <div className="px-3 py-2 border-t border-slate-800/40 flex-shrink-0">
                                <a href="/dashboard/signals" className="text-[10px] font-mono text-teal-500 hover:text-teal-400 flex items-center gap-1 justify-center">
                                    View All {data.criticalAlerts.length} Alerts → 
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── DRAWERS & OVERLAYS ──────────────────────── */}
            <WatchTopicModal
                open={isTopicModalOpen}
                onClose={() => { setIsTopicModalOpen(false); setEditingTopic(null); }}
                onSave={handleSaveTopic}
                initialData={editingTopic}
            />
            
            <WatchTopicsDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                keywords={displayKeywords}
                selectedKeyword={selectedKeyword}
                onSelectKeyword={setSelectedKeyword}
                onAddTopic={() => { setEditingTopic(null); setIsTopicModalOpen(true); }}
                onEditTopic={(kw) => { setEditingTopic(kw); setIsTopicModalOpen(true); }}
                onPauseTopic={(kwStr) => setTopicMutations(prev => ({ 
                    ...prev, 
                    [kwStr]: { ...prev[kwStr], paused: !displayKeywords.find(k => k.keyword === kwStr)?.paused } 
                }))}
                onDeleteTopic={(kwStr) => {
                    if (selectedKeyword === kwStr) setSelectedKeyword(null);
                    setTopicMutations(prev => ({ ...prev, [kwStr]: { ...prev[kwStr], deleted: true } }));
                }}
            />
            {mapOpen && <MapViewPanel nodes={data.geoNodes} onClose={() => setMapOpen(false)} />}
        </div>
    );
}
