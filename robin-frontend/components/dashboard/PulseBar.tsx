"use client";

import { useEffect, useState } from "react";
import { Radio, AlertTriangle, Clock } from "lucide-react";
import { useScraperStatus, useIntelligenceData } from "@/lib/hooks/useIntelligence";
import NotificationBell from "@/components/dashboard/NotificationBell";
import ThemeToggle from "@/components/dashboard/ThemeToggle";

function formatTimeAgo(dateStr: string | undefined) {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export default function PulseBar() {
    const { data: scraper } = useScraperStatus();
    const { data: intel } = useIntelligenceData();
    const [pulse, setPulse] = useState(false);

    useEffect(() => {
        const id = setInterval(() => setPulse(p => !p), 3000);
        return () => clearInterval(id);
    }, []);

    const scraperData = scraper as Record<string, unknown> | undefined;
    const intelData = intel as { signals?: Array<{ severity: string }> } | undefined;

    const isRunning = scraperData?.scraper_running as boolean ?? false;
    const lastRun = scraperData?.last_run as string | undefined;
    const articlesToday = (scraperData?.articles_last_24h as number) ?? 0;

    // Only show critical/high signals count — actionable info only
    const criticalSignals = (intelData?.signals || []).filter(
        s => s.severity === "critical" || s.severity === "high"
    ).length;

    const healthColor = isRunning ? "bg-emerald" : articlesToday > 0 ? "bg-emerald" : "bg-amber";
    const healthLabel = isRunning ? "SCANNING" : articlesToday > 0 ? "ACTIVE" : "IDLE";

    return (
        <div className="w-full bg-surface border-b border-border px-5 py-2 flex items-center gap-4 text-xs select-none shrink-0">
            {/* System status — the only thing that matters globally */}
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${healthColor} ${pulse ? "opacity-100" : "opacity-50"} transition-opacity duration-1000 shrink-0`} />
                <span className="font-mono text-[11px] font-semibold text-text-secondary tracking-wider">{healthLabel}</span>
                {isRunning && (
                    <div className="flex items-center gap-1 text-emerald">
                        <Radio size={10} className="animate-pulse-slow" />
                        <span className="text-[10px]">Live</span>
                    </div>
                )}
            </div>

            {/* Critical signals badge — only if actionable */}
            {criticalSignals > 0 && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber/10 border border-amber/20 text-amber">
                    <AlertTriangle size={11} />
                    <span className="font-semibold">{criticalSignals} critical</span>
                </div>
            )}

            {/* Spacer pushes right-side controls to the end */}
            <div className="flex-1" />

            {/* Last scan — operational info */}
            <div className="flex items-center gap-1.5 text-text-muted">
                <Clock size={10} />
                <span className="text-[10px]">Last scan: {formatTimeAgo(lastRun)}</span>
            </div>

            <div className="flex items-center gap-1 border-l border-border pl-3">
                <ThemeToggle />
                <NotificationBell />
            </div>
        </div>
    );
}
