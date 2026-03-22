"use client";

import { useState, useMemo } from "react";
import { Users, Search, Shield, TrendingUp, TrendingDown, Minus, ChevronRight, BarChart3 } from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useIntelligenceData } from "@/lib/hooks/useIntelligence";
import EntityDossier from "@/components/dashboard/EntityDossier";

interface Entity {
    name: string;
    type: string;
    mentions: number;
    influence: number;
    relevance_score?: number;
    relevance_reason?: string;
    connected_stories?: Array<{
        theme: string;
        article_count: number;
        sentiment: string;
        sample_title: string;
    }>;
    sentiment: Record<string, number | string>;
    risk_tags: string[];
    relationships: Array<{ entity_name: string; strength: number }>;
    first_seen: string;
    last_seen: string;
}

const TYPE_ICONS: Record<string, string> = {
    person: "👤",
    org: "🏢",
    organization: "🏢",
    location: "📍",
    government: "🏛️",
    media: "📰",
    regulation: "⚖️",
    product: "📦",
};

const TYPE_BADGE: Record<string, string> = {
    person: "badge-sky",
    org: "badge-violet",
    organization: "badge-violet",
    location: "badge-emerald",
    regulation: "badge-amber",
    product: "badge-muted",
};

type SortMode = "relevance" | "influence" | "mentions";

export default function EntitiesPage() {
    const { data: intelData, isLoading: loading } = useIntelligenceData() as {
        data: { entity_profiles?: Entity[] } | undefined;
        isLoading: boolean;
    };
    const entities = intelData?.entity_profiles ?? [];
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("ALL");
    const [sortMode, setSortMode] = useState<SortMode>("relevance");
    const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

    const entityTypes = ["ALL", ...Array.from(new Set(entities.map(e => e.type).filter(Boolean)))];

    const filtered = useMemo(() => {
        let list = entities.filter(e => {
            const matchSearch = !search || e.name?.toLowerCase().includes(search.toLowerCase());
            const matchType = typeFilter === "ALL" || e.type === typeFilter;
            return matchSearch && matchType;
        });

        // Sort
        if (sortMode === "relevance") list.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
        else if (sortMode === "influence") list.sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0));
        else list.sort((a, b) => (b.mentions ?? 0) - (a.mentions ?? 0));

        return list;
    }, [entities, search, typeFilter, sortMode]);

    const dominantSentiment = (sent: Record<string, number | string>) => {
        if (!sent) return "neutral";
        const { trend, ...counts } = sent;
        const numericEntries = Object.entries(counts).filter(([, v]) => typeof v === 'number') as [string, number][];
        if (numericEntries.length === 0) return "neutral";
        return numericEntries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";
    };

    const sentimentDot = (s: string) =>
        s === "negative" ? "bg-rose" : s === "positive" ? "bg-emerald" : "bg-text-muted";

    const sentimentIcon = (s: string) =>
        s === "negative" ? <TrendingDown size={12} /> : s === "positive" ? <TrendingUp size={12} /> : <Minus size={12} />;

    return (
        <div className="p-6 space-y-5 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Users size={20} className="text-text-secondary" />
                    <h1 className="text-lg font-semibold text-text-primary">Entities</h1>
                    <span className="text-xs text-text-muted">({entities.length} tracked)</span>
                </div>
                {/* Sort */}
                <div className="flex items-center gap-1 text-xs">
                    {(["relevance", "influence", "mentions"] as SortMode[]).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSortMode(mode)}
                            className={cn(
                                "px-2.5 py-1 rounded-md font-medium transition-colors capitalize",
                                sortMode === mode ? "bg-overlay text-text-primary" : "text-text-muted hover:text-text-secondary"
                            )}
                        >
                            {mode}
                        </button>
                    ))}
                </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 max-w-xs">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        className="input !pl-8"
                        placeholder="Search entities…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-1">
                    {entityTypes.slice(0, 6).map(t => (
                        <button
                            key={t}
                            onClick={() => setTypeFilter(t)}
                            className={cn(
                                "px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize",
                                typeFilter === t
                                    ? "bg-accent text-white"
                                    : "bg-raised text-text-secondary hover:text-text-primary border border-border"
                            )}
                        >
                            {t.toLowerCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stats */}
            {!loading && (
                <div className="grid grid-cols-4 gap-2">
                    <div className="stat-card"><span className="stat-label">Total</span><span className="stat-value">{entities.length}</span></div>
                    <div className="stat-card"><span className="stat-label">High Relevance</span><span className="stat-value text-emerald">{entities.filter(e => (e.relevance_score ?? 0) >= 70).length}</span></div>
                    <div className="stat-card"><span className="stat-label">High Influence</span><span className="stat-value">{entities.filter(e => (e.influence ?? 0) >= 70).length}</span></div>
                    <div className="stat-card"><span className="stat-label">Risk Tagged</span><span className="stat-value text-rose">{entities.filter(e => e.risk_tags?.length > 0).length}</span></div>
                </div>
            )}

            {/* Entity Cards Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="skeleton h-40 rounded-lg" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="card p-12 text-center">
                    <Users size={40} className="text-text-muted mx-auto mb-3 opacity-30" />
                    <p className="text-sm text-text-muted">No entities found</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filtered.slice(0, 30).map(entity => {
                        const dom = dominantSentiment(entity.sentiment);
                        const relevance = entity.relevance_score ?? 0;
                        const topStory = entity.connected_stories?.[0];

                        return (
                            <div
                                key={entity.name}
                                onClick={() => setSelectedEntity(entity)}
                                className="card p-4 cursor-pointer hover:border-border-active hover:bg-raised/50 transition-all group"
                            >
                                {/* Top Row: Icon + Name + Relevance */}
                                <div className="flex items-start gap-3 mb-2.5">
                                    <span className="text-lg flex-shrink-0">{TYPE_ICONS[entity.type?.toLowerCase()] || "•"}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-bright transition-colors">
                                            {entity.name}
                                        </p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className={cn("badge text-2xs", TYPE_BADGE[entity.type?.toLowerCase()] || "badge-muted")}>
                                                {entity.type}
                                            </span>
                                            <span className={cn("flex items-center gap-0.5 text-2xs", dom === "negative" ? "text-rose" : dom === "positive" ? "text-emerald" : "text-text-muted")}>
                                                {sentimentIcon(dom)} {dom}
                                            </span>
                                        </div>
                                    </div>
                                    {/* Relevance Score */}
                                    <div className="text-right flex-shrink-0">
                                        <span className={cn(
                                            "text-lg font-bold",
                                            relevance >= 70 ? "text-emerald" : relevance >= 40 ? "text-amber" : "text-text-muted"
                                        )}>
                                            {relevance}
                                        </span>
                                        <p className="text-2xs text-text-muted">relevance</p>
                                    </div>
                                </div>

                                {/* WHY THIS MATTERS snippet (2 lines max) */}
                                {entity.relevance_reason && (
                                    <p className="text-2xs text-text-secondary leading-relaxed mb-2 truncate-2">
                                        {entity.relevance_reason}
                                    </p>
                                )}

                                {/* Bottom Row: mentions + top story + arrow */}
                                <div className="flex items-center justify-between text-2xs text-text-muted pt-2 border-t border-border/50">
                                    <span className="font-mono">{entity.mentions} mentions</span>
                                    {topStory && (
                                        <span className="truncate max-w-[140px]">{topStory.theme}</span>
                                    )}
                                    <ChevronRight size={12} className="text-text-muted group-hover:text-accent transition-colors" />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Entity Dossier Panel */}
            {selectedEntity && (
                <EntityDossier entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
            )}
        </div>
    );
}
