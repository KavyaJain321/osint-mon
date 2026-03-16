"use client";

import { useState, useMemo } from "react";
import { Database, RefreshCw, Wifi, WifiOff, AlertTriangle, Star, Plus, Trash2, ToggleLeft, ToggleRight, HelpCircle, X } from "lucide-react";
import { testApi } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useSources } from "@/lib/hooks/useIntelligence";

/* ── Types ─────────────────────────────────────────────── */

interface SourceData {
    id: string;
    name: string;
    url: string;
    source_type: string;
    is_active: boolean;
    scrape_success_count: number | null;
    scrape_fail_count: number | null;
    last_scraped_at: string | null;
}

type SourceStatus = "premium" | "healthy" | "watch" | "degraded" | "no_data";

interface SourceQuality {
    source_id: string;
    name: string;
    url: string;
    type: string;
    is_active: boolean;
    reliability: number | null;
    hit_rate: number | null;
    status: SourceStatus;
    article_count: number;
    last_checked: string | null;
}

/* ── Helpers ───────────────────────────────────────────── */

function computeReliability(successCount: number | null, failCount: number | null): number | null {
    if (successCount === null && failCount === null) return null;
    const s = successCount ?? 0;
    const f = failCount ?? 0;
    const total = s + f;
    if (total === 0) return null;
    return s / total;
}

function getSourceStatus(reliability: number | null, successCount: number | null): SourceStatus {
    if (reliability === null) return "no_data";
    if (reliability >= 0.95 && (successCount ?? 0) >= 10) return "premium";
    if (reliability >= 0.80) return "healthy";
    if (reliability >= 0.60) return "watch";
    return "degraded";
}

const STATUS_CONFIG: Record<SourceStatus, { class: string; icon: typeof Star; label: string }> = {
    premium: { class: "badge-emerald", icon: Star, label: "Premium" },
    healthy: { class: "badge-sky", icon: Wifi, label: "Healthy" },
    watch: { class: "badge-amber", icon: AlertTriangle, label: "Watch" },
    degraded: { class: "badge-rose", icon: WifiOff, label: "Degraded" },
    no_data: { class: "badge-muted", icon: HelpCircle, label: "No Data" },
};

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/* ── Page ──────────────────────────────────────────────── */

