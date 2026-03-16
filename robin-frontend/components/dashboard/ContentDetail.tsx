"use client";

import { X, ExternalLink, MessageSquare, ArrowUpRight, Clock, Shield, FileText, Video, Building2, File } from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Article } from "@/lib/types";

const TYPE_ICONS: Record<string, { icon: React.ReactNode; label: string }> = {
    article: { icon: <FileText size={14} />, label: "Web Article" },
    youtube: { icon: <Video size={14} />, label: "TV News" },
    video: { icon: <Video size={14} />, label: "TV News" },
    newspaper: { icon: <FileText size={14} />, label: "Newspaper" },
    pdf: { icon: <File size={14} />, label: "PDF" },
    govt: { icon: <Building2 size={14} />, label: "Govt Release" },
    social: { icon: <MessageSquare size={14} />, label: "Social" },
};

const TYPE_GRADIENTS: Record<string, string> = {
    article: "from-blue-600/30 to-indigo-700/30",
    youtube: "from-red-600/30 to-rose-700/30",
    video: "from-red-600/30 to-rose-700/30",
    newspaper: "from-amber-600/30 to-yellow-700/30",
    pdf: "from-amber-600/30 to-orange-700/30",
    govt: "from-slate-500/30 to-gray-700/30",
    social: "from-violet-600/30 to-purple-700/30",
};

function detectContentType(article: Article): string {
    const url = article.url?.toLowerCase() || "";
    const sourceName = ((article as unknown as Record<string, unknown>).source_name as string) || "";
    const srcLower = sourceName.toLowerCase();

    // 1. Detect TV News
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";

    // 2. Detect Newspapers by source name or known domains
    const newspaperPatterns = ['sambad', 'dharitri', 'samaja', 'pragativadi', 'orissa post', 'odisha bhaskar',
        'times of india', 'hindustan times', 'the hindu', 'indian express', 'telegraph', 'economic times',
        'deccan', 'pioneer', 'tribune', 'livemint', 'business standard', 'statesman', 'daily', 'gazette', 'ndtv'];
    if (newspaperPatterns.some(p => srcLower.includes(p) || url.includes(p.replace(/ /g, '')))) return "newspaper";

    // 3. Prefer database content_type if available for PDFs, Govt, Social
    if (article.content_type) {
        const map: Record<string, string> = {
            article: "article",
            video: "youtube",
            tv_transcript: "youtube",
            podcast: "youtube",
            pdf: "pdf",
            govt_release: "govt",
            press_release: "govt",
            tweet: "social",
            reddit: "social",
            social_post: "social",
        };
        // Don't let DB 'article' override frontend 'newspaper' mapping
        if (map[article.content_type]) {
            return map[article.content_type];
        }
    }

    // 4. Fallback to URL-based detection (PDF, Govt, Social)
    if (url.endsWith(".pdf")) return "pdf";
    if (url.includes(".gov") || url.includes("pib.gov")) return "govt";
    if (url.includes("twitter.com") || url.includes("x.com") || url.includes("reddit.com")) return "social";
    
    return "article";
}

export { detectContentType, TYPE_ICONS, TYPE_GRADIENTS };

export default function ContentDetail({ article, onClose }: { article: Article; onClose: () => void }) {
    const contentType = detectContentType(article);
    const typeInfo = TYPE_ICONS[contentType] || TYPE_ICONS.article;
    const gradient = TYPE_GRADIENTS[contentType] || TYPE_GRADIENTS.article;
    const importance = article.analysis?.importance_score ?? 0;
    const isCritical = importance >= 9;
    const isHigh = importance >= 7;

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
                        <span className="text-6xl">{contentType === "youtube" ? "📺" : contentType === "newspaper" ? "📰" : contentType === "pdf" ? "📄" : contentType === "govt" ? "🏛️" : "🌐"}</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 bg-base/60 backdrop-blur-sm rounded-full p-1.5 text-text-muted hover:text-text-primary transition-colors"
                    >
                        <X size={16} />
                    </button>
                    {/* Importance badge */}
                    {importance >= 5 && (
                        <div className={cn(
                            "absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold",
                            isCritical ? "bg-rose text-white" : isHigh ? "bg-amber text-black" : "bg-overlay text-text-primary"
                        )}>
                            {importance}/10
                        </div>
                    )}
                </div>

                <div className="p-5 space-y-4">
                    {/* Title */}
                    <h2 className="text-base font-semibold text-text-primary leading-snug">
                        {article.title}
                    </h2>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 flex-wrap text-xs text-text-muted">
                        <span className="flex items-center gap-1.5 badge badge-muted">
                            {typeInfo.icon} {typeInfo.label}
                        </span>
                        <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {article.published_at ? new Date(article.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </span>
                        {article.analysis?.sentiment && (
                            <span className={cn(
                                "badge",
                                article.analysis.sentiment === "negative" ? "badge-rose"
                                    : article.analysis.sentiment === "positive" ? "badge-emerald"
                                        : "badge-muted"
                            )}>
                                {article.analysis.sentiment}
                            </span>
                        )}
                    </div>

                    {/* HOW THIS CONNECTS */}
                    {article.analysis?.importance_reason && (
                        <div className="card p-4 border-l-2 border-l-accent">
                            <div className="flex items-center gap-2 mb-2">
                                <Shield size={14} className="text-accent" />
                                <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                                    How This Connects To Your Monitoring
                                </h3>
                            </div>
                            <p className="text-sm text-text-secondary leading-relaxed">
                                {article.analysis.importance_reason}
                            </p>
                        </div>
                    )}

                    {/* Summary */}
                    {article.analysis?.summary && (
                        <div>
                            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Summary</h3>
                            <p className="text-sm text-text-secondary leading-relaxed">
                                {article.analysis.summary}
                            </p>
                        </div>
                    )}

                    {/* Entities */}
                    {article.analysis?.entities && article.analysis.entities.length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Entities</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {article.analysis.entities.map((ent, i) => (
                                    <span key={i} className="badge badge-sky text-2xs">{ent}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Keywords */}
                    {article.matched_keywords?.length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Keywords</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {article.matched_keywords.map((kw, i) => (
                                    <span key={i} className="badge badge-muted text-2xs">{kw}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Narrative Frame + Sentiment */}
                    <div className="grid grid-cols-2 gap-3">
                        {article.analysis?.narrative_frame && (
                            <div className="stat-card">
                                <span className="stat-label">Narrative Frame</span>
                                <span className="text-sm text-text-primary capitalize">{article.analysis.narrative_frame}</span>
                            </div>
                        )}
                        <div className="stat-card">
                            <span className="stat-label">Importance</span>
                            <span className={cn(
                                "text-sm font-bold",
                                isCritical ? "text-rose" : isHigh ? "text-amber" : "text-text-primary"
                            )}>
                                {importance}/10
                            </span>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 pt-3 border-t border-border">
                        {article.url && (
                            <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary text-xs flex items-center gap-1.5"
                            >
                                <ExternalLink size={12} /> Open Original
                            </a>
                        )}
                        <button className="btn btn-ghost text-xs flex items-center gap-1.5">
                            <MessageSquare size={12} /> Ask ROBIN
                        </button>
                        <button className="btn btn-ghost text-xs flex items-center gap-1.5">
                            <ArrowUpRight size={12} /> Escalate
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
