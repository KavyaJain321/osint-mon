"use client";

import { useMemo, useState } from "react";
import { useIntelligenceData } from "@/lib/hooks/useIntelligence";
import { Users, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface EntityProfile {
    id?: string;
    name: string;
    entity_type?: string;
    total_mentions?: number;
    first_seen?: string;
    last_seen?: string;
    sentiment_summary?: {
        positive?: number;
        negative?: number;
        neutral?: number;
        dominant?: string;
    };
    key_connections?: string[];
}

const TYPE_ICONS: Record<string, string> = {
    person: "👤",
    org: "🏢",
    organization: "🏢",
    location: "📍",
    government: "🏛️",
    media: "📰",
    event: "📅",
};

const SENTIMENT_CONFIG: Record<string, { dot: string; label: string }> = {
    positive: { dot: "bg-emerald", label: "Positive" },
    negative: { dot: "bg-rose", label: "Negative" },
    neutral: { dot: "bg-text-muted", label: "Neutral" },
    mixed: { dot: "bg-amber", label: "Mixed" },
};

export default function EntityGraph() {
    const { data: intel } = useIntelligenceData();
    const intelData = intel as { entity_profiles?: EntityProfile[]; entity_graph?: { nodes?: EntityProfile[]; edges?: Array<{ source: string; target: string; weight: number }> } } | undefined;

    const entities = useMemo(() => {
        return (intelData?.entity_profiles || []).slice(0, 20);
    }, [intelData]);

    const [selectedEntity, setSelectedEntity] = useState<EntityProfile | null>(null);

    const maxMentions = useMemo(() => {
        return Math.max(...entities.map(e => e.total_mentions || 1), 1);
    }, [entities]);

    if (entities.length === 0) {
        return (
            <div className="card p-6 text-center">
                <Users size={32} className="text-text-muted mx-auto mb-2 opacity-30" />
                <p className="text-xs text-text-muted">Entity profiles will appear after situation analysis runs.</p>
            </div>
        );
    }

    return (
        <div className="flex gap-4">
            {/* Entity Network (visual bubbles) */}
            <div className="flex-1 card p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Users size={14} className="text-text-secondary" />
                    <h3 className="section-title">Entity Network</h3>
                </div>

                {/* Bubble layout */}
                <div className="flex flex-wrap gap-2 justify-center py-4">
                    {entities.map((entity, i) => {
                        const mentions = entity.total_mentions || 1;
                        const sizePct = Math.max(0.4, mentions / maxMentions);
                        const size = Math.round(36 + sizePct * 44); // 36px to 80px
                        const sentiment = entity.sentiment_summary?.dominant || "neutral";
                        const dotColor = SENTIMENT_CONFIG[sentiment]?.dot || "bg-text-muted";
                        const isSelected = selectedEntity?.name === entity.name;
                        const typeIcon = TYPE_ICONS[entity.entity_type?.toLowerCase() || ""] || "•";

                        return (
                            <button
                                key={entity.name || i}
                                onClick={() => setSelectedEntity(isSelected ? null : entity)}
                                className={`
                                    relative flex flex-col items-center justify-center rounded-full
                                    border transition-all duration-300 cursor-pointer select-none
                                    ${isSelected
                                        ? "border-accent bg-overlay ring-1 ring-accent/30 scale-110"
                                        : "border-border hover:border-border-active hover:bg-raised/50"
                                    }
                                `}
                                style={{ width: size, height: size }}
                                title={`${entity.name} — ${mentions} mentions`}
                            >
                                <span className="text-xs">{typeIcon}</span>
                                <span className="text-2xs text-text-primary font-medium text-center leading-tight px-1 truncate max-w-full">
                                    {entity.name?.split(" ").slice(0, 2).join(" ")}
                                </span>
                                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-surface ${dotColor}`} />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Entity Detail Sidebar */}
            {selectedEntity && (
                <EntityDetailPanel entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
            )}
        </div>
    );
}

function EntityDetailPanel({ entity, onClose }: { entity: EntityProfile; onClose: () => void }) {
    const sentiment = entity.sentiment_summary?.dominant || "neutral";
    const config = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.neutral;
    const mentions = entity.total_mentions || 0;

    return (
        <div className="w-[280px] card p-4 animate-fade-in flex-shrink-0">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <span className="text-xs text-text-muted uppercase tracking-wider">{entity.entity_type || "Entity"}</span>
                    <h4 className="text-sm font-semibold text-text-primary mt-0.5">{entity.name}</h4>
                </div>
                <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">✕</button>
            </div>

            <div className="space-y-3">
                {/* Mentions */}
                <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Mentions</span>
                    <span className="font-mono font-semibold text-text-primary">{mentions}</span>
                </div>

                {/* Sentiment */}
                <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Sentiment</span>
                    <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                        <span className="text-text-primary">{config.label}</span>
                    </div>
                </div>

                {/* Sentiment Breakdown */}
                {entity.sentiment_summary && (
                    <div>
                        <div className="flex h-2 rounded-full overflow-hidden bg-overlay">
                            {entity.sentiment_summary.positive != null && entity.sentiment_summary.positive > 0 && (
                                <div className="bg-emerald/70" style={{ width: `${(entity.sentiment_summary.positive / mentions) * 100}%` }} />
                            )}
                            {entity.sentiment_summary.neutral != null && entity.sentiment_summary.neutral > 0 && (
                                <div className="bg-text-muted/30" style={{ width: `${(entity.sentiment_summary.neutral / mentions) * 100}%` }} />
                            )}
                            {entity.sentiment_summary.negative != null && entity.sentiment_summary.negative > 0 && (
                                <div className="bg-rose/70" style={{ width: `${(entity.sentiment_summary.negative / mentions) * 100}%` }} />
                            )}
                        </div>
                        <div className="flex justify-between mt-1 text-2xs text-text-muted">
                            <span className="text-emerald">{entity.sentiment_summary.positive || 0} pos</span>
                            <span>{entity.sentiment_summary.neutral || 0} neu</span>
                            <span className="text-rose">{entity.sentiment_summary.negative || 0} neg</span>
                        </div>
                    </div>
                )}

                {/* First/Last Seen */}
                {entity.first_seen && (
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">First seen</span>
                        <span className="font-mono text-2xs text-text-secondary">
                            {new Date(entity.first_seen).toLocaleDateString()}
                        </span>
                    </div>
                )}

                {/* Connections */}
                {entity.key_connections && entity.key_connections.length > 0 && (
                    <div>
                        <span className="text-2xs text-text-muted uppercase tracking-wider">Connections</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {entity.key_connections.slice(0, 6).map((conn, i) => (
                                <span key={i} className="badge badge-muted text-2xs">{conn}</span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
