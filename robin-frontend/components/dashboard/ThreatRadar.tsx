"use client";

import { useMemo } from "react";
import {
    RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip,
} from "recharts";
import { Shield, AlertTriangle, Activity, AlertCircle, Minus, Target } from "lucide-react";
import { useIntelligenceData } from "@/lib/hooks/useIntelligence";
import { cleanSnippet } from "@/lib/utils";

const DIMENSIONS = ["Financial", "Regulatory", "Reputational", "Operational", "Geopolitical"];
const DIM_KEYS = ["financial_risk", "regulatory_risk", "reputational_risk", "operational_risk", "geopolitical_risk"];

const RISK_COLORS: Record<string, string> = {
    critical: "text-rose",
    elevated: "text-amber",
    moderate: "text-sky",
    low: "text-emerald",
    none: "text-text-muted",
};

const RISK_BG: Record<string, string> = {
    critical: "bg-rose-subtle border-rose/20",
    elevated: "bg-amber-subtle border-amber/20",
    moderate: "bg-sky-subtle border-sky/20",
    low: "bg-emerald-subtle border-emerald/20",
    none: "bg-overlay border-border",
};

interface ThreatData {
    overall_risk?: number;
    risk_level?: string;
    financial_risk?: number;
    regulatory_risk?: number;
    reputational_risk?: number;
    operational_risk?: number;
    geopolitical_risk?: number;
    summary?: string;
}

export default function ThreatRadar() {
    const { data: intel, isLoading } = useIntelligenceData();
    const threat = (intel as { threat_assessment?: ThreatData } | undefined)?.threat_assessment;

    const radarData = useMemo(() => {
        if (!threat) return DIMENSIONS.map(d => ({ dimension: d, value: 0, fullMark: 100 }));
        return DIMENSIONS.map((d, i) => ({
            dimension: d,
            value: (threat[DIM_KEYS[i] as keyof ThreatData] as number) ?? 0,
            fullMark: 100,
        }));
    }, [threat]);

    const riskLevel = threat?.risk_level?.toLowerCase() || "none";
    const overallRisk = threat?.overall_risk ?? 0;
    const riskColorCls = RISK_COLORS[riskLevel] || RISK_COLORS.none;
    const riskBgCls = RISK_BG[riskLevel] || RISK_BG.none;

    if (isLoading) {
        return (
            <div className="card p-4">
                <div className="skeleton h-[280px] w-full" />
            </div>
        );
    }

    return (
        <div className="card p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Shield size={16} className={riskColorCls} />
                    <h3 className="section-title">Threat Radar</h3>
                </div>
                <div className={`badge ${riskBgCls.includes("rose") ? "badge-rose" : riskBgCls.includes("amber") ? "badge-amber" : riskBgCls.includes("sky") ? "badge-sky" : "badge-emerald"}`}>
                    {riskLevel.toUpperCase()} — {overallRisk}/100
                </div>
            </div>

            {/* Radar Chart */}
            <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                        <PolarGrid
                            stroke="var(--color-border)"
                            strokeDasharray="3 3"
                        />
                        <PolarAngleAxis
                            dataKey="dimension"
                            tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                        />
                        <Radar
                            name="Current"
                            dataKey="value"
                            stroke={riskLevel === "critical" ? "var(--color-rose)" : riskLevel === "elevated" ? "var(--color-amber)" : "var(--color-sky)"}
                            fill={riskLevel === "critical" ? "var(--color-rose)" : riskLevel === "elevated" ? "var(--color-amber)" : "var(--color-sky)"}
                            fillOpacity={0.15}
                            strokeWidth={2}
                            dot={{ r: 3, fill: riskLevel === "critical" ? "var(--color-rose)" : riskLevel === "elevated" ? "var(--color-amber)" : "var(--color-sky)" }}
                        />
                        <Tooltip
                            contentStyle={{
                                background: "var(--color-overlay)",
                                border: "1px solid var(--color-border)",
                                borderRadius: "var(--radius-md)",
                                fontSize: "12px",
                                color: "var(--color-text-primary)",
                            }}
                        />
                    </RadarChart>
                </ResponsiveContainer>
            </div>

            {/* Risk Breakdown */}
            <div className="mt-3 grid grid-cols-5 gap-1">
                {DIMENSIONS.map((dim, i) => {
                    const val = radarData[i]?.value ?? 0;
                    return (
                        <div key={dim} className="flex flex-col items-center gap-0.5 group cursor-pointer">
                            <div className="relative w-full h-1.5 bg-overlay rounded-full overflow-hidden">
                                <div
                                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${val >= 70 ? "bg-rose" : val >= 40 ? "bg-amber" : "bg-emerald"}`}
                                    style={{ width: `${val}%` }}
                                />
                            </div>
                            <span className="text-2xs text-text-muted group-hover:text-text-secondary transition-colors">{dim.slice(0, 5)}</span>
                            <span className={`font-mono text-2xs font-semibold ${val >= 70 ? "text-rose" : val >= 40 ? "text-amber" : "text-emerald"}`}>
                                {val}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Summary */}
            {threat?.summary && (
                <p className="text-[10px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                    {cleanSnippet(threat.summary, 180)}
                </p>
            )}
        </div>
    );
}
