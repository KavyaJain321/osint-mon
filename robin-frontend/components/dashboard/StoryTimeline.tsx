"use client";

import { useMemo } from "react";
import { useIntelligenceData } from "@/lib/hooks/useIntelligence";
import { AlertTriangle, Clock, GitCommit, Target, Minus, ArrowUpRight, ArrowDownRight, Zap, Activity } from "lucide-react";
import { cleanSnippet } from "@/lib/utils";

interface NarrativePattern {
    pattern_type?: string;
    pattern?: string;
    theme?: string;
    summary?: string;
    evidence_count?: number;
    sentiment?: string;
    first_seen?: string;
    last_seen?: string;
}

const SENT_COLOR: Record<string, string> = {
    negative: "bg-rose/70",
    positive: "bg-emerald/70",
    neutral: "bg-sky/50",
    mixed: "bg-amber/50",
};

const SENT_BORDER: Record<string, string> = {
    negative: "border-rose/30",
    positive: "border-emerald/30",
    neutral: "border-sky/20",
    mixed: "border-amber/20",
};

export default function StoryTimeline() {
    const { data: intel } = useIntelligenceData();
    const intelData = intel as { narrative?: { patterns?: NarrativePattern[] }; threat_assessment?: { patterns?: NarrativePattern[] } } | undefined;

    // Get narrative patterns (story clusters)
    const patterns = useMemo(() => {
        const raw = intelData?.threat_assessment?.patterns || [];
        return raw.slice(0, 8);
    }, [intelData]);

    if (patterns.length === 0) {
        return (
            <div className="card p-6 text-center">
                <p className="text-xs text-text-muted">Story clusters will appear after batch intelligence runs.</p>
            </div>
        );
    }

    // Compute max evidence for scaling bars
    const maxEvidence = Math.max(...patterns.map(p => p.evidence_count || 1), 1);

    return (
        <div className="space-y-2">
            {patterns.map((pattern, i) => {
                const evidence = pattern.evidence_count || 1;
                const widthPct = Math.max(20, (evidence / maxEvidence) * 100);
                const sentiment = pattern.sentiment?.toLowerCase() || "neutral";
                const barColor = SENT_COLOR[sentiment] || SENT_COLOR.neutral;
                const borderColor = SENT_BORDER[sentiment] || SENT_BORDER.neutral;
                const title = pattern.theme || pattern.pattern || pattern.pattern_type || `Story ${i + 1}`;

                return (
                    <div
                        key={i}
                        className={`card p-3 border-l-2 ${borderColor} hover:bg-raised/50 transition-colors cursor-pointer group`}
                    >
                        <div className="flex items-center gap-3 mb-1.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${barColor}`} />
                            <p className="text-sm font-medium text-text-primary flex-1 truncate group-hover:text-accent-bright transition-colors">
                                {title}
                            </p>
                            <span className="text-2xs text-text-muted font-mono">{evidence} items</span>
                        </div>

                        {/* Volume bar */}
                        <div className="ml-5 h-2 bg-overlay rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                                style={{ width: `${widthPct}%` }}
                            />
                        </div>

                        {pattern.summary && (
                            <p className="text-2xs text-text-muted mt-1.5 ml-5 truncate-2">{cleanSnippet(pattern.summary, 150)}</p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
