"use client";

import { useState, useMemo } from "react";
import {
    AlertTriangle, Radio, Check, Clock, X, ExternalLink, Loader2,
    ChevronRight, ChevronDown, Bell, Shield, Eye, TrendingUp,
    ArrowUpRight, Filter,
} from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { IntelligenceSignal } from "@/lib/types";
import { useIntelligenceData } from "@/lib/hooks/useIntelligence";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "watch"];
const SEVERITY_CONFIG: Record<string, { badge: string; border: string; dot: string; bg: string; icon: React.ReactNode; label: string }> = {
    critical: { badge: "badge-rose", border: "border-l-rose", dot: "bg-rose", bg: "bg-rose-subtle", icon: <AlertTriangle size={14} />, label: "CRITICAL" },
    high: { badge: "badge-amber", border: "border-l-amber", dot: "bg-amber", bg: "bg-amber-subtle", icon: <Shield size={14} />, label: "HIGH" },
    medium: { badge: "badge-sky", border: "border-l-sky", dot: "bg-sky", bg: "bg-sky-subtle", icon: <Eye size={14} />, label: "MEDIUM" },
    low: { badge: "badge-muted", border: "border-l-border", dot: "bg-text-muted", bg: "bg-overlay", icon: <Radio size={14} />, label: "LOW" },
    watch: { badge: "badge-muted", border: "border-l-border", dot: "bg-teal-500", bg: "bg-overlay", icon: <Eye size={14} />, label: "WATCH" },
};

