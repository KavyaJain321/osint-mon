// ============================================================
// ROBIN OSINT — InfoTooltip Component
// Reusable ⓘ icon with hover/tap tooltip for score explanations
// ============================================================

"use client";

import React, { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
    content: React.ReactNode;
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
    iconSize?: number;
    /** Optional custom trigger element. If omitted the default ⓘ icon is used. */
    children?: React.ReactNode;
}

export function InfoTooltip({ content, side = "top", className, iconSize = 11, children }: InfoTooltipProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click (mobile tap-away)
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const positionClasses = {
        top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
        bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
        left: "right-full top-1/2 -translate-y-1/2 mr-2",
        right: "left-full top-1/2 -translate-y-1/2 ml-2",
    };

    return (
        <div
            ref={ref}
            className={cn("relative inline-flex items-center", className)}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onClick={() => setOpen(v => !v)}
        >
            {children ?? (
                <Info
                    size={iconSize}
                    className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer flex-shrink-0"
                />
            )}
            {open && (
                <div
                    className={cn(
                        "absolute z-[9999] w-[280px] max-w-[280px] pointer-events-none",
                        positionClasses[side]
                    )}
                    style={{ filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.5))" }}
                >
                    <div className="bg-[#0f1117] border border-slate-700/70 rounded-lg p-3 text-[11px] text-slate-300 leading-relaxed">
                        {content}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Pre-built tooltip content ─────────────────────────────────

export const SENTIMENT_TOOLTIP = (
    <div className="space-y-2">
        <p className="font-semibold text-slate-100 text-[12px]">How Sentiment % is Calculated</p>
        <p className="text-slate-400">
            Counts how many analyzed articles are labeled <span className="text-red-400 font-mono">negative</span> and divides by the total:
        </p>
        <div className="bg-slate-800/60 rounded px-2 py-1.5 font-mono text-[10px] text-teal-300">
            negative articles ÷ total analyzed × 100
        </div>
        <div className="border-t border-slate-700/50 pt-2 space-y-1">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Classifier</p>
            <p className="text-slate-400">Each article is labeled by AI (primary) or a local lexicon (fallback). The lexicon checks word hits:</p>
            <div className="font-mono text-[10px] bg-slate-800/60 px-2 py-1 rounded">
                score = (pos_hits − neg_hits) / total_hits<br/>
                <span className="text-teal-300">&gt; +0.15</span> → positive&nbsp;&nbsp;
                <span className="text-red-300">&lt; −0.15</span> → negative<br/>
                else → neutral
            </div>
        </div>
    </div>
);

export const ALERT_LEVEL_TOOLTIP = (
    <div className="space-y-2">
        <p className="font-semibold text-slate-100 text-[12px]">How Alert Level is Calculated</p>
        <p className="text-slate-400">Combines average article importance with the proportion of negative-sentiment articles:</p>
        <div className="bg-slate-800/60 rounded px-2 py-1.5 font-mono text-[10px] text-teal-300">
            alert = avg(importance) × (1 + neg_fraction)<br/>
            capped at 10.0
        </div>
        <div className="border-t border-slate-700/50 pt-2 space-y-1">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Thresholds</p>
            <div className="space-y-0.5 font-mono text-[10px]">
                <div><span className="text-red-400">≥ 7.0</span> → CRITICAL</div>
                <div><span className="text-amber-400">≥ 5.0</span> → ELEVATED</div>
                <div><span className="text-yellow-400">≥ 3.0</span> → MEDIUM</div>
                <div><span className="text-teal-400">&lt; 3.0</span> → LOW</div>
            </div>
        </div>
    </div>
);

interface PriorityTooltipProps {
    score: number;
    method?: string;
}

export function PriorityTooltip({ score, method }: PriorityTooltipProps) {
    const isLLM = !method || method === "groq" || method === "groq_llm";
    return (
        <div className="space-y-2">
            <p className="font-semibold text-slate-100 text-[12px]">Priority Score: {score}/10</p>
            {isLLM ? (
                <div className="space-y-1">
                    <p className="text-slate-400">Scored by AI using this rubric:</p>
                    <div className="space-y-0.5 font-mono text-[10px]">
                        <div><span className="text-red-400">9–10</span> Regulatory / legal / major scandal</div>
                        <div><span className="text-amber-400">7–8</span> Financial impact / leadership change</div>
                        <div><span className="text-yellow-400">5–6</span> Industry trend / policy development</div>
                        <div><span className="text-slate-400">3–4</span> General mention / background context</div>
                        <div><span className="text-slate-500">1–2</span> Tangential / low relevance</div>
                    </div>
                </div>
            ) : (
                <div className="space-y-1">
                    <p className="text-slate-400">Computed by local rules:</p>
                    <div className="space-y-0.5 text-[10px] text-slate-400">
                        <div>• Base score: <span className="font-mono text-slate-300">3</span></div>
                        <div>• ≥3 keyword matches: <span className="font-mono text-teal-300">+2</span></div>
                        <div>• ≥2 keyword matches: <span className="font-mono text-teal-300">+1</span></div>
                        <div>• &gt;3 named people detected: <span className="font-mono text-teal-300">+1</span></div>
                        <div>• &gt;2 organisations detected: <span className="font-mono text-teal-300">+1</span></div>
                        <div>• Crisis/fraud/attack keywords: <span className="font-mono text-teal-300">+2</span></div>
                        <div>• Financial figures (billion, GDP…): <span className="font-mono text-teal-300">+1</span></div>
                    </div>
                </div>
            )}
        </div>
    );
}
