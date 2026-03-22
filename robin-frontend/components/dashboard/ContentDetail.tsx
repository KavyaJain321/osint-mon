"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ExternalLink, MessageSquare, ArrowUpRight, Clock, Shield, FileText, Video, Bell, File, Search, Play, Scissors, Bot, ChevronDown, ChevronUp, Loader2, AlertCircle } from "lucide-react";
// Note: AlertCircle kept for ClipPlayer error state; Play kept for YouTube timestamp fallback display
import { formatRelative, cn, formatDate, formatTime, sentimentColor, cleanSnippet } from "@/lib/utils";
import type { Article, VideoTranscript, VideoClip } from "@/lib/types";
import { videoApi } from "@/lib/api";

const TYPE_ICONS: Record<string, { icon: React.ReactNode; label: string }> = {
    article: { icon: <FileText size={14} />, label: "Web Article" },
    youtube: { icon: <Video size={14} />, label: "TV News" },
    video: { icon: <Video size={14} />, label: "TV News" },
    pdf: { icon: <File size={14} />, label: "PDF" },
    govt: { icon: <Bell size={14} />, label: "Notification" },
    social: { icon: <MessageSquare size={14} />, label: "Social" },
};

const TYPE_GRADIENTS: Record<string, string> = {
    article: "from-blue-600/30 to-indigo-700/30",
    youtube: "from-red-600/30 to-rose-700/30",
    video: "from-red-600/30 to-rose-700/30",
    pdf: "from-amber-600/30 to-orange-700/30",
    govt: "from-slate-500/30 to-gray-700/30",
    social: "from-violet-600/30 to-purple-700/30",
};

function detectContentType(article: Article): string {
    const url = article.url?.toLowerCase() || "";
    const sourceName = ((article as unknown as Record<string, unknown>).source_name as string) || "";
    const srcLower = sourceName.toLowerCase();

    // 1. DB content_type is the authoritative source — check it first
    if (article.content_type) {
        const map: Record<string, string> = {
            article: "article",
            video: "youtube", tv_transcript: "youtube", podcast: "youtube",
            pdf: "pdf", govt_release: "govt", press_release: "govt",
            tweet: "social", reddit: "social", social_post: "social",
        };
        if (map[article.content_type]) return map[article.content_type];
    }

    // 2. URL-based overrides (most reliable for legacy content)
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
    if (url.endsWith(".pdf")) return "pdf";
    if (url.includes(".gov") || url.includes("pib.gov")) return "govt";
    if (url.includes("twitter.com") || url.includes("x.com") || url.includes("reddit.com")) return "social";

    return "article";
}

export { detectContentType, TYPE_ICONS, TYPE_GRADIENTS };

// ── Video Processing Sub-Component ──────────────────────────

/** Returns true if the URL points to a stored clip (Supabase or Cloudinary), not a YouTube link. */
function isStoredClip(url: string): boolean {
    if (!url) return false;
    return (
        url.includes('supabase.co/storage') ||
        url.includes('supabase.in/storage') ||
        url.includes('cloudinary.com') ||
        url.includes('res.cloudinary.com')
    );
}

/** Inline video player for stored clips; timestamp badge + context for YouTube fallbacks. */
function ClipPlayer({ url, startFormatted, endFormatted, label }: {
    url: string;
    startFormatted?: string;
    endFormatted?: string;
    label?: string;
}) {
    const [error, setError] = useState(false);

    if (isStoredClip(url)) {
        return (
            <div className="rounded-md overflow-hidden bg-black border border-border">
                {error ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
                        <AlertCircle size={12} className="text-rose-400" />
                        <span>Video unavailable</span>
                    </div>
                ) : (
                    <video
                        src={url}
                        controls
                        preload="metadata"
                        className="w-full max-h-48"
                        onError={() => setError(true)}
                    />
                )}
                {label && <p className="text-2xs text-text-muted px-2 py-1">{label}</p>}
            </div>
        );
    }

    // YouTube timestamp fallback — show as badge, not a redirect link
    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-overlay text-xs text-text-muted">
            <Play size={10} className="text-rose-400 fill-current flex-shrink-0" />
            <span className="font-mono">{startFormatted}{endFormatted ? ` — ${endFormatted}` : ''}</span>
            <span className="text-text-muted/60 text-2xs">clip unavailable (processing)</span>
        </div>
    );
}