export default function SourcesPage() {
    const { data: rawSources, isLoading: loading, refetch } = useSources() as {
        data: { data?: SourceData[] } | undefined;
        isLoading: boolean;
        refetch: () => void;
    };
    const [filter, setFilter] = useState<"all" | SourceStatus>("all");
    const [showAddForm, setShowAddForm] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<SourceQuality>>>({});

    const sources: SourceQuality[] = useMemo(() => {
        return (rawSources?.data ?? []).map(s => {
            const reliability = computeReliability(s.scrape_success_count, s.scrape_fail_count);
            const status = getSourceStatus(reliability, s.scrape_success_count);
            const base: SourceQuality = {
                source_id: s.id,
                name: s.name,
                url: s.url,
                type: s.source_type,
                is_active: s.is_active,
                reliability,
                hit_rate: reliability,
                status,
                article_count: s.scrape_success_count ?? 0,
                last_checked: s.last_scraped_at,
            };
            // Apply local overrides (e.g., toggle active)
            return { ...base, ...localOverrides[s.id] };
        });
    }, [rawSources, localOverrides]);

    const toggleActive = async (sourceId: string) => {
        try {
            await fetch(`${BASE}/api/test/sources/${sourceId}/toggle`, { method: "PATCH" });
            const current = sources.find(s => s.source_id === sourceId);
            setLocalOverrides(prev => ({ ...prev, [sourceId]: { is_active: !(current?.is_active) } }));
        } catch (e) { console.error("Toggle failed", e); }
    };

    const deleteSource = async (sourceId: string) => {
        try {
            await fetch(`${BASE}/api/test/sources/${sourceId}`, { method: "DELETE" });
            refetch();
            setDeleteConfirm(null);
        } catch (e) { console.error("Delete failed", e); }
    };

    const triggerScrape = async (sourceId: string) => {
        try {
            await testApi.scrape(sourceId);
        } catch (e) { console.error("Scrape failed", e); }
    };

    const filtered = filter === "all" ? sources : sources.filter(s => s.status === filter);

    const counts: Record<SourceStatus, number> = {
        premium: sources.filter(s => s.status === "premium").length,
        healthy: sources.filter(s => s.status === "healthy").length,
        watch: sources.filter(s => s.status === "watch").length,
        degraded: sources.filter(s => s.status === "degraded").length,
        no_data: sources.filter(s => s.status === "no_data").length,
    };

    return (
        <div className="p-4 max-w-6xl">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h1 className="text-xl font-semibold text-text-primary">Sources</h1>
                    <p className="text-sm text-text-muted mt-0.5">{sources.length} monitored sources ranked by reliability</p>
                </div>
                <button
                    onClick={() => setShowAddForm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/20 text-accent text-sm rounded-md hover:bg-accent/30 transition-colors"
                >
                    <Plus size={14} /> Add Source
                </button>
            </div>

            {/* Status summary cards */}
            {!loading && (
                <div className="grid grid-cols-5 gap-2 mb-4">
                    {(["premium", "healthy", "watch", "degraded", "no_data"] as const).map(status => {
                        const cfg = STATUS_CONFIG[status];
                        const Icon = cfg.icon;
                        return (
                            <button
                                key={status}
                                onClick={() => setFilter(filter === status ? "all" : status)}
                                className={cn(
                                    "stat-card text-left transition-all",
                                    filter === status && "ring-2 ring-accent"
                                )}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="stat-label">{cfg.label}</span>
                                    <Icon size={13} className={cn(
                                        status === "premium" ? "text-emerald" :
                                            status === "healthy" ? "text-sky" :
                                                status === "watch" ? "text-amber" :
                                                    status === "degraded" ? "text-rose" : "text-text-muted"
                                    )} />
                                </div>
                                <div className="stat-value text-xl">{counts[status]}</div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Sources table */}
            <div className="card p-0 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-border bg-raised">
                            <th className="th text-left">Source</th>
                            <th className="th text-left">Type</th>
                            <th className="th text-left">Status</th>
                            <th className="th text-right">Reliability</th>
                            <th className="th text-right">Articles</th>
                            <th className="th text-left">Last Checked</th>
                            <th className="th text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 6 }).map((_, i) => (
                                <tr key={i} className="border-b border-border/30">
                                    {Array.from({ length: 7 }).map((_, j) => (
                                        <td key={j} className="td"><div className="skeleton h-4 rounded" /></td>
                                    ))}
                                </tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="td text-center py-12 text-text-muted">
                                    <Database size={28} className="mx-auto mb-2 opacity-30" />
                                    No sources found
                                </td>
                            </tr>
                        ) : (
                            filtered.map(s => {
                                const cfg = STATUS_CONFIG[s.status ?? "no_data"];
                                const Icon = cfg.icon;
                                return (
                                    <tr key={s.source_id} className={cn("table-row", !s.is_active && "opacity-50")}>
                                        <td className="td">
                                            <div>
                                                <div className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                                                    {s.name}
                                                    {!s.is_active && <span className="text-2xs badge badge-muted">Inactive</span>}
                                                </div>
                                                <div className="text-xs text-text-muted truncate max-w-[200px]">{s.url}</div>
                                            </div>
                                        </td>
                                        <td className="td">
                                            <span className="badge badge-muted">{s.type}</span>
                                        </td>
                                        <td className="td">
                                            <span className={cn("badge", cfg.class, "gap-1")}>
                                                <Icon size={10} />
                                                {cfg.label}
                                            </span>
                                        </td>
                                        <td className="td text-right">
                                            {s.reliability === null ? (
                                                <span className="text-xs text-text-muted italic">No scrape data yet</span>
                                            ) : (
                                                <div className="flex items-center justify-end gap-2">
                                                    <div className="w-12 h-1.5 bg-overlay rounded-full overflow-hidden">
                                                        <div
                                                            className={cn(
                                                                "h-full rounded-full",
                                                                s.reliability >= 0.8 ? "bg-emerald" :
                                                                    s.reliability >= 0.6 ? "bg-amber" : "bg-rose"
                                                            )}
                                                            style={{ width: `${(s.reliability ?? 0) * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="font-mono text-xs text-text-secondary w-8 text-right">
                                                        {Math.round((s.reliability ?? 0) * 100)}%
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="td text-right font-mono text-sm">{s.article_count ?? 0}</td>
                                        <td className="td text-text-muted text-xs">
                                            {s.last_checked ? formatRelative(s.last_checked) : "Never"}
                                        </td>
                                        <td className="td">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => toggleActive(s.source_id)}
                                                    title={s.is_active ? "Deactivate" : "Activate"}
                                                    className="p-1 rounded hover:bg-overlay transition-colors"
                                                >
                                                    {s.is_active
                                                        ? <ToggleRight size={16} className="text-emerald" />
                                                        : <ToggleLeft size={16} className="text-text-muted" />
                                                    }
                                                </button>
                                                <button
                                                    onClick={() => triggerScrape(s.source_id)}
                                                    title="Trigger Scrape"
                                                    className="p-1 rounded hover:bg-overlay transition-colors"
                                                >
                                                    <RefreshCw size={14} className="text-sky" />
                                                </button>
                                                {deleteConfirm === s.source_id ? (
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => deleteSource(s.source_id)}
                                                            className="text-2xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
                                                        >
                                                            Confirm
                                                        </button>
                                                        <button
                                                            onClick={() => setDeleteConfirm(null)}
                                                            className="text-2xs px-1 py-0.5 text-text-muted hover:text-text-secondary"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => setDeleteConfirm(s.source_id)}
                                                        title="Delete"
                                                        className="p-1 rounded hover:bg-overlay transition-colors"
                                                    >
                                                        <Trash2 size={14} className="text-text-muted hover:text-rose" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add Source Modal */}
            {showAddForm && <AddSourceModal onClose={() => setShowAddForm(false)} onAdded={() => { setShowAddForm(false); refetch(); }} />}
        </div>
    );
}

/* ── Add Source Modal ──────────────────────────────────── */

function AddSourceModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [sourceType, setSourceType] = useState("rss");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !url) return;
        setSubmitting(true);
        try {
            const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            await fetch(`${BASE}/api/test/sources`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, url, source_type: sourceType }),
            });
            onAdded();
        } catch (err) {
            console.error("Add source failed", err);
        }
        setSubmitting(false);
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-raised border border-border rounded-lg p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-text-primary">Add New Source</h2>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="text-xs text-text-muted block mb-1">Source Name</label>
                        <input
                            type="text" value={name} onChange={e => setName(e.target.value)}
                            placeholder="e.g. Reuters Top News"
                            className="w-full px-3 py-2 bg-overlay border border-border rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-text-muted block mb-1">URL</label>
                        <input
                            type="url" value={url} onChange={e => setUrl(e.target.value)}
                            placeholder="https://feeds.reuters.com/reuters/topNews"
                            className="w-full px-3 py-2 bg-overlay border border-border rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-text-muted block mb-1">Type</label>
                        <select
                            value={sourceType} onChange={e => setSourceType(e.target.value)}
                            className="w-full px-3 py-2 bg-overlay border border-border rounded-md text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                        >
                            <option value="rss">RSS Feed</option>
                            <option value="html">HTML Scraper</option>
                            <option value="browser">Browser Scraper</option>
                            <option value="pdf">PDF</option>
                            <option value="youtube">TV News</option>
                        </select>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">Cancel</button>
                        <button
                            type="submit" disabled={submitting || !name || !url}
                            className="px-4 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent/90 disabled:opacity-50 transition-colors"
                        >
                            {submitting ? "Adding…" : "Add Source"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
