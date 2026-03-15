"use client";

import { useEffect, useState } from "react";
import { BarChart2, TrendingUp, TrendingDown, FileText, Download, Mail, Clock as ClockIcon, ChevronDown, ChevronUp } from "lucide-react";
import { analyticsApi, intelligenceApi } from "@/lib/api";
import { sentimentColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface SentimentData {
    positive: number; negative: number; neutral: number;
    positive_pct: number; negative_pct: number; neutral_pct: number;
    total: number;
}

interface VelocityPoint {
    date: string;
    article_count: number;
}

interface Narrative {
    weekly_narrative?: string;
    dominant_sentiment?: string;
    positive_pct: number;
    negative_pct: number;
    neutral_pct: number;
    emerging_themes?: string[];
    pattern_date?: string;
}

const CHART_BLUE = "#2563eb";
const CHART_GREEN = "#059669";
const CHART_RED = "#dc2626";
const CHART_GRAY = "#4a5a73";

export default function ReportsPage() {
    const [sentiment, setSentiment] = useState<SentimentData | null>(null);
    const [velocity, setVelocity] = useState<VelocityPoint[]>([]);
    const [narratives, setNarratives] = useState<Narrative[]>([]);
    const [loading, setLoading] = useState(true);

    // Report Builder state
    const [builderOpen, setBuilderOpen] = useState(false);
    const [template, setTemplate] = useState("daily");
    const [period, setPeriod] = useState("24h");
    const [headerText, setHeaderText] = useState("Intelligence Report");
    const [classification, setClassification] = useState("internal");
    const [sections, setSections] = useState<Record<string, boolean>>({
        executive_summary: true,
        top_developments: true,
        sentiment_charts: true,
        entity_intelligence: true,
        source_matrix: true,
        active_signals: true,
        scenario_assessment: false,
        competitive_benchmarks: false,
        watch_list: true,
        appendix: true,
    });

    const TEMPLATES = [
        { id: "daily", label: "Daily Brief" },
        { id: "weekly", label: "Weekly Summary" },
        { id: "incident", label: "Incident Report" },
        { id: "stakeholder", label: "Stakeholder Brief" },
        { id: "custom", label: "Custom" },
    ];

    const PERIODS = [
        { id: "24h", label: "Last 24 hours" },
        { id: "7d", label: "Last 7 days" },
        { id: "30d", label: "Last 30 days" },
    ];

    const SECTION_LABELS: Record<string, string> = {
        executive_summary: "① Executive Summary (AI-generated)",
        top_developments: "② Top Developments (story clusters)",
        sentiment_charts: "③ Sentiment Analysis (charts)",
        entity_intelligence: "④ Entity Intelligence (top entities + relevance)",
        source_matrix: "⑤ Source Coverage Matrix",
        active_signals: "⑥ Active Signals & Alerts",
        scenario_assessment: "⑦ Scenario Assessment",
        competitive_benchmarks: "⑧ Competitive Benchmarks",
        watch_list: "⑨ Watch List & Predictions",
        appendix: "⑩ Appendix: Full Article List",
    };

    const toggleSection = (key: string) => setSections(s => ({ ...s, [key]: !s[key] }));

    const [generating, setGenerating] = useState(false);
    const [generatingMedia, setGeneratingMedia] = useState(false);

    const handleGenerateMediaReport = async () => {
        setGeneratingMedia(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('robin_token') : null;
            const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
            const res = await fetch(`${BASE_URL}/api/test/generate-media-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            });
            if (!res.ok) throw new Error('Media report generation failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ROBIN_Media_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('Media report generation failed. Please try again.');
        }
        setGeneratingMedia(false);
    };

    const handleGeneratePDF = async () => {
        setGenerating(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('robin_token') : null;
            const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
            const res = await fetch(`${BASE_URL}/api/test/generate-media-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ period, template, sections, headerText, classification }),
            });
            if (!res.ok) throw new Error('Report generation failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ROBIN_Media_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('Report generation failed. Please try again.');
        }
        setGenerating(false);
    };


    useEffect(() => {
        (async () => {
            try {
                // 1. Sentiment — from analytics endpoint (response shape: { client, sentiment, avg_importance })
                const sentRes = await analyticsApi.sentiment() as { sentiment?: SentimentData };
                setSentiment(sentRes.sentiment ?? null);

                // 2. Velocity — dedicated /velocity endpoint (response shape: { data: VelocityPoint[] })
                const token = typeof window !== 'undefined' ? localStorage.getItem('robin_token') : null;
                const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
                const velRes = await fetch(`${BASE_URL}/api/test/velocity?days=14`, {
                    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                });
                if (velRes.ok) {
                    const velData = await velRes.json() as { data?: VelocityPoint[] };
                    setVelocity(velData.data ?? []);
                }

                // 3. Narratives — from intelligence endpoint
                const narRes = await intelligenceApi.narratives(6) as { data?: unknown[] };
                const narItems = narRes.data ?? [];
                // Map narrative object to Narrative interface — handle sentiment_breakdown field
                const mapped: Narrative[] = narItems.map((n: unknown) => {
                    const nr = n as Record<string, unknown>;
                    const sb = nr.sentiment_breakdown as { percentages?: { positive?: number; negative?: number; neutral?: number }; total?: number } | undefined;
                    return {
                        weekly_narrative: (nr.weekly_narrative as string) || (nr.executive_summary as string) || '',
                        dominant_sentiment: nr.dominant_sentiment as string,
                        positive_pct: sb?.percentages?.positive ?? (nr.positive_pct as number) ?? 0,
                        negative_pct: sb?.percentages?.negative ?? (nr.negative_pct as number) ?? 0,
                        neutral_pct: sb?.percentages?.neutral ?? (nr.neutral_pct as number) ?? 0,
                        emerging_themes: nr.emerging_themes as string[] | undefined,
                        pattern_date: nr.pattern_date as string | undefined,
                    };
                });
                setNarratives(mapped);
            } catch { /* graceful */ }
            setLoading(false);
        })();
    }, []);

    return (
        <div className="p-4 max-w-7xl">
            <div className="mb-5 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-text-primary">Reports & Analytics</h1>
                    <p className="text-sm text-text-muted mt-0.5">14-day velocity, sentiment distribution, and narrative synthesis</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleGenerateMediaReport}
                        disabled={generatingMedia}
                        className="btn btn-ghost text-xs flex items-center gap-1.5 border border-accent/30 hover:bg-accent/5"
                        title="Download a full daily media intelligence report with TV, Online & Newspaper sections, article images, and CM perception analysis"
                    >
                        {generatingMedia ? (
                            <><span className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" /> Generating…</>
                        ) : (
                            <><span style={{fontSize:'14px'}}>📰</span> Daily Media Report</>
                        )}
                    </button>
                    <button
                        onClick={() => setBuilderOpen(o => !o)}
                        className="btn btn-primary text-xs flex items-center gap-1.5"
                    >
                        <FileText size={14} /> Generate Report
                        {builderOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                </div>
            </div>

            {/* ── Report Builder ─────────────── */}
            {builderOpen && (
                <div className="card p-5 mb-5 border border-accent/20 animate-fade-in">
                    <h2 className="section-title mb-4 flex items-center gap-2">
                        <FileText size={14} className="text-accent" /> Report Builder
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Left column */}
                        <div className="space-y-4">
                            {/* Template */}
                            <div>
                                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Template</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {TEMPLATES.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => setTemplate(t.id)}
                                            className={cn(
                                                "px-3 py-1.5 rounded-md text-xs transition-colors",
                                                template === t.id
                                                    ? "bg-accent text-white"
                                                    : "bg-raised text-text-secondary border border-border hover:text-text-primary"
                                            )}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Period */}
                            <div>
                                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Period</label>
                                <div className="flex gap-1.5">
                                    {PERIODS.map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => setPeriod(p.id)}
                                            className={cn(
                                                "px-3 py-1.5 rounded-md text-xs transition-colors",
                                                period === p.id
                                                    ? "bg-overlay text-text-primary border border-border-active"
                                                    : "bg-raised text-text-muted border border-border"
                                            )}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Branding */}
                            <div>
                                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Header</label>
                                <input
                                    className="input text-xs w-full"
                                    value={headerText}
                                    onChange={e => setHeaderText(e.target.value)}
                                    placeholder="Report header text"
                                />
                            </div>

                            {/* Classification */}
                            <div>
                                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Classification</label>
                                <select
                                    value={classification}
                                    onChange={e => setClassification(e.target.value)}
                                    className="input text-xs w-full"
                                >
                                    <option value="public">Public</option>
                                    <option value="internal">Internal</option>
                                    <option value="confidential">Confidential</option>
                                    <option value="restricted">Restricted</option>
                                </select>
                            </div>
                        </div>

                        {/* Right column — Sections */}
                        <div>
                            <label className="text-xs font-medium text-text-secondary mb-1.5 block">Sections</label>
                            <div className="space-y-1.5">
                                {Object.entries(SECTION_LABELS).map(([key, label]) => (
                                    <label
                                        key={key}
                                        className={cn(
                                            "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors",
                                            sections[key] ? "bg-accent/5 text-text-primary" : "text-text-muted hover:bg-overlay"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={sections[key]}
                                            onChange={() => toggleSection(key)}
                                            className="accent-accent"
                                        />
                                        {label}
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border">
                        <button
                            onClick={handleGeneratePDF}
                            disabled={generating}
                            className="btn btn-primary text-xs flex items-center gap-1.5 min-w-[140px]"
                        >
                            {generating ? (
                                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating…</>
                            ) : (
                                <><Download size={14} /> Generate PDF</>
                            )}
                        </button>
                        <button
                            onClick={() => { const el = document.createElement('textarea'); el.value = `${headerText} — ${template} report for period ${period}`; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); alert('Report link copied to clipboard — email feature coming soon.'); }}
                            className="btn btn-ghost text-xs flex items-center gap-1.5"
                        >
                            <Mail size={14} /> Email to Stakeholders
                        </button>
                        <button
                            onClick={() => alert('Scheduled reports: daily at 06:00 IST — feature coming in next release.')}
                            className="btn btn-ghost text-xs flex items-center gap-1.5"
                        >
                            <ClockIcon size={14} /> Schedule
                        </button>
                        <span className="text-2xs text-text-muted ml-auto">
                            {Object.values(sections).filter(Boolean).length} sections selected · {TEMPLATES.find(t => t.id === template)?.label} · {PERIODS.find(p => p.id === period)?.label}
                        </span>
                    </div>

                </div>
            )}

            {/* Sentiment Summary */}
            {!loading && sentiment && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                        { label: "Positive", pct: sentiment.positive_pct, count: sentiment.positive, color: "text-emerald" },
                        { label: "Neutral", pct: sentiment.neutral_pct, count: sentiment.neutral, color: "text-text-secondary" },
                        { label: "Negative", pct: sentiment.negative_pct, count: sentiment.negative, color: "text-rose" },
                    ].map(s => (
                        <div key={s.label} className="stat-card">
                            <div className="stat-label">{s.label}</div>
                            <div className={cn("stat-value", s.color)}>{s.pct.toFixed(1)}%</div>
                            <div className="text-xs text-text-muted">{s.count.toLocaleString()} articles</div>
                        </div>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
                {/* Article Velocity Chart */}
                <div className="card">
                    <div className="section-header">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={14} className="text-accent" />
                            <span className="section-title">Article Velocity (14d)</span>
                        </div>
                    </div>
                    {loading ? (
                        <div className="skeleton h-48 rounded" />
                    ) : velocity.length === 0 ? (
                        <div className="flex items-center justify-center h-48 text-text-muted text-sm">No velocity data</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={200}>
                            <AreaChart data={velocity} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                                <defs>
                                    <linearGradient id="velGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={CHART_BLUE} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={CHART_BLUE} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a2840" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fill: "#4a5a73", fontSize: 10 }}
                                    tickFormatter={d => d.slice(5)}
                                    axisLine={false} tickLine={false}
                                />
                                <YAxis tick={{ fill: "#4a5a73", fontSize: 10 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ background: "#0d1525", border: "1px solid #1a2840", borderRadius: 6, fontSize: 12 }}
                                    labelStyle={{ color: "#8a9ab5" }}
                                    itemStyle={{ color: "#e2e8f2" }}
                                />
                                <Area
                                    type="monotone" dataKey="article_count" stroke={CHART_BLUE}
                                    strokeWidth={2} fill="url(#velGrad)" name="Articles"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Sentiment Breakdown Chart */}
                <div className="card">
                    <div className="section-header">
                        <div className="flex items-center gap-2">
                            <BarChart2 size={14} className="text-violet" />
                            <span className="section-title">Sentiment Distribution</span>
                        </div>
                    </div>
                    {loading ? (
                        <div className="skeleton h-48 rounded" />
                    ) : !sentiment ? (
                        <div className="flex items-center justify-center h-48 text-text-muted text-sm">No sentiment data</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart
                                data={[{ name: "Sentiment", positive: sentiment.positive, neutral: sentiment.neutral, negative: sentiment.negative }]}
                                margin={{ top: 5, right: 10, bottom: 5, left: -20 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a2840" vertical={false} />
                                <XAxis dataKey="name" tick={{ fill: "#4a5a73", fontSize: 10 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: "#4a5a73", fontSize: 10 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ background: "#0d1525", border: "1px solid #1a2840", borderRadius: 6, fontSize: 12 }}
                                    labelStyle={{ color: "#8a9ab5" }}
                                    itemStyle={{ color: "#e2e8f2" }}
                                />
                                <Legend wrapperStyle={{ fontSize: 11, color: "#8a9ab5" }} />
                                <Bar dataKey="positive" fill={CHART_GREEN} radius={[4, 4, 0, 0]} name="Positive" />
                                <Bar dataKey="neutral" fill={CHART_GRAY} radius={[4, 4, 0, 0]} name="Neutral" />
                                <Bar dataKey="negative" fill={CHART_RED} radius={[4, 4, 0, 0]} name="Negative" />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* Weekly Narratives */}
            <div className="card">
                <div className="section-header">
                    <div className="flex items-center gap-2">
                        <BarChart2 size={14} className="text-amber" />
                        <span className="section-title">Weekly Intelligence Narratives</span>
                    </div>
                </div>

                {loading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-16 rounded" />)}
                    </div>
                ) : narratives.length === 0 ? (
                    <div className="text-center py-8 text-text-muted text-sm">No narratives yet</div>
                ) : (
                    <div className="space-y-3">
                        {narratives.map((n, i) => {
                            // weekly_narrative can be plain text or a stringified JSON object
                            let displayText = n.weekly_narrative ?? "";
                            try {
                                const parsed = JSON.parse(displayText);
                                displayText = parsed.executive_summary || parsed.full_narrative || displayText;
                            } catch { /* not JSON, use as-is */ }
                            // Truncate very long narratives
                            if (displayText.length > 500) displayText = displayText.slice(0, 500) + "…";
                            return (
                                <div key={i} className="p-3 rounded-md bg-raised border border-border/60">
                                    <div className="flex items-start justify-between gap-3 mb-2">
                                        <p className="text-sm text-text-primary">{displayText}</p>
                                        <span className={cn("badge flex-shrink-0", sentimentColor(n.dominant_sentiment) === "text-emerald" ? "badge-emerald" : sentimentColor(n.dominant_sentiment) === "text-rose" ? "badge-rose" : "badge-muted")}>
                                            {n.dominant_sentiment}
                                        </span>
                                    </div>

                                    {/* Sentiment mini-bars */}
                                    <div className="flex items-center gap-1 mt-2">
                                        {[
                                            { label: "+", width: n.positive_pct, color: "bg-emerald" },
                                            { label: "~", width: n.neutral_pct, color: "bg-text-muted" },
                                            { label: "−", width: n.negative_pct, color: "bg-rose" },
                                        ].map(b => (
                                            <div key={b.label} className="flex items-center gap-1">
                                                <span className="text-2xs text-text-muted w-3">{b.label}</span>
                                                <div className="w-24 h-1 bg-overlay rounded-full overflow-hidden">
                                                    <div className={cn("h-full rounded-full", b.color)} style={{ width: `${b.width ?? 0}%` }} />
                                                </div>
                                                <span className="text-2xs text-text-muted w-8">{(b.width ?? 0).toFixed(0)}%</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Themes */}
                                    {(n.emerging_themes ?? []).length > 0 && (
                                        <div className="flex gap-1 mt-2 flex-wrap">
                                            {(n.emerging_themes ?? []).map(t => (
                                                <span key={t} className="badge badge-muted">{t}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