function VideoProcessingPanel({ article }: { article: Article }) {
    const [transcript, setTranscript] = useState<VideoTranscript | null>(null);
    const [clips, setClips] = useState<VideoClip[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Array<{ timestamp: number; timestampFormatted: string; context: string }>>([]);
    const [searching, setSearching] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);
    const [showClips, setShowClips] = useState(true);

    const loadVideoData = useCallback(async () => {
        try {
            const [transcriptRes, clipsRes] = await Promise.all([
                videoApi.transcript(article.id).catch(() => ({ data: null })),
                videoApi.clips(article.id).catch(() => ({ data: [] })),
            ]);
            setTranscript((transcriptRes as { data: VideoTranscript | null }).data);
            setClips((clipsRes as { data: VideoClip[] }).data || []);
        } catch { /* non-critical */ } finally { setLoading(false); }
    }, [article.id]);

    // Load once on mount — no polling
    useEffect(() => { loadVideoData(); }, [loadVideoData]);

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const res = await videoApi.search(article.id, searchQuery);
            setSearchResults((res as { data: Array<{ timestamp: number; timestampFormatted: string; context: string }> }).data || []);
        } catch { setSearchResults([]); } finally { setSearching(false); }
    }, [article.id, searchQuery]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // Only show clips with actual stored video files — never show YouTube fallback links
    const storedClips = clips.filter(clip => isStoredClip(clip.clipUrl));

    if (loading) {
        return <div className="flex items-center gap-2 text-xs text-text-muted py-4"><Loader2 size={14} className="animate-spin" /> Loading video data...</div>;
    }

    return (
        <div className="space-y-4">

            {/* AI Summary */}
            {transcript?.aiSummary && (
                <div className="card p-4 border-l-2 border-l-violet-500">
                    <div className="flex items-center gap-2 mb-2">
                        <Bot size={14} className="text-violet-400" />
                        <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">AI Video Summary</h3>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{transcript.aiSummary}</p>
                </div>
            )}

            {/* In-Video Search (only when transcript is ready) */}
            {transcript && (
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <div className="relative flex-1">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input className="input !pl-8 text-xs w-full" placeholder="Search within this video..."
                                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
                        </div>
                        <button onClick={handleSearch} className="btn btn-ghost text-xs px-2" disabled={searching}>
                            {searching ? <Loader2 size={12} className="animate-spin" /> : "Search"}
                        </button>
                    </div>
                    {searchResults.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                            {searchResults.map((r, i) => (
                                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-overlay text-xs">
                                    <span className="badge badge-muted text-2xs flex-shrink-0 mt-0.5 font-mono">{r.timestampFormatted}</span>
                                    <span className="text-text-secondary">{r.context}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Clips Section — stored clips only (Supabase / Cloudinary) */}
            {storedClips.length > 0 ? (
                <div>
                    <button onClick={() => setShowClips(!showClips)} className="flex items-center gap-2 w-full text-left mb-2">
                        <Scissors size={14} className="text-rose-400" />
                        <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                            Generated Clips ({storedClips.length})
                        </h3>
                        {showClips ? <ChevronUp size={12} className="text-text-muted ml-auto" /> : <ChevronDown size={12} className="text-text-muted ml-auto" />}
                    </button>
                    {showClips && (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {storedClips.map((clip, i) => (
                                <div key={clip.id || i} className="card p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="badge badge-muted text-2xs font-mono">{clip.startFormatted} — {clip.endFormatted}</span>
                                        <span className="badge badge-muted text-2xs">{clip.keyword}</span>
                                        <span className="text-2xs text-text-muted ml-auto">{Math.round(clip.duration)}s</span>
                                    </div>
                                    <ClipPlayer url={clip.clipUrl} startFormatted={clip.startFormatted} endFormatted={clip.endFormatted} />
                                    {clip.aiSummary && <p className="text-xs text-text-secondary leading-relaxed mt-2">{clip.aiSummary}</p>}
                                    {clip.transcriptSegment && <p className="text-2xs text-text-muted italic line-clamp-2 mt-1">&ldquo;{clip.transcriptSegment}&rdquo;</p>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : transcript ? (
                <div className="px-3 py-2 rounded-md bg-overlay text-xs text-text-muted">
                    No clips generated for this video.
                </div>
            ) : null}

            {/* Keyword Timestamps */}
            {transcript?.keywordOccurrences && transcript.keywordOccurrences.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Search size={12} /> Keyword Timestamps ({transcript.keywordOccurrences.length})
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                        {transcript.keywordOccurrences.slice(0, 20).map((occ, i) => (
                            <span key={i} className="badge badge-muted text-2xs font-mono">
                                {occ.keyword} @ {formatTime(occ.timestamp)}
                            </span>
                        ))}
                        {transcript.keywordOccurrences.length > 20 && (
                            <span className="text-2xs text-text-muted">+{transcript.keywordOccurrences.length - 20} more</span>
                        )}
                    </div>
                </div>
            )}

            {/* Full Transcript */}
            {transcript?.fullText && (
                <div>
                    <button onClick={() => setShowTranscript(!showTranscript)} className="flex items-center gap-2 w-full text-left mb-2">
                        <FileText size={14} className="text-blue-400" />
                        <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">Full Transcript</h3>
                        <span className="text-2xs text-text-muted">({transcript.durationSeconds ? formatTime(transcript.durationSeconds) : ''})</span>
                        {showTranscript ? <ChevronUp size={12} className="text-text-muted ml-auto" /> : <ChevronDown size={12} className="text-text-muted ml-auto" />}
                    </button>
                    {showTranscript && (
                        <div className="text-sm text-text-secondary leading-relaxed bg-surface border border-border p-3 rounded-md max-h-60 overflow-y-auto whitespace-pre-wrap">
                            {transcript.fullText}
                        </div>
                    )}
                </div>
            )}

            {/* No transcript available */}
            {!transcript && storedClips.length === 0 && (
                <div className="px-3 py-2 rounded-md bg-overlay text-xs text-text-muted">
                    Transcript not available for this video.
                </div>
            )}
        </div>
    );
}

// ── Main ContentDetail Component ────────────────────────────

export default function ContentDetail({ article, onClose }: { article: Article; onClose: () => void }) {
    const contentType = detectContentType(article);
    const typeInfo = TYPE_ICONS[contentType] || TYPE_ICONS.article;
    const gradient = TYPE_GRADIENTS[contentType] || TYPE_GRADIENTS.article;
    const importance = article.analysis?.importance_score ?? 0;
    const isCritical = importance >= 9;
    const isHigh = importance >= 7;
    const isVideo = contentType === "youtube" || contentType === "video";

    return (
        <div className="fixed inset-0 z-40 flex justify-end animate-fade-in" onClick={onClose}>
            <div className="absolute inset-0 bg-base/60 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-[520px] h-full bg-surface border-l border-border overflow-y-auto no-scrollbar animate-slide-left"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header Image Area */}
                <div className={cn("relative h-40 bg-gradient-to-br", gradient)}>
                    <div className="absolute inset-0 flex items-center justify-center opacity-20">
                        <span className="text-6xl">{contentType === "youtube" ? "📺" : contentType === "pdf" ? "📄" : contentType === "govt" ? "📢" : "🌐"}</span>
                    </div>
                    <button onClick={onClose} className="absolute top-3 right-3 bg-base/60 backdrop-blur-sm rounded-full p-1.5 text-text-muted hover:text-text-primary transition-colors">
                        <X size={16} />
                    </button>
                    {importance >= 5 && (
                        <div className={cn("absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold",
                            isCritical ? "bg-rose text-white" : isHigh ? "bg-amber text-black" : "bg-overlay text-text-primary"
                        )}>
                            {importance}/10
                        </div>
                    )}
                </div>

                <div className="p-5 space-y-4">
                    <h2 className="text-base font-semibold text-text-primary leading-snug">{article.title}</h2>

                    <div className="flex items-center gap-3 flex-wrap text-xs text-text-muted">
                        <span className="flex items-center gap-1.5 badge badge-muted">{typeInfo.icon} {typeInfo.label}</span>
                        <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {article.published_at ? new Date(article.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </span>
                        {article.analysis?.sentiment && (
                            <span className={cn("badge",
                                article.analysis.sentiment === "negative" ? "badge-rose"
                                    : article.analysis.sentiment === "positive" ? "badge-emerald" : "badge-muted"
                            )}>
                                {article.analysis.sentiment}
                            </span>
                        )}
                    </div>

                    {article.analysis?.importance_reason && (
                        <div className="card p-4 border-l-2 border-l-accent">
                            <div className="flex items-center gap-2 mb-2">
                                <Shield size={14} className="text-accent" />
                                <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">How This Connects To Your Monitoring</h3>
                            </div>
                            <p className="text-sm text-text-secondary leading-relaxed">{article.analysis.importance_reason}</p>
                        </div>
                    )}

                    {/* VIDEO PROCESSING PANEL (TV News only) */}
                    {isVideo && <VideoProcessingPanel article={article} />}

                    {/* Context (non-video content) */}
                    {!isVideo && Boolean(article.type_metadata?.english_summary) && (
                        <div className="mb-4 bg-gradient-to-r from-indigo-500/10 to-transparent p-3 rounded-md border-l-2 border-indigo-500">
                            <h3 className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-1">English Context</h3>
                            <p className="text-sm text-indigo-900 dark:text-indigo-100 italic leading-relaxed">{article.type_metadata?.english_summary as string}</p>
                        </div>
                    )}
                    {!isVideo && Boolean(article.analysis?.summary) && (
                        <div className="mb-6 p-4 rounded-xl border border-border bg-surface shadow-sm">
                            <h3 className="text-[12px] font-mono font-medium text-text-muted tracking-wider mb-2">INTELLIGENCE SUMMARY</h3>
                            <p className="text-sm text-text-primary leading-relaxed">{cleanSnippet(article.analysis?.summary, 1000)}</p>
                        </div>
                    )}

                    {article.analysis?.entities && article.analysis.entities.length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Entities</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {(article.analysis?.entities || []).map((ent, i) => <span key={i} className="badge badge-sky text-2xs">{ent}</span>)}
                            </div>
                        </div>
                    )}

                    {article.matched_keywords?.length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Keywords</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {article.matched_keywords.map((kw, i) => <span key={i} className="badge badge-muted text-2xs">{kw}</span>)}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        {article.analysis?.narrative_frame && (
                            <div className="stat-card">
                                <span className="stat-label">Narrative Frame</span>
                                <span className="text-sm text-text-primary capitalize">{article.analysis.narrative_frame}</span>
                            </div>
                        )}
                        <div className="stat-card">
                            <span className="stat-label">Importance</span>
                            <span className={cn("text-sm font-bold", isCritical ? "text-rose" : isHigh ? "text-amber" : "text-text-primary")}>
                                {importance}/10
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 pt-3 border-t border-border">
                        {article.url && (
                            <a href={article.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary text-xs flex items-center gap-1.5">
                                <ExternalLink size={12} /> Open Original
                            </a>
                        )}
                        <button className="btn btn-ghost text-xs flex items-center gap-1.5"><MessageSquare size={12} /> Ask ROBIN</button>
                        <button className="btn btn-ghost text-xs flex items-center gap-1.5"><ArrowUpRight size={12} /> Escalate</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
