"use client";

import { useEffect, useState } from "react";
import { Activity, Radio, TrendingDown, TrendingUp, Minus, AlertTriangle, Clock, Zap } from "lucide-react";
import { useScraperStatus, useIntelligenceData, useAnalytics } from "@/lib/hooks/useIntelligence";
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
    const { data: analytics } = useAnalytics();
    const [pulse, setPulse] = useState(false);

    // Pulse animation every 3s
    useEffect(() => {
        const id = setInterval(() => setPulse(p => !p), 3000);
        return () => clearInterval(id);
    }, []);

    const scraperData = scraper as Record<string, unknown> | undefined;
    const intelData = intel as { signals?: Array<{ severity: string }>; threat_assessment?: Record<string, unknown> } | undefined;
    const analyticsData = analytics as { sentiment?: { positive_pct?: number; negative_pct?: number; total?: number } } | undefined;

    // Derived values
    const articlesToday = (scraperData?.articles_last_24h as number) ?? 0;
    const articlesPrev = (scraperData?.articles_previous_24h as number) ?? 0;
    const totalSources = (scraperData?.total_sources as number) ?? 0;
    const isRunning = scraperData?.scraper_running as boolean ?? false;
    const lastRun = scraperData?.last_run as string | undefined;

    const criticalSignals = (intelData?.signals || []).filter(s => s.severity === "critical" || s.severity === "high").length;

    const posPct = analyticsData?.sentiment?.positive_pct ?? 50;
    const negPct = analyticsData?.sentiment?.negative_pct ?? 20;
    const sentimentScore = Math.round(posPct - negPct + 50); // 0-100 scale
    const sentimentDelta = articlesToday > articlesPrev ? -3 : articlesPrev > articlesToday ? 2 : 0;

    // System health
    const healthColor = isRunning ? "bg-emerald" : articlesToday > 0 ? "bg-emerald" : "bg-amber";
    const healthLabel = isRunning ? "SCANNING" : articlesToday > 0 ? "ACTIVE" : "IDLE";

    const velocityTrend = articlesToday > articlesPrev ? "up" : articlesToday < articlesPrev ? "down" : "flat";

    return (
        <div className="w-full bg-surface border-b border-border px-6 py-2.5 flex items-center justify-between gap-6 text-xs select-none animate-fade-in">
            {/* Status Indicator */}
            <div className="flex items-center gap-2.5">
                <div className="relative flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${healthColor} ${pulse ? "opacity-100" : "opacity-60"} transition-opacity duration-1000`} />
                    <span className="font-mono text-2xs font-semibold text-text-secondary tracking-wider">{healthLabel}</span>
                </div>
                {isRunning && (
                    <div className="flex items-center gap-1 text-emerald">
                        <Radio size={11} className="animate-pulse-slow" />
                        <span className="text-2xs">Live</span>
                    </div>
                )}
            </div>

            {/* Content Velocity */}
            <div className="flex items-center gap-2 border-l border-border pl-4">
                <Zap size={13} className="text-text-muted" />
                <span className="font-mono text-text-primary font-semibold">{articlesToday}</span>
                <span className="text-text-muted">items today</span>
                {velocityTrend === "up" && <TrendingUp size={12} className="text-emerald" />}
                {velocityTrend === "down" && <TrendingDown size={12} className="text-rose" />}
                {velocityTrend === "flat" && <Minus size={12} className="text-text-muted" />}
            </div>

            {/* Sentiment Pulse */}
            <div className="flex items-center gap-2 border-l border-border pl-4">
                <Activity size={13} className="text-text-muted" />
                <span className="text-text-muted">Sentiment:</span>
                <span className={`font-mono font-semibold ${sentimentScore >= 55 ? "text-emerald" : sentimentScore >= 40 ? "text-amber" : "text-rose"}`}>
                    {sentimentScore}%
                </span>
                {sentimentDelta !== 0 && (
                    <span className={`text-2xs ${sentimentDelta > 0 ? "text-emerald" : "text-rose"}`}>
                        {sentimentDelta > 0 ? "↑" : "↓"}{Math.abs(sentimentDelta)}%
                    </span>
                )}
            </div>

            {/* Sources Active */}
            <div className="flex items-center gap-2 border-l border-border pl-4">
                <span className="text-text-muted">{totalSources}</span>
                <span className="text-text-muted">sources</span>
            </div>

            {/* Critical Signals */}
            {criticalSignals > 0 && (
                <div className="flex items-center gap-1.5 border-l border-border pl-4 text-amber cursor-pointer hover:text-rose transition-colors">
                    <AlertTriangle size={13} />
                    <span className="font-semibold">{criticalSignals}</span>
                    <span>critical</span>
                </div>
            )}

            {/* Last Scan + Notifications */}
            <div className="flex items-center gap-3 ml-auto">
                <div className="flex items-center gap-1.5 text-text-muted">
                    <Clock size={11} />
                    <span className="text-2xs">Last scan: {formatTimeAgo(lastRun)}</span>
                </div>
                <div className="flex items-center gap-1 border-l border-border pl-3 ml-1">
                    <ThemeToggle />
                    <NotificationBell />
                </div>
            </div>
        </div>
    );
}
