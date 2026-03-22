"use client";

import { useMemo } from "react";
import { BarChart3, TrendingUp, Minus } from "lucide-react";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell,
} from "recharts";
import { useIntelligenceData, useAnalytics } from "@/lib/hooks/useIntelligence";

interface EntityProfile {
    name: string;
    total_mentions?: number;
    sentiment_summary?: {
        positive?: number;
        negative?: number;
        neutral?: number;
        dominant?: string;
    };
}

const PIE_COLORS = ["var(--color-sky)", "var(--color-amber)", "var(--color-emerald)", "var(--color-violet)", "var(--color-rose)"];

export default function Benchmarks() {
    const { data: intel } = useIntelligenceData();
    const { data: analytics } = useAnalytics();

    const intelData = intel as { entity_profiles?: EntityProfile[] } | undefined;
    const analyticsData = analytics as { sentiment?: { positive_pct?: number; negative_pct?: number; neutral_pct?: number; total?: number } } | undefined;

    const entities = useMemo(() => {
        return (intelData?.entity_profiles || [])
            .filter(e => e.total_mentions && e.total_mentions > 0)
            .sort((a, b) => (b.total_mentions || 0) - (a.total_mentions || 0))
            .slice(0, 6);
    }, [intelData]);

    // Share of Voice data (entity mentions as % of total)
    const sovData = useMemo(() => {
        const total = entities.reduce((sum, e) => sum + (e.total_mentions || 0), 0);
        if (total === 0) return [];
        return entities.map(e => ({
            name: e.name.split(" ").slice(0, 2).join(" "),
            value: e.total_mentions || 0,
            pct: Math.round(((e.total_mentions || 0) / total) * 100),
        }));
    }, [entities]);

    // Sentiment comparison data
    const sentimentComparison = useMemo(() => {
        return entities.slice(0, 5).map(e => {
            const s = e.sentiment_summary || {};
            const total = (s.positive || 0) + (s.negative || 0) + (s.neutral || 0);
            return {
                name: e.name.split(" ").slice(0, 2).join(" "),
                positive: total > 0 ? Math.round(((s.positive || 0) / total) * 100) : 50,
                negative: total > 0 ? Math.round(((s.negative || 0) / total) * 100) : 20,
            };
        });
    }, [entities]);

    // Overall sentiment
    const overall = analyticsData?.sentiment;

    if (entities.length === 0) {
        return (
            <div className="card p-6 text-center">
                <BarChart3 size={32} className="text-text-muted mx-auto mb-2 opacity-30" />
                <p className="text-xs text-text-muted">Benchmark data will appear after entity analysis runs.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <BarChart3 size={16} className="text-text-secondary" />
                <h3 className="section-title">Comparative Benchmarks</h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Share of Voice Donut */}
                <div className="card p-4">
                    <h4 className="text-xs font-medium text-text-secondary mb-3">Share of Voice</h4>
                    <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                            <PieChart>
                                <Pie
                                    data={sovData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={2}
                                    dataKey="value"
                                >
                                    {sovData.map((_, i) => (
                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: "var(--color-overlay)",
                                        border: "1px solid var(--color-border)",
                                        borderRadius: "var(--radius-md)",
                                        fontSize: "11px",
                                        color: "var(--color-text-primary)",
                                    }}
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    formatter={((v: number, name: string) => [`${v ?? 0} mentions`, name]) as any}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    {/* Legend */}
                    <div className="flex flex-wrap justify-center gap-3 mt-2">
                        {sovData.map((d, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-2xs">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                <span className="text-text-secondary">{d.name}</span>
                                <span className="font-mono text-text-muted">{d.pct}%</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Sentiment Comparison Bar */}
                <div className="card p-4">
                    <h4 className="text-xs font-medium text-text-secondary mb-3">Sentiment By Entity</h4>
                    <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                            <BarChart data={sentimentComparison} layout="vertical">
                                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} />
                                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{
                                        background: "var(--color-overlay)",
                                        border: "1px solid var(--color-border)",
                                        borderRadius: "var(--radius-md)",
                                        fontSize: "11px",
                                        color: "var(--color-text-primary)",
                                    }}
                                />
                                <Bar dataKey="positive" name="Positive %" fill="var(--color-emerald)" radius={[0, 4, 4, 0]} barSize={10} />
                                <Bar dataKey="negative" name="Negative %" fill="var(--color-rose)" radius={[0, 4, 4, 0]} barSize={10} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Overall Sentiment Summary */}
            {overall && (
                <div className="grid grid-cols-3 gap-3">
                    <SentimentCard label="Positive" pct={overall.positive_pct || 0} color="text-emerald" />
                    <SentimentCard label="Neutral" pct={100 - (overall.positive_pct || 0) - (overall.negative_pct || 0)} color="text-text-muted" />
                    <SentimentCard label="Negative" pct={overall.negative_pct || 0} color="text-rose" />
                </div>
            )}
        </div>
    );
}

function SentimentCard({ label, pct, color }: { label: string; pct: number; color: string }) {
    return (
        <div className="stat-card">
            <span className="stat-label">{label}</span>
            <span className={`stat-value ${color}`}>{Math.round(pct)}%</span>
        </div>
    );
}