export default function AlertCommandCenter() {
    const { data: intel, isLoading } = useIntelligenceData();
    const intelData = intel as { signals?: IntelligenceSignal[] } | undefined;
    // Normalize unknown severities (e.g. "watch") to "low" fallback,
    // then deduplicate by title — keep only the most-recent signal per unique title.
    // This prevents 20 identical "Article volume spike detected X%" entries.
    const allSignals = useMemo(() => {
        const normalized = (intelData?.signals || []).map(s => ({
            ...s,
            severity: SEVERITY_CONFIG[s.severity] ? s.severity : 'watch',
        }));
        const seen = new Map<string, typeof normalized[number]>();
        for (const s of normalized) {
            const key = s.title?.trim().toLowerCase() ?? s.id;
            const existing = seen.get(key);
            if (!existing || new Date(s.created_at) > new Date(existing.created_at)) {
                seen.set(key, s);
            }
        }
        return Array.from(seen.values());
    }, [intelData]);

    const [filter, setFilter] = useState<string>("all");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

    const filteredSignals = useMemo(() => {
        const filtered = filter === "all" ? allSignals : allSignals.filter(s => s.severity === filter);
        return [...filtered].sort((a, b) => {
            const oi = SEVERITY_ORDER.indexOf(a.severity);
            const oj = SEVERITY_ORDER.indexOf(b.severity);
            if (oi !== oj) return oi - oj;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
    }, [allSignals, filter]);

    // Group by severity
    const grouped = useMemo(() => {
        const groups: Record<string, IntelligenceSignal[]> = {};
        for (const sev of SEVERITY_ORDER) {
            const items = filteredSignals.filter(s => s.severity === sev);
            if (items.length > 0) groups[sev] = items;
        }
        return groups;
    }, [filteredSignals]);

    const severityCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const s of allSignals) counts[s.severity] = (counts[s.severity] || 0) + 1;
        return counts;
    }, [allSignals]);

    const [tracked, setTracked] = useState<Set<string>>(new Set());
    const [loadingSources, setLoadingSources] = useState<string | null>(null);

    const authFetch = (url: string, opts: RequestInit = {}) => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('robin_token') : null;
        return fetch(url, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
        });
    };

    const acknowledgeSignal = async (signalId: string) => {
        try {
            // Backend uses PATCH, not POST
            await authFetch(`${BASE}/api/test/signals/${signalId}/acknowledge`, { method: "PATCH" });
            setAcknowledged(prev => new Set([...prev, signalId]));
        } catch { } // Silent — still update UI optimistically
    };

    const viewSources = async (signalId: string) => {
        setLoadingSources(signalId);
        try {
            const res = await authFetch(`${BASE}/api/test/signals/${signalId}/articles`);
            const data = await res.json();
            const articles: Array<{ title: string; url: string }> = data.articles || data.data || [];
            if (articles.length === 0) {
                alert('No source articles found for this signal.');
            } else {
                // Open up to 5 source articles in new tabs
                articles.slice(0, 5).forEach(a => {
                    if (a.url) window.open(a.url, '_blank', 'noopener,noreferrer');
                });
            }
        } catch {
            alert('Could not load source articles.');
        }
        setLoadingSources(null);
    };

    const trackSignal = (signal: IntelligenceSignal) => {
        setTracked(prev => {
            const next = new Set(prev);
            if (next.has(signal.id)) next.delete(signal.id);
            else next.add(signal.id);
            return next;
        });
        // Navigate to intelligence page to see the entity/topic
        const entityName = (signal as unknown as Record<string, unknown>).entity_name as string | undefined;
        if (entityName) {
            window.location.href = `/dashboard/intelligence?entity=${encodeURIComponent(entityName)}`;
        }
    };

    if (isLoading) {
        return (
            <div className="p-6 space-y-4 animate-fade-in">
                <div className="skeleton h-8 w-64" />
                <div className="skeleton h-32" />
                <div className="skeleton h-32" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-5 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Bell size={20} className="text-text-secondary" />
                    <h1 className="text-lg font-semibold text-text-primary">Alert Command Center</h1>
                </div>
                <div className="flex items-center gap-2">
                    {SEVERITY_ORDER.map(sev => (
                        <button
                            key={sev}
                            onClick={() => setFilter(f => f === sev ? "all" : sev)}
                            className={`badge cursor-pointer transition-all ${filter === sev ? SEVERITY_CONFIG[sev].badge : "badge-muted opacity-60 hover:opacity-100"}`}
                        >
                            {severityCounts[sev] || 0} {SEVERITY_CONFIG[sev].label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Summary Strip */}
            <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>{allSignals.length} total signals</span>
                <span>•</span>
                <span className="text-rose">{severityCounts.critical || 0} critical</span>
                <span>•</span>
                <span className="text-amber">{severityCounts.high || 0} high</span>
                <span>•</span>
                <span>{acknowledged.size} acknowledged</span>
            </div>

            {/* Severity Groups */}
            {Object.entries(grouped).map(([severity, signals]) => (
                <div key={severity}>
                    {/* Group Header */}
                    <div className="flex items-center gap-2 mb-2.5">
                        <span className={`w-2.5 h-2.5 rounded-sm ${SEVERITY_CONFIG[severity]?.dot}`} />
                        <span className="section-title">{SEVERITY_CONFIG[severity]?.label}</span>
                        <span className="text-2xs text-text-muted">({signals.length})</span>
                    </div>

                    {/* Signal Cards */}
                    <div className="space-y-2 mb-5">
                        {signals.map(signal => {
                            const isExpanded = expandedId === signal.id;
                            const isAcked = acknowledged.has(signal.id);
                            const config = SEVERITY_CONFIG[signal.severity] || SEVERITY_CONFIG.low;

                            return (
                                <div
                                    key={signal.id}
                                    className={cn(
                                        "card border-l-2 transition-all",
                                        config.border,
                                        isAcked && "opacity-50",
                                        isExpanded && "ring-1 ring-border-active"
                                    )}
                                >
                                    {/* Collapsed Row */}
                                    <div
                                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-raised/50 transition-colors"
                                        onClick={() => setExpandedId(isExpanded ? null : signal.id)}
                                    >
                                        <span className={`${config.dot} w-2 h-2 rounded-full flex-shrink-0`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-text-primary font-medium">{signal.title}</p>
                                            <p className="text-2xs text-text-muted mt-0.5">
                                                {signal.signal_type?.replace(/_/g, " ")} • {formatRelative(signal.created_at)}
                                            </p>
                                        </div>
                                        <span className="font-mono text-2xs text-text-muted">
                                            {Math.round((signal.confidence || 0) * 100)}%
                                        </span>
                                        {isExpanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                                    </div>

                                    {/* Expanded Detail */}
                                    {isExpanded && (() => {
                                        const ev = (signal as unknown as Record<string, unknown>).evidence as Record<string, unknown> | undefined;
                                        const impactScore = Number(ev?.impact_score ?? 0);
                                        const relevanceReason = String(ev?.relevance_reason ?? "");
                                        const actions = (ev?.recommended_actions ?? []) as Array<{ priority: string; action: string }>;
                                        const srcBreakdown = (ev?.source_breakdown ?? []) as Array<{ source: string; count: number; sentiment: string }>;

                                        return (
                                            <div className="px-4 pb-3 border-t border-border animate-fade-in">
                                                {/* Impact Score */}
                                                {impactScore > 0 && (
                                                    <div className="flex items-center gap-2 mt-3 mb-3">
                                                        <span className="text-2xs text-text-muted uppercase tracking-wider">Impact</span>
                                                        <div className="flex items-center gap-2 flex-1">
                                                            <div className="flex-1 max-w-[140px] h-2 bg-overlay rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full rounded-full ${impactScore >= 70 ? "bg-rose" : impactScore >= 40 ? "bg-amber" : "bg-sky"}`}
                                                                    style={{ width: `${impactScore}%` }}
                                                                />
                                                            </div>
                                                            <span className={`text-xs font-bold ${impactScore >= 70 ? "text-rose" : impactScore >= 40 ? "text-amber" : "text-sky"}`}>
                                                                {impactScore}/100
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}

                                                {signal.description && (
                                                    <p className="text-sm text-text-secondary mb-3 leading-relaxed">
                                                        {signal.description}
                                                    </p>
                                                )}

                                                {/* WHY THIS MATTERS */}
                                                {relevanceReason && (
                                                    <div className="card-raised p-3 mb-3 border-l-2 border-l-accent">
                                                        <p className="text-2xs text-accent uppercase tracking-wider font-semibold mb-1">Why This Matters To You</p>
                                                        <p className="text-xs text-text-secondary leading-relaxed">{relevanceReason}</p>
                                                    </div>
                                                )}

                                                {/* Source Breakdown */}
                                                {srcBreakdown.length > 0 && (
                                                    <div className="mb-3">
                                                        <p className="text-2xs text-text-muted mb-1.5 uppercase tracking-wider">Source Breakdown</p>
                                                        <div className="space-y-1">
                                                            {srcBreakdown.map((src, i) => (
                                                                <div key={i} className="flex items-center gap-2 text-xs">
                                                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${src.sentiment === "negative" ? "bg-rose" : "bg-text-muted"}`} />
                                                                    <span className="text-text-primary flex-1 truncate">{src.source}</span>
                                                                    <span className="font-mono text-text-muted">{src.count} articles</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Recommended Actions */}
                                                {actions.length > 0 && (
                                                    <div className="mb-3">
                                                        <p className="text-2xs text-text-muted mb-1.5 uppercase tracking-wider">Recommended Actions</p>
                                                        <div className="space-y-1.5">
                                                            {actions.map((a, i) => (
                                                                <div key={i} className="flex items-start gap-2 text-xs">
                                                                    <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${a.priority === "urgent" ? "bg-rose" : a.priority === "watch" ? "bg-amber" : "bg-emerald"}`} />
                                                                    <span className="text-text-secondary">{a.action}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Action Buttons */}
                                                <div className="flex items-center gap-2 mt-2">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); acknowledgeSignal(signal.id); }}
                                                        disabled={isAcked}
                                                        className={`btn btn-ghost text-2xs ${isAcked ? 'opacity-50' : 'hover:text-emerald-400'}`}
                                                    >
                                                        <Check size={12} /> {isAcked ? "Acknowledged" : "Acknowledge"}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); viewSources(signal.id); }}
                                                        disabled={loadingSources === signal.id}
                                                        className="btn btn-ghost text-2xs hover:text-sky-400"
                                                    >
                                                        <Eye size={12} /> {loadingSources === signal.id ? 'Loading...' : 'View Sources'}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); trackSignal(signal); }}
                                                        className={`btn btn-ghost text-2xs ${tracked.has(signal.id) ? 'text-amber-400' : 'hover:text-amber-400'}`}
                                                    >
                                                        <TrendingUp size={12} /> {tracked.has(signal.id) ? 'Tracking ✓' : 'Track'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Empty State */}
            {Object.keys(grouped).length === 0 && (
                <div className="card p-12 text-center">
                    <Bell size={40} className="text-text-muted mx-auto mb-3 opacity-30" />
                    <p className="text-sm text-text-muted">No signals detected yet.</p>
                    <p className="text-2xs text-text-muted mt-1">Signals will appear once the analysis pipeline processes content.</p>
                </div>
            )}

            {/* Timeline Footer */}
            {allSignals.length > 0 && (
                <div className="card p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Clock size={14} className="text-text-secondary" />
                        <h3 className="section-title">Timeline</h3>
                    </div>
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto no-scrollbar">
                        {allSignals.slice(0, 15).map(s => (
                            <div key={`tl-${s.id}`} className="flex items-center gap-3 px-2 py-1.5 text-xs">
                                <span className="text-2xs text-text-muted w-14 flex-shrink-0 font-mono">
                                    {new Date(s.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_CONFIG[s.severity]?.dot || "bg-text-muted"}`} />
                                <span className="text-text-secondary truncate">{s.title}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
