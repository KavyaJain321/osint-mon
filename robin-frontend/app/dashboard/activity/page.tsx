"use client";

import { useState, useMemo, useCallback } from "react";
import {
    Search, Clock, AlertTriangle, ChevronLeft, ChevronRight,
    LayoutGrid, List, ExternalLink, TrendingDown, TrendingUp, Minus, Trash2,
} from "lucide-react";
import { formatRelative, cn, cleanSnippet } from "@/lib/utils";
import type { Article } from "@/lib/types";
import { useContent } from "@/lib/hooks/useIntelligence";
import { contentApi } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import ContentDetail, { detectContentType, TYPE_ICONS, TYPE_GRADIENTS } from "@/components/dashboard/ContentDetail";
import { InfoTooltip, PriorityTooltip } from "@/components/dashboard/InfoTooltip";

function getDomain(url?: string): string {
    if (!url) return "";
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

type ContentType = "all" | "article" | "youtube" | "pdf" | "govt" | "social";
type SortOption = "importance" | "recency" | "sentiment";
type ViewMode = "grid" | "list";

const CONTENT_TABS: { id: ContentType; label: string; emoji: string }[] = [
    { id: "all", label: "All", emoji: "📋" },
    { id: "article", label: "Web Articles", emoji: "🌐" },
    { id: "youtube", label: "TV News", emoji: "📺" },
    { id: "govt", label: "Notifications", emoji: "📢" },
];

const ITEMS_PER_PAGE = 20;

export default function ContentFeedPage() {
    const { data: contentRes, isLoading: loading } = useContent(200) as {
        data: { data?: Article[] } | Article[] | undefined;
        isLoading: boolean;
    };
    // Handle both { data: [...] } and raw array
    const articles = useMemo(() => {
        if (!contentRes) return [];
        if (Array.isArray(contentRes)) return contentRes;
        if (Array.isArray((contentRes as Record<string, unknown>).data)) {
            return ((contentRes as { data: Article[] }).data).map(a => ({
                ...a,
                // content_items stores matched_keywords as comma-separated text
                matched_keywords: Array.isArray(a.matched_keywords)
                    ? a.matched_keywords
                    : typeof a.matched_keywords === 'string'
                        ? (a.matched_keywords as string).split(',').map(k => k.trim()).filter(Boolean)
                        : [],
            }));
        }
        return [];
    }, [contentRes]);

    const [contentFilter, setContentFilter] = useState<ContentType>("all");
    const [sortBy, setSortBy] = useState<SortOption>("importance");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
    const queryClient = useQueryClient();

    const handleDelete = useCallback(async (e: React.MouseEvent, article: Article) => {
        e.stopPropagation(); // Prevent opening the detail panel
        if (!confirm(`Delete "${article.title?.substring(0, 80)}..."?\n\nThis will permanently remove this article.`)) return;
        try {
            await contentApi.delete(article.id);
            queryClient.invalidateQueries({ queryKey: ["content"] });
        } catch (err) {
            alert('Failed to delete article. Please try again.');
        }
    }, [queryClient]);

    // Add content type to each article
    const articlesWithType = useMemo(() => {
        return articles.map(a => ({
            ...a,
            _contentType: detectContentType(a)
        }));
    }, [articles]);

    // Content type counts
    const typeCounts = useMemo(() => {
        const counts: Record<string, number> = { all: articles.length };
        for (const a of articlesWithType) {
            counts[a._contentType] = (counts[a._contentType] || 0) + 1;
        }
        return counts;
    }, [articles, articlesWithType]);

    // Filtered + sorted
    const filtered = useMemo(() => {
        let result = [...articlesWithType];

        // Content type filter
        if (contentFilter !== "all") {
            result = result.filter(a => a._contentType === contentFilter);
        }

        // For video/youtube content: only show fully processed items.
        // The backend already filters these, but guard again on the frontend
        // in case of cached/stale data.
        result = result.filter(a => {
            if (a._contentType !== "youtube" && a._contentType !== "video") return true;
            const ps = a.type_metadata?.processing_status;
            return ps === "complete";
        });

        // Search
        if (search.trim()) {
            const kw = search.toLowerCase();
            result = result.filter(a =>
                a.title?.toLowerCase().includes(kw) ||
                a.analysis?.summary?.toLowerCase().includes(kw) ||
                a.matched_keywords?.some(k => k.toLowerCase().includes(kw))
            );
        }

        // Sort
        if (sortBy === "importance") {
            result.sort((a, b) => (b.analysis?.importance_score ?? 0) - (a.analysis?.importance_score ?? 0));
        } else if (sortBy === "sentiment") {
            const order: Record<string, number> = { negative: 0, neutral: 1, positive: 2 };
            result.sort((a, b) => (order[a.analysis?.sentiment ?? "neutral"] ?? 1) - (order[b.analysis?.sentiment ?? "neutral"] ?? 1));
        } else {
            result.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
        }

        return result;
    }, [articlesWithType, contentFilter, search, sortBy]);

    // Hero = most important article
    const hero = filtered[0];
    const feedItems = filtered.slice(1);

    // Pagination
    const totalPages = Math.ceil(feedItems.length / ITEMS_PER_PAGE);
    const pagedItems = feedItems.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    const sentimentIcon = (s?: string) =>
        s === "negative" ? <TrendingDown size={10} /> : s === "positive" ? <TrendingUp size={10} /> : <Minus size={10} />;

    const sentimentColor = (s?: string) =>
        s === "negative" ? "text-rose" : s === "positive" ? "text-emerald" : "text-text-muted";

    return (
        <div className="p-6 space-y-5 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <List size={20} className="text-text-secondary" />
                    <h1 className="text-lg font-semibold text-text-primary">Content Feed</h1>
                    <span className="text-xs text-text-muted">{articles.length} items</span>
                </div>
                <div className="relative max-w-xs w-48">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        className="input !pl-8 text-xs"
                        placeholder="Search content…"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                    />
                </div>
            </div>

            {/* Content-Type Tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
                {CONTENT_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => { setContentFilter(tab.id); setPage(1); }}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                            contentFilter === tab.id
                                ? "bg-accent text-white shadow-sm"
                                : "bg-raised text-text-secondary hover:text-text-primary border border-border"
                        )}
                    >
                        <span>{tab.emoji}</span>
                        {tab.label}
                        {(typeCounts[tab.id] ?? 0) > 0 && (
                            <span className={cn(
                                "text-2xs font-mono ml-0.5",
                                contentFilter === tab.id ? "text-white/70" : "text-text-muted"
                            )}>
                                {typeCounts[tab.id]}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Sort + View Controls */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted font-medium">Sort by:</span>
                    <select
                        className="input !py-1 !pl-2 !pr-8 text-xs bg-surface border border-border rounded-md text-text-primary focus:ring-1 focus:ring-accent outline-none cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2210%22%20height%3D%226%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M0%200l5%206%205-6z%22%20fill%3D%22%23888%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px_6px] bg-[position:right_8px_center] bg-no-repeat"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                    >
                        <option value="recency">Latest First</option>
                        <option value="importance">Most Important</option>
                        <option value="sentiment">Most Negative</option>
                    </select>
                </div>
                <div className="flex items-center gap-1 bg-overlay rounded-md p-0.5">
                    <button
                        onClick={() => setViewMode("grid")}
                        className={cn("p-1 rounded", viewMode === "grid" ? "bg-raised text-text-primary" : "text-text-muted")}
                    >
                        <LayoutGrid size={14} />
                    </button>
                    <button
                        onClick={() => setViewMode("list")}
                        className={cn("p-1 rounded", viewMode === "list" ? "bg-raised text-text-primary" : "text-text-muted")}
                    >
                        <List size={14} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="space-y-3">
                    <div className="skeleton h-48 rounded-lg" />
                    <div className="grid grid-cols-2 gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="skeleton h-40 rounded-lg" />
                        ))}
                    </div>
                </div>
            ) : filtered.length === 0 ? (
                <div className="card p-12 text-center">
                    <List size={40} className="text-text-muted mx-auto mb-3 opacity-30" />
                    <p className="text-sm text-text-muted">{search ? "No content matches your search" : "No content yet — trigger a scrape to collect data"}</p>
                </div>
            ) : (
                <>
                    {/* ── Hero Card ─────────────────────────── */}
                    {hero && page === 1 && (
                        <div
                            onClick={() => setSelectedArticle(hero)}
                            className={cn(
                                "card overflow-hidden cursor-pointer group transition-all hover:ring-1 hover:ring-border-active",
                                (hero.analysis?.importance_score ?? 0) >= 9 && "ring-1 ring-rose/30"
                            )}
                        >
                            <div className={cn("relative h-44 overflow-hidden bg-gradient-to-br", TYPE_GRADIENTS[detectContentType(hero)] || "from-blue-600/20 to-indigo-700/20")}>
                                {hero.type_metadata?.image_url ? (
                                    <img
                                        src={hero.type_metadata.image_url}
                                        alt={hero.title}
                                        className="absolute inset-0 w-full h-full object-cover"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                ) : ((hero.source_url || hero.url) && (detectContentType(hero) === 'article' || !detectContentType(hero))) ? (
                                    <div className="absolute inset-0 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
                                            <img
                                                src={`https://www.google.com/s2/favicons?domain=${getDomain(hero.source_url || hero.url)}&sz=128`}
                                                alt={hero.source_name || "Source Logo"}
                                                className="w-16 h-16 object-contain bg-slate-900/50 rounded-xl shadow-sm p-1.5 backdrop-blur-sm"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center opacity-15">
                                        <span className="text-7xl">{detectContentType(hero) === "youtube" ? "📺" : "🌐"}</span>
                                    </div>
                                )}
                                {(hero.analysis?.importance_score ?? 0) >= 7 && (
                                    <span
                                        onClick={(e) => e.stopPropagation()}
                                        className="absolute top-3 left-3"
                                    >
                                        <InfoTooltip
                                            content={<PriorityTooltip score={hero.analysis?.importance_score ?? 0} method={(hero as any).analysis?.analyzer_used} />}
                                            side="bottom"
                                        >
                                            <span className={cn(
                                                "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer",
                                                (hero.analysis?.importance_score ?? 0) >= 9 ? "bg-rose text-white" : "bg-amber text-black"
                                            )}>
                                                ⚡ {hero.analysis?.importance_score}/10
                                            </span>
                                        </InfoTooltip>
                                    </span>
                                )}
                                <button
                                    onClick={(e) => handleDelete(e, hero)}
                                    className="absolute bottom-3 right-3 p-1.5 rounded-md bg-black/50 text-white/70 hover:bg-rose/80 hover:text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm z-10"
                                    title="Delete article"
                                >
                                    <Trash2 size={14} />
                                </button>
                                <span className="absolute top-3 right-3 badge badge-muted backdrop-blur-sm">
                                    {TYPE_ICONS[detectContentType(hero)]?.label || "Article"}
                                </span>
                            </div>
                            <div className="p-4">
                                <h2 className="text-base font-semibold text-text-primary group-hover:text-accent-bright transition-colors mb-2 leading-snug">
                                    {hero.title}
                                </h2>
                                {hero.analysis?.summary && (
                                    <p className="text-xs text-text-secondary line-clamp-2 mb-3">{cleanSnippet(hero.analysis.summary, 200)}</p>
                                )}
                                <div className="flex items-center gap-3 text-2xs text-text-muted">
                                    <span className="flex items-center gap-1"><Clock size={10} /> {formatRelative(hero.published_at)}</span>
                                    {hero.analysis?.sentiment && (
                                        <span className={cn("flex items-center gap-0.5", sentimentColor(hero.analysis.sentiment))}>
                                            {sentimentIcon(hero.analysis.sentiment)} {hero.analysis.sentiment}
                                        </span>
                                    )}
                                    {hero.matched_keywords?.slice(0, 2).map(kw => (
                                        <span key={kw} className="badge badge-muted text-2xs">{kw}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Card Grid / List ─────────────────── */}
                    {viewMode === "grid" ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {pagedItems.map(article => {
                                const cType = detectContentType(article);
                                const imp = article.analysis?.importance_score ?? 0;
                                return (
                                    <div
                                        key={article.id}
                                        onClick={() => setSelectedArticle(article)}
                                        className={cn(
                                            "card overflow-hidden cursor-pointer group transition-all hover:ring-1 hover:ring-border-active",
                                            imp >= 9 && "ring-1 ring-rose/20",
                                            imp >= 7 && imp < 9 && "ring-1 ring-amber/20",
                                        )}
                                    >
                                        {/* Thumbnail inner container */}
                                        <div className="relative">
                                            <div className={cn("h-32 w-full flex items-center justify-center transition-all group-hover:bg-gradient-to-br opacity-80 group-hover:opacity-100", TYPE_GRADIENTS[cType] || "from-blue-600/20 to-indigo-700/20")}>
                                                {article.type_metadata?.image_url ? (
                                                    <img
                                                        src={article.type_metadata.image_url}
                                                        alt={article.title}
                                                        className="absolute inset-0 w-full h-full object-cover"
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                    />
                                                ) : article.type_metadata?.is_grouped ? (
                                                    <div className="flex flex-col items-center justify-center space-y-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                                        <span className="text-4xl filter drop-shadow">📄</span>
                                                        <span className="text-xs font-semibold text-white bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm">PDF Edition</span>
                                                    </div>
                                                ) : ((article.source_url || article.url) && getDomain(article.source_url || article.url) !== "newspaper-intel" && (cType === 'newspaper' || cType === 'article' || !cType)) ? (
                                                    <div className="flex flex-col items-center justify-center space-y-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                                        <img
                                                            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(getDomain(article.source_url || article.url))}&sz=128`}
                                                            alt={article.source_name || "Source Logo"}
                                                            className="w-12 h-12 object-contain bg-slate-900/50 rounded-lg shadow-sm p-1 backdrop-blur-sm"
                                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="text-4xl filter drop-shadow opacity-50">{cType === "youtube" ? "📺" : cType === "newspaper" ? "📰" : cType === "pdf" ? "📄" : cType === "govt" ? "📢" : "🌐"}</span>
                                                )}
                                            </div>
                                            {imp >= 7 && (
                                                <span
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="absolute top-2 left-2"
                                                >
                                                    <InfoTooltip
                                                        content={<PriorityTooltip score={imp} method={(article as any).analysis?.analyzer_used} />}
                                                        side="top"
                                                    >
                                                        <span className={cn(
                                                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold cursor-pointer",
                                                            imp >= 9 ? "bg-rose text-white" : "bg-amber text-black"
                                                        )}>
                                                            {imp}/10
                                                        </span>
                                                    </InfoTooltip>
                                                </span>
                                            )}
                                            <button
                                                onClick={(e) => handleDelete(e, article)}
                                                className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white/70 hover:bg-rose/80 hover:text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                                                title="Delete article"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                            <span className="absolute top-2 right-2 badge badge-muted text-2xs backdrop-blur-sm">
                                                {TYPE_ICONS[cType]?.label || "Article"}
                                            </span>
                                        </div>

                                        <div className="p-3">
                                            <h3 className="text-sm font-medium text-text-primary group-hover:text-accent-bright transition-colors line-clamp-2 mb-2 leading-snug">
                                                {article.title}
                                            </h3>
                                            {article.type_metadata?.english_summary ? (
                                                <p className="text-xs text-indigo-300 italic line-clamp-2 mb-3 bg-indigo-500/10 p-1.5 rounded border-l-2 border-indigo-500">
                                                    {article.type_metadata.english_summary as string}
                                                </p>
                                            ) : article.analysis?.summary && (
                                                <p className="text-xs text-text-secondary line-clamp-2 mb-3">
                                                    {cleanSnippet(article.analysis.summary, 150)}
                                                </p>
                                            )}
                                            <div className="flex items-center gap-2 text-2xs text-text-muted">
                                                <span className="flex items-center gap-0.5"><Clock size={9} /> {formatRelative(article.published_at)}</span>
                                                {article.analysis?.sentiment && (
                                                    <span className={cn("flex items-center gap-0.5", sentimentColor(article.analysis.sentiment))}>
                                                        {sentimentIcon(article.analysis.sentiment)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        /* List view */
                        <div className="space-y-1.5">
                            {pagedItems.map(article => {
                                const cType = detectContentType(article);
                                const imp = article.analysis?.importance_score ?? 0;
                                return (
                                    <div
                                        key={article.id}
                                        onClick={() => setSelectedArticle(article)}
                                        className={cn(
                                            "card px-4 py-3 cursor-pointer group transition-all hover:bg-raised/50 flex items-center gap-3",
                                            imp >= 9 && "border-l-2 border-l-rose",
                                            imp >= 7 && imp < 9 && "border-l-2 border-l-amber",
                                        )}
                                    >
                                        {/* Thumbnail or icon */}
                                        {article.type_metadata?.image_url ? (
                                            <img
                                                src={article.type_metadata.image_url}
                                                alt=""
                                                className="w-12 h-10 object-cover rounded flex-shrink-0"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        ) : ((article.source_url || article.url) && (cType === 'article' || !cType)) ? (
                                            <img
                                                src={`https://www.google.com/s2/favicons?domain=${getDomain(article.source_url || article.url)}&sz=128`}
                                                alt={article.source_name || "Source"}
                                                className="w-5 h-5 rounded bg-white/10 p-0.5 object-contain mr-2"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        ) : (
                                            <span className="text-lg flex-shrink-0">{cType === "youtube" ? "📺" : cType === "pdf" ? "📄" : cType === "govt" ? "📢" : "🌐"}</span>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-text-primary group-hover:text-accent-bright transition-colors truncate">
                                                {article.title}
                                            </p>
                                            {article.type_metadata?.english_summary ? (
                                                <p className="text-xs text-indigo-300 italic truncate mt-0.5 font-medium">
                                                    {article.type_metadata.english_summary as string}
                                                </p>
                                            ) : article.analysis?.summary && (
                                                <p className="text-xs text-text-secondary truncate mt-0.5">
                                                    {cleanSnippet(article.analysis.summary, 150)}
                                                </p>
                                            )}
                                            <div className="flex items-center gap-2 text-2xs text-text-muted mt-0.5">
                                                <span>{formatRelative(article.published_at)}</span>
                                                {article.analysis?.sentiment && (
                                                    <span className={sentimentColor(article.analysis.sentiment)}>{article.analysis.sentiment}</span>
                                                )}
                                            </div>
                                        </div>
                                        {imp >= 5 && (
                                            <span onClick={(e) => e.stopPropagation()}>
                                                <InfoTooltip
                                                    content={<PriorityTooltip score={imp} method={(article as any).analysis?.analyzer_used} />}
                                                    side="left"
                                                >
                                                    <span className={cn(
                                                        "text-xs font-mono font-bold flex-shrink-0 cursor-pointer",
                                                        imp >= 9 ? "text-rose" : imp >= 7 ? "text-amber" : "text-text-muted"
                                                    )}>
                                                        {imp}
                                                    </span>
                                                </InfoTooltip>
                                            </span>
                                        )}
                                        <button
                                            onClick={(e) => handleDelete(e, article)}
                                            className="p-1 rounded hover:bg-rose/10 text-text-muted hover:text-rose opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                            title="Delete article"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                        <ExternalLink size={12} className="text-text-muted opacity-0 group-hover:opacity-60 flex-shrink-0" />
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Pagination ──────────────────────── */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="btn btn-ghost p-1.5 disabled:opacity-30"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <div className="flex items-center gap-1">
                                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                                    let pageNum: number;
                                    if (totalPages <= 7) {
                                        pageNum = i + 1;
                                    } else if (page <= 4) {
                                        pageNum = i + 1;
                                    } else if (page >= totalPages - 3) {
                                        pageNum = totalPages - 6 + i;
                                    } else {
                                        pageNum = page - 3 + i;
                                    }
                                    return (
                                        <button
                                            key={pageNum}
                                            onClick={() => setPage(pageNum)}
                                            className={cn(
                                                "w-7 h-7 rounded text-xs font-mono transition-colors",
                                                page === pageNum ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-overlay"
                                            )}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="btn btn-ghost p-1.5 disabled:opacity-30"
                            >
                                <ChevronRight size={14} />
                            </button>
                            <span className="text-2xs text-text-muted ml-2">
                                Page {page} of {totalPages}
                            </span>
                        </div>
                    )}
                </>
            )}

            {/* Content Detail Panel */}
            {selectedArticle && (
                <ContentDetail article={selectedArticle} onClose={() => setSelectedArticle(null)} />
            )}
        </div>
    );
}
