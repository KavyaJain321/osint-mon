"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
    FileText, Plus, Loader2, ChevronDown, ChevronUp,
    CheckCircle, XCircle, Globe, Tag, MapPin, Clock,
    Zap, AlertCircle, Search, Rss, Monitor, Tv,
    FileDown, Chrome, RefreshCw, Trash2, Upload, Users,
    BarChart2, List
} from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";

type IntakeMode = "describe" | "entity" | "document";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const authFetch = async (url: string, options: RequestInit = {}, _retried = false): Promise<Response> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('robin_token') : null;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers ?? {}),
        },
    });

    // Auto-refresh on 401 (expired token) — retry once
    if (res.status === 401 && !_retried) {
        try {
            const refreshToken = localStorage.getItem('robin_refresh_token');
            if (refreshToken) {
                const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refreshToken }),
                });
                if (refreshRes.ok) {
                    const data = await refreshRes.json();
                    if (data.token) {
                        localStorage.setItem('robin_token', data.token);
                        if (data.refresh_token) localStorage.setItem('robin_refresh_token', data.refresh_token);
                        return authFetch(url, options, true);
                    }
                }
            }
        } catch { /* refresh failed — fall through */ }
        // Refresh also failed — session fully expired, redirect to login
        if (typeof window !== 'undefined') {
            localStorage.removeItem('robin_token');
            localStorage.removeItem('robin_refresh_token');
            window.location.href = '/auth/login';
        }
    }

    return res;
};

interface Brief {
    id: string;
    title: string;
    problem_statement: string;
    status: string;
    industry?: string;
    risk_domains?: string[];
    entities_of_interest?: string[];
    geographic_focus?: string[];
    intake_mode?: string;
    entity_names?: string[];
    created_at: string;
    activated_at?: string;
}

interface Keyword {
    id: string;
    keyword: string;
    keyword_en?: string;
    category: string;
    priority: number;
    rationale: string;
}

interface KeywordPerf {
    id: string;
    keyword: string;
    category: string;
    priority: number;
    rationale: string;
    match_count_7d: number;
    match_count_30d: number;
    last_matched_at: string | null;
}

interface Source {
    id: string;
    name: string;
    url: string;
    source_type: string;
    expected_hit_rate: string;
    rationale: string;
    url_validated?: boolean;
    url_status_code?: string;
}

const STATUS: Record<string, { label: string; class: string; dot: string }> = {
    processing: { label: "Processing", class: "badge-sky", dot: "bg-sky animate-pulse" },
    pending_review: { label: "Ready", class: "badge-emerald", dot: "bg-emerald" },
    approved: { label: "Approved", class: "badge-emerald", dot: "bg-emerald" },
    active: { label: "Active", class: "badge-emerald", dot: "bg-emerald" },
    failed: { label: "Failed", class: "badge-rose", dot: "bg-rose" },
};

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Rss; color: string }> = {
    rss: { label: "RSS Feeds", icon: Rss, color: "text-amber" },
    html: { label: "Websites", icon: Globe, color: "text-sky" },
    youtube: { label: "TV News Channels", icon: Tv, color: "text-rose" },
    pdf: { label: "Documents & PDFs", icon: FileDown, color: "text-violet" },
    browser: { label: "Browser Rendered", icon: Chrome, color: "text-emerald" },
    reddit: { label: "Reddit", icon: Monitor, color: "text-amber" },
    google_news: { label: "Google News", icon: Search, color: "text-sky" },
};

export default function BriefsPage() {
    const [brief, setBrief] = useState<Brief | null>(null);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [detail, setDetail] = useState<{ keywords: Keyword[]; sources: Source[] } | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [perf, setPerf] = useState<KeywordPerf[]>([]);
    const [perfLoading, setPerfLoading] = useState(false);
    const [perfView, setPerfView] = useState(false);
    const [title, setTitle] = useState("");
    const [problem, setProblem] = useState("");
    const [showReplaceWarning, setShowReplaceWarning] = useState(false);
    const [pushed, setPushed] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [intakeMode, setIntakeMode] = useState<IntakeMode>("describe");
    const [entityInput, setEntityInput] = useState("");
    const [docText, setDocText] = useState("");

    // Pipeline progress tracking
    interface PipelineProgress {
        stage: string;
        stageNumber: number;
        totalStages: number;
        label: string;
        message: string;
        startedAt: string | null;
        completedAt: string | null;
        details: Record<string, unknown>;
    }
    const [pipeline, setPipeline] = useState<PipelineProgress | null>(null);
    const [pipelineActive, setPipelineActive] = useState(false);

    const loadBrief = async (retryOnUnauth = true) => {
        try {
            const res = await authFetch(`${BASE}/api/briefs`);
            if (res.status === 401 && retryOnUnauth) {
                // Token may not be in localStorage yet (hydration race) — retry once after delay
                await new Promise(r => setTimeout(r, 500));
                return loadBrief(false);
            }
            if (!res.ok) { setLoading(false); return; }
            const data = await res.json();
            const briefs = data.data ?? data ?? [];
            const latest = Array.isArray(briefs) && briefs.length > 0 ? briefs[0] : null;
            setBrief(latest);
        } catch { /* silent */ }
        setLoading(false);
    };

    useEffect(() => { loadBrief(); }, []);

    // Poll while processing — and auto-push when done
    useEffect(() => {
        if (!brief || brief.status !== "processing") return;
        const interval = setInterval(async () => {
            await loadBrief();
        }, 5000);
        return () => clearInterval(interval);
    }, [brief]);

    // Pipeline progress polling — uses ref to avoid stale closure issues
    const pipelinePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        // Clear any existing interval on dependency change
        if (pipelinePollingRef.current) {
            clearInterval(pipelinePollingRef.current);
            pipelinePollingRef.current = null;
        }

        // Only start polling when pipelineActive is true
        if (!pipelineActive) return;

        const poll = async () => {
            try {
                const res = await fetch(`${BASE}/api/test/pipeline-progress`);
                if (res.ok) {
                    const data: PipelineProgress = await res.json();
                    setPipeline(data);
                    if (data.stage === 'complete') {
                        // Stop polling and refresh brief
                        setPipelineActive(false);
                        await loadBrief();
                    }
                }
            } catch { /* silent */ }
        };

        poll(); // immediate first fetch
        pipelinePollingRef.current = setInterval(poll, 2000);

        return () => {
            if (pipelinePollingRef.current) {
                clearInterval(pipelinePollingRef.current);
                pipelinePollingRef.current = null;
            }
        };
    }, [pipelineActive]);

    // Also auto-start pipeline polling when brief is processing (page reload scenario)
    useEffect(() => {
        if (brief?.status === 'processing' || brief?.status === 'active') {
            // Check if pipeline is running on page load
            fetch(`${BASE}/api/test/pipeline-progress`)
                .then(r => r.json())
                .then((data: PipelineProgress) => {
                    if (data.stage !== 'idle') {
                        setPipeline(data);
                        if (data.stage !== 'complete') {
                            setPipelineActive(true);
                        }
                    }
                })
                .catch(() => { /* silent */ });
        }
    }, [brief?.status]);

    // Auto-push sources when brief transitions to active/pending_review
    useEffect(() => {
        if (!brief || brief.status === "processing" || pushed) return;
        (async () => {
            try {
                await authFetch(`${BASE}/api/briefs/${brief.id}/push`, { method: "POST" });
                setPushed(true);
            } catch { /* silent */ }
        })();
    }, [brief?.id, brief?.status, pushed]);

    // Load detail when brief is available and not processing
    useEffect(() => {
        if (!brief || brief.status === "processing") return;
        (async () => {
            setDetailLoading(true);
            try {
                const res = await authFetch(`${BASE}/api/briefs/${brief.id}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setDetail({ keywords: data.keywords ?? [], sources: data.recommended_sources ?? [] });
            } catch { /* silent */ }
            setDetailLoading(false);
        })();
    }, [brief?.id, brief?.status]);

    // Load keyword performance when brief is active
    useEffect(() => {
        if (!brief || brief.status !== "active") return;
        (async () => {
            setPerfLoading(true);
            try {
                const res = await authFetch(`${BASE}/api/keywords/performance`);
                if (res.ok) setPerf(await res.json());
            } catch { /* silent */ }
            setPerfLoading(false);
        })();
    }, [brief?.id, brief?.status]);

    const submitBrief = async () => {
        // Build problem_statement based on mode
        let finalProblem = problem;
        let entityNames: string[] = [];
        setSubmitError(null);

        if (intakeMode === "entity") {
            const names = entityInput.split(",").map(n => n.trim()).filter(Boolean);
            entityNames = names;
            if (!names.length) { setSubmitError("Please enter at least one entity name."); return; }
            finalProblem = problem.trim() || `Monitor and analyze all media coverage, regulatory actions, financial developments, and public sentiment related to: ${names.join(", ")}. Track key stakeholders, competitors, and emerging risks.`;
        } else if (intakeMode === "document") {
            finalProblem = docText.trim() || problem.trim();
        }

        if (!title.trim()) { setSubmitError("Title is required."); return; }
        if (finalProblem.length < 50) { setSubmitError("Problem statement must be at least 50 characters."); return; }

        setSubmitting(true);
        setShowReplaceWarning(false);
        try {
            const res = await authFetch(`${BASE}/api/briefs`, {
                method: "POST",
                body: JSON.stringify({
                    title: title.trim(),
                    problem_statement: finalProblem.trim(),
                    intake_mode: intakeMode,
                    entity_names: entityNames,
                }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({})) as Record<string, string>;
                setSubmitError(errBody.error || `Server error (${res.status}). Please try again.`);
                setSubmitting(false);
                return;
            }
            setTitle("");
            setProblem("");
            setEntityInput("");
            setDocText("");
            setSubmitError(null);
            setShowForm(false);
            setDetail(null);
            setPipelineActive(true);  // Start polling pipeline progress
            setPipeline(null);        // Reset old pipeline state
            await loadBrief();
        } catch (e: unknown) {
            setSubmitError(e instanceof Error ? e.message : "Network error. Is the backend running?");
        }
        setSubmitting(false);
    };

    const openNewBriefForm = () => {
        if (brief) {
            // Existing brief — show replace warning
            setShowReplaceWarning(true);
        } else {
            setShowForm(true);
        }
    };

    const confirmReplace = () => {
        setShowReplaceWarning(false);
        setShowForm(true);
    };

    // Group sources by type
    const groupByType = (sources: Source[]) => {
        const groups: Record<string, Source[]> = {};
        for (const s of sources) {
            const t = s.source_type || "html";
            if (!groups[t]) groups[t] = [];
            groups[t].push(s);
        }
        return groups;
    };

    const showStartScreen = !loading && !brief && !showForm;

    return (
        <div className="p-4 max-w-4xl">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
                <div>
                    <h1 className="text-xl font-semibold text-text-primary">Situation Brief</h1>
                    <p className="text-sm text-text-muted mt-0.5">
                        Describe your problem → AI generates keywords → discovers sources → auto-starts scraping
                    </p>
                </div>
                {!showStartScreen && !showForm && !submitting && (
                    <button onClick={openNewBriefForm} className="btn btn-primary text-xs">
                        {brief ? <><RefreshCw size={13} /> Replace Brief</> : <><Plus size={13} /> New Brief</>}
                    </button>
                )}
            </div>

            {/* Replace Warning Modal */}
            {showReplaceWarning && (
                <div className="card mb-5 border-2 border-amber/30 animate-fade-in">
                    <div className="flex items-start gap-3">
                        <AlertCircle size={20} className="text-amber flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold text-text-primary mb-1">Replace Current Brief?</h3>
                            <p className="text-xs text-text-secondary mb-3">
                                This will <span className="text-amber font-medium">delete all existing data</span> — articles, situation signals,
                                entity profiles, threat assessments, and sources. The dashboard will be empty until new data
                                is collected from the new brief&apos;s sources.
                            </p>
                            <div className="flex gap-2">
                                <button onClick={confirmReplace} className="btn btn-primary text-xs">
                                    <Trash2 size={12} /> Yes, Replace Everything
                                </button>
                                <button onClick={() => setShowReplaceWarning(false)} className="btn btn-ghost text-xs">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Start Screen — no brief exists */}
            {showStartScreen && (
                <div className="text-center py-16 animate-fade-in">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-raised border border-border mb-4">
                        <Search size={28} className="text-text-muted" />
                    </div>
                    <h2 className="text-lg font-medium text-text-primary mb-1">Start with your monitoring objective</h2>
                    <p className="text-sm text-text-muted max-w-md mx-auto mb-5">
                        Describe what you need to monitor. ROBIN will generate keywords, discover sources,
                        and automatically start scraping — populating your entire dashboard.
                    </p>
                    <div className="flex items-center justify-center gap-2 mb-6 flex-wrap">
                        {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                            const Icon = cfg.icon;
                            return (
                                <span key={key} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-raised border border-border text-xs text-text-secondary">
                                    <Icon size={12} className={cfg.color} />
                                    {cfg.label}
                                </span>
                            );
                        })}
                    </div>
                    <button onClick={() => setShowForm(true)} className="btn btn-primary">
                        <Plus size={14} /> Submit Situation Brief
                    </button>
                </div>
            )}

            {/* Submission Form */}
            {showForm && (
                <div className="card mb-5 animate-fade-in">
                    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <FileText size={12} className="text-accent" />
                        {brief ? "Replace Situation Brief" : "Create Situation Brief"}
                    </div>

                    {/* ── Intake Mode Tabs ── */}
                    <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-base border border-border">
                        {[
                            { mode: "describe" as IntakeMode, label: "Describe Problem", icon: Search },
                            { mode: "entity" as IntakeMode, label: "Entity Name", icon: Users },
                            { mode: "document" as IntakeMode, label: "Paste Document", icon: Upload },
                        ].map(tab => {
                            const Icon = tab.icon;
                            const active = intakeMode === tab.mode;
                            return (
                                <button
                                    key={tab.mode}
                                    onClick={() => setIntakeMode(tab.mode)}
                                    className={cn(
                                        "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all",
                                        active ? "bg-raised text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"
                                    )}
                                >
                                    <Icon size={13} className={active ? "text-accent" : ""} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="space-y-3">
                        {/* Title — shared across all modes */}
                        <input
                            type="text"
                            placeholder="Brief title — e.g. 'Pakistan Financial Sector Risk Assessment'"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            className="input"
                            autoFocus
                        />

                        {/* ── Mode: Describe Problem ── */}
                        {intakeMode === "describe" && (
                            <>
                                <textarea
                                    placeholder="Describe your monitoring objective in detail (min 50 chars). What threats concern you? What entities, industries, or regions should we monitor? What kind of information do you need?"
                                    value={problem}
                                    onChange={e => setProblem(e.target.value)}
                                    rows={5}
                                    className="input resize-none"
                                />
                                <div className="flex items-center justify-between">
                                    <span className={cn("text-2xs", problem.length >= 50 ? "text-emerald" : "text-text-muted")}>
                                        {problem.length}/50 min characters
                                    </span>
                                </div>
                            </>
                        )}

                        {/* ── Mode: Entity Name ── */}
                        {intakeMode === "entity" && (
                            <>
                                <input
                                    type="text"
                                    placeholder="Entity names (comma-separated) — e.g. 'Odisha Mining Corp, Tata Steel, POSCO'"
                                    value={entityInput}
                                    onChange={e => setEntityInput(e.target.value)}
                                    className="input"
                                />
                                {entityInput.trim() && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {entityInput.split(",").map((n, i) => n.trim() && (
                                            <span key={i} className="badge badge-muted text-2xs">
                                                <Users size={9} className="mr-0.5" />{n.trim()}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <textarea
                                    placeholder="(Optional) Additional context about what to monitor for these entities..."
                                    value={problem}
                                    onChange={e => setProblem(e.target.value)}
                                    rows={3}
                                    className="input resize-none"
                                />
                                <p className="text-2xs text-text-muted">
                                    ROBIN will auto-generate a comprehensive monitoring brief for the named entities.
                                </p>
                            </>
                        )}

                        {/* ── Mode: Paste Document ── */}
                        {intakeMode === "document" && (
                            <>
                                <textarea
                                    placeholder="Paste document text here — internal memo, report, threat briefing, news article, or any text you want ROBIN to analyze and build monitoring around (min 50 chars)..."
                                    value={docText}
                                    onChange={e => setDocText(e.target.value)}
                                    rows={8}
                                    className="input resize-none font-mono text-xs"
                                />
                                <div className="flex items-center justify-between">
                                    <span className={cn("text-2xs", docText.length >= 50 ? "text-emerald" : "text-text-muted")}>
                                        {docText.length} chars {docText.length < 50 ? "(min 50)" : "✓"}
                                    </span>
                                </div>
                            </>
                        )}

                        {/* Error banner */}
                        {submitError && (
                            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                                <span>{submitError}</span>
                            </div>
                        )}

                        {/* Submit bar */}
                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button onClick={() => { setShowForm(false); setSubmitError(null); }} className="btn btn-ghost text-xs">Cancel</button>
                            <button
                                onClick={submitBrief}
                                disabled={
                                    !title.trim() ||
                                    (intakeMode === "describe" && problem.length < 50) ||
                                    (intakeMode === "entity" && !entityInput.trim()) ||
                                    (intakeMode === "document" && docText.length < 50) ||
                                    submitting
                                }
                                className="btn btn-primary text-xs"
                            >
                                {submitting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                                {submitting ? "Processing…" : brief ? "Replace & Activate" : "Generate Keywords & Sources"}
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* Loading skeleton */}
            {loading && (
                <div className="space-y-2">
                    {Array.from({ length: 1 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-lg" />)}
                </div>
            )}

            {/* Active Brief Detail */}
            {!loading && brief && !showForm && (
                <div className="card border border-border animate-fade-in">
                    {/* Brief Header */}
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                {(() => {
                                    const cfg = STATUS[brief.status] ?? { label: brief.status, class: "badge-muted", dot: "bg-text-muted" };
                                    return (
                                        <>
                                            <div className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                                            <span className={cn("badge", cfg.class)}>{cfg.label}</span>
                                        </>
                                    );
                                })()}
                                {brief.industry && <span className="badge badge-muted">{brief.industry}</span>}
                                <span className="text-2xs text-text-muted">{formatRelative(brief.created_at)}</span>
                            </div>
                            <h3 className="text-sm font-medium text-text-primary mb-0.5">{brief.title}</h3>
                            <p className="text-xs text-text-secondary">{brief.problem_statement}</p>
                        </div>
                        {brief.status === "processing" && <Loader2 size={14} className="text-sky animate-spin" />}
                    </div>

                    {/* Context tags */}
                    {(brief.entities_of_interest?.length || brief.geographic_focus?.length || brief.risk_domains?.length) ? (
                        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                            {brief.entities_of_interest?.map((e, i) => (
                                <span key={`e-${i}`} className="badge badge-muted text-2xs"><Tag size={8} className="mr-0.5" />{e}</span>
                            ))}
                            {brief.geographic_focus?.map((g, i) => (
                                <span key={`g-${i}`} className="badge badge-muted text-2xs"><MapPin size={8} className="mr-0.5" />{g}</span>
                            ))}
                            {brief.risk_domains?.map((r, i) => (
                                <span key={`r-${i}`} className="badge badge-muted text-2xs"><AlertCircle size={8} className="mr-0.5" />{r}</span>
                            ))}
                        </div>
                    ) : null}

                    {/* Detail: Keywords + Sources */}
                    {brief.status !== "processing" && (
                        <div className="mt-4 pt-4 border-t border-border">
                            {detailLoading ? (
                                <div className="flex items-center gap-2 py-8 justify-center text-text-muted">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span className="text-xs">Loading keywords and sources…</span>
                                </div>
                            ) : detail ? (
                                <div className="space-y-4">
                                    {/* Keywords — category view or performance view */}
                                    <div>
                                        {/* Header row with toggle */}
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="text-2xs uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                                                <Tag size={10} className="text-accent" />
                                                Keywords ({detail.keywords.length})
                                                {perf.length > 0 && (() => {
                                                    const dead = perf.filter(p => p.match_count_7d === 0).length;
                                                    const low  = perf.filter(p => p.match_count_7d > 0 && p.match_count_7d <= 5).length;
                                                    return dead > 0 ? (
                                                        <span className="ml-1 text-rose text-2xs">· {dead} inactive</span>
                                                    ) : low > 0 ? (
                                                        <span className="ml-1 text-amber text-2xs">· {low} low activity</span>
                                                    ) : null;
                                                })()}
                                            </div>
                                            {brief?.status === 'active' && (
                                                <button
                                                    onClick={() => setPerfView(v => !v)}
                                                    className={cn("flex items-center gap-1 text-2xs px-2 py-0.5 rounded border transition-colors",
                                                        perfView
                                                            ? "border-accent text-accent bg-accent/10"
                                                            : "border-border text-text-muted hover:text-text-primary"
                                                    )}
                                                >
                                                    {perfView ? <><List size={10} /> Category</> : <><BarChart2 size={10} /> Performance</>}
                                                </button>
                                            )}
                                        </div>

                                        {detail.keywords.length === 0 ? (
                                            <p className="text-xs text-text-muted py-2">No keywords generated</p>
                                        ) : perfView && perf.length > 0 ? (
                                            /* ── Performance View ── */
                                            <div className="space-y-1">
                                                {perfLoading ? (
                                                    <div className="flex items-center gap-2 py-4 text-text-muted justify-center">
                                                        <Loader2 size={12} className="animate-spin" />
                                                        <span className="text-xs">Loading performance data…</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* Summary stats */}
                                                        <div className="grid grid-cols-3 gap-2 mb-3">
                                                            {[
                                                                { label: 'Active', count: perf.filter(p => p.match_count_7d > 5).length, color: 'text-emerald' },
                                                                { label: 'Low', count: perf.filter(p => p.match_count_7d > 0 && p.match_count_7d <= 5).length, color: 'text-amber' },
                                                                { label: 'Inactive', count: perf.filter(p => p.match_count_7d === 0).length, color: 'text-rose' },
                                                            ].map(s => (
                                                                <div key={s.label} className="text-center p-2 rounded bg-raised border border-border">
                                                                    <div className={cn("text-lg font-bold", s.color)}>{s.count}</div>
                                                                    <div className="text-2xs text-text-muted">{s.label}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {/* Keyword rows sorted by match count */}
                                                        <div className="rounded border border-border overflow-hidden">
                                                            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 bg-raised text-2xs text-text-muted uppercase tracking-wider border-b border-border">
                                                                <span>Keyword</span>
                                                                <span className="text-right">7d</span>
                                                                <span className="text-right">30d</span>
                                                            </div>
                                                            <div className="max-h-64 overflow-y-auto divide-y divide-border">
                                                                {perf.map(p => {
                                                                    const status = p.match_count_7d > 5 ? 'active'
                                                                        : p.match_count_7d > 0 ? 'low' : 'dead';
                                                                    const dot = status === 'active' ? 'bg-emerald' : status === 'low' ? 'bg-amber' : 'bg-rose';
                                                                    const lastSeen = p.last_matched_at
                                                                        ? new Date(p.last_matched_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                                                                        : 'Never';
                                                                    return (
                                                                        <div key={p.id} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 items-center hover:bg-raised/50 transition-colors">
                                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                                <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", dot)} />
                                                                                <span className="text-xs text-text-primary truncate font-medium">{p.keyword}</span>
                                                                                <span className="text-2xs text-text-muted flex-shrink-0">· {lastSeen}</span>
                                                                            </div>
                                                                            <span className={cn("text-xs font-mono text-right tabular-nums",
                                                                                status === 'active' ? 'text-emerald' : status === 'low' ? 'text-amber' : 'text-text-muted'
                                                                            )}>{p.match_count_7d}</span>
                                                                            <span className="text-xs font-mono text-right tabular-nums text-text-muted">{p.match_count_30d}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        ) : (() => {
                                            /* ── Category View (default) ── */
                                            // Build perf lookup by keyword text for dot indicators
                                            const perfMap: Record<string, KeywordPerf> = {};
                                            for (const p of perf) perfMap[p.keyword] = p;

                                            const groups: Record<string, Keyword[]> = {};
                                            for (const kw of detail.keywords) {
                                                const cat = kw.category || 'other';
                                                if (!groups[cat]) groups[cat] = [];
                                                groups[cat].push(kw);
                                            }

                                            const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
                                                core_entity: { label: 'Core Entities', color: 'text-sky' },
                                                industry_sector: { label: 'Industry Terms', color: 'text-violet' },
                                                regulatory_legal: { label: 'Regulatory & Legal', color: 'text-rose' },
                                                geographic: { label: 'Geographic', color: 'text-emerald' },
                                                competitor_peer: { label: 'Competitors', color: 'text-amber' },
                                                stakeholder: { label: 'Stakeholders', color: 'text-cyan' },
                                                sentiment: { label: 'Sentiment Triggers', color: 'text-rose' },
                                                abstract_lateral: { label: 'Lateral Connections', color: 'text-violet' },
                                                proxy_indicator: { label: 'Proxy Indicators', color: 'text-emerald' },
                                                narrative: { label: 'Narrative Triggers', color: 'text-amber' },
                                                primary: { label: 'Primary', color: 'text-sky' },
                                                entity: { label: 'Entities', color: 'text-sky' },
                                                semantic: { label: 'Semantic', color: 'text-violet' },
                                                competitive: { label: 'Competitive', color: 'text-amber' },
                                                temporal: { label: 'Temporal', color: 'text-emerald' },
                                                negative: { label: 'Negative', color: 'text-rose' },
                                                other: { label: 'Other', color: 'text-text-muted' },
                                            };
                                            const categoryOrder = [
                                                'core_entity','industry_sector','regulatory_legal','geographic',
                                                'competitor_peer','stakeholder','sentiment','abstract_lateral',
                                                'proxy_indicator','narrative','primary','entity','semantic',
                                                'competitive','temporal','negative','other',
                                            ];
                                            const sortedCats = Object.keys(groups).sort((a, b) => {
                                                const ai = categoryOrder.indexOf(a);
                                                const bi = categoryOrder.indexOf(b);
                                                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                                            });

                                            return (
                                                <div className="space-y-3">
                                                    {sortedCats.map(cat => {
                                                        const cfg = CATEGORY_CONFIG[cat] || { label: cat, color: 'text-text-muted' };
                                                        const kws = groups[cat];
                                                        return (
                                                            <div key={cat}>
                                                                <div className="flex items-center gap-1.5 mb-1.5">
                                                                    <span className={cn("text-2xs font-medium uppercase tracking-wider", cfg.color)}>{cfg.label}</span>
                                                                    <span className="text-2xs text-text-muted">· {kws.length}</span>
                                                                </div>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {kws.map(kw => {
                                                                        const p = perfMap[kw.keyword];
                                                                        const dot = !p ? null
                                                                            : p.match_count_7d > 5 ? 'bg-emerald'
                                                                            : p.match_count_7d > 0 ? 'bg-amber'
                                                                            : 'bg-rose';
                                                                        const title = p
                                                                            ? `${p.match_count_7d} matches (7d) · ${p.match_count_30d} matches (30d)${kw.rationale ? '\n' + kw.rationale : ''}`
                                                                            : kw.rationale;
                                                                        return (
                                                                            <span key={kw.id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-raised border border-border text-xs text-text-primary" title={title}>
                                                                                {dot && <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", dot)} />}
                                                                                <span className="font-medium">{kw.keyword_en || kw.keyword}</span>
                                                                                {kw.priority >= 8 && <span className="text-amber text-2xs">★</span>}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {/* Sources by Type */}
                                    <div>
                                        <div className="text-2xs uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
                                            <Globe size={10} className="text-accent" />
                                            Discovered Sources ({detail.sources.length})
                                        </div>

                                        {detail.sources.length === 0 ? (
                                            <p className="text-xs text-text-muted py-2">No sources discovered</p>
                                        ) : (
                                            <div className="space-y-3">
                                                {/* Type summary */}
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {Object.entries(groupByType(detail.sources)).map(([type, srcs]) => {
                                                        const tcfg = TYPE_CONFIG[type] ?? { label: type, icon: Globe, color: "text-text-muted" };
                                                        const Icon = tcfg.icon;
                                                        return (
                                                            <span key={type} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-raised border border-border text-2xs text-text-secondary">
                                                                <Icon size={10} className={tcfg.color} />
                                                                {tcfg.label} · {srcs.length}
                                                            </span>
                                                        );
                                                    })}
                                                </div>

                                                {/* Source groups */}
                                                {Object.entries(groupByType(detail.sources)).map(([type, srcs]) => {
                                                    const tcfg = TYPE_CONFIG[type] ?? { label: type, icon: Globe, color: "text-text-muted" };
                                                    const Icon = tcfg.icon;
                                                    return (
                                                        <div key={type}>
                                                            <div className="flex items-center gap-1.5 mb-1.5">
                                                                <Icon size={12} className={tcfg.color} />
                                                                <span className="text-xs font-medium text-text-secondary">{tcfg.label}</span>
                                                            </div>
                                                            <div className="space-y-1">
                                                                {srcs.map(src => (
                                                                    <div key={src.id} className="flex items-center justify-between p-2 rounded bg-raised border border-border/60 group">
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                                <span className="text-xs text-text-primary font-medium truncate">{src.name}</span>
                                                                                {src.url_validated === true && <CheckCircle size={10} className="text-emerald flex-shrink-0" />}
                                                                                {src.url_validated === false && <XCircle size={10} className="text-rose flex-shrink-0" />}
                                                                            </div>
                                                                            <a href={src.url} target="_blank" rel="noopener noreferrer"
                                                                                className="text-2xs text-text-muted hover:text-accent truncate block">
                                                                                {src.url}
                                                                            </a>
                                                                        </div>
                                                                        <span className={cn(
                                                                            "badge text-2xs flex-shrink-0 ml-2",
                                                                            src.expected_hit_rate === "high" ? "badge-emerald" :
                                                                                src.expected_hit_rate === "medium" ? "badge-amber" : "badge-muted"
                                                                        )}>
                                                                            {src.expected_hit_rate}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : null}

                            {/* Timeline */}
                            <div className="mt-3 pt-2 border-t border-border flex items-center gap-3 text-2xs text-text-muted">
                                <span className="flex items-center gap-1"><Clock size={9} /> Created {formatRelative(brief.created_at)}</span>
                                {brief.activated_at && (
                                    <span className="flex items-center gap-1"><Zap size={9} className="text-emerald" /> Activated {formatRelative(brief.activated_at)}</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Pipeline Progress Tracker ── */}
                    {pipeline && pipeline.stage !== 'idle' && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <div className="flex items-center gap-2 mb-3">
                                <Zap size={12} className="text-sky" />
                                <span className="text-xs font-mono font-medium text-text-secondary tracking-wide">PIPELINE STATUS</span>
                                {pipeline.stage !== 'complete' && (
                                    <Loader2 size={12} className="text-sky animate-spin ml-auto" />
                                )}
                                {pipeline.stage === 'complete' && (
                                    <CheckCircle size={12} className="text-emerald ml-auto" />
                                )}
                            </div>

                            {/* Stage steps */}
                            <div className="space-y-1">
                                {[
                                    { id: 'keywords', num: 1, label: 'Generating Keywords', icon: '🔑' },
                                    { id: 'sources', num: 2, label: 'Discovering Sources', icon: '🔍' },
                                    { id: 'scraping', num: 3, label: 'Scraping Sources', icon: '🌐' },
                                    { id: 'analysis', num: 4, label: 'AI Article Analysis', icon: '🧠' },
                                    { id: 'intelligence', num: 5, label: 'Analysis Engine', icon: '⚡' },
                                    { id: 'complete', num: 6, label: 'Complete', icon: '✅' },
                                ].map((step) => {
                                    const isActive = pipeline.stage === step.id;
                                    const isDone = pipeline.stageNumber > step.num || pipeline.stage === 'complete';
                                    const isPending = pipeline.stageNumber < step.num && pipeline.stage !== 'complete';

                                    return (
                                        <div key={step.id} className={`flex items-start gap-2.5 px-2.5 py-1.5 rounded transition-all ${isActive ? 'bg-sky/5 border border-sky/20' :
                                            isDone ? 'opacity-70' : 'opacity-40'
                                            }`}>
                                            {/* Step indicator */}
                                            <div className="flex-shrink-0 mt-0.5">
                                                {isDone ? (
                                                    <div className="w-4 h-4 rounded-full bg-emerald/20 flex items-center justify-center">
                                                        <CheckCircle size={10} className="text-emerald" />
                                                    </div>
                                                ) : isActive ? (
                                                    <div className="w-4 h-4 rounded-full bg-sky/20 flex items-center justify-center">
                                                        <Loader2 size={10} className="text-sky animate-spin" />
                                                    </div>
                                                ) : (
                                                    <div className="w-4 h-4 rounded-full bg-border/40 flex items-center justify-center">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-text-muted/30" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Step content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs">{step.icon}</span>
                                                    <span className={`text-xs font-medium ${isActive ? 'text-sky' :
                                                        isDone ? 'text-text-secondary' : 'text-text-muted'
                                                        }`}>
                                                        {step.label}
                                                    </span>
                                                </div>
                                                {isActive && pipeline.message && (
                                                    <p className="text-2xs text-text-muted mt-0.5 leading-relaxed">
                                                        {pipeline.message}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Overall progress bar */}
                            <div className="mt-3 px-2.5">
                                <div className="h-1.5 bg-border/30 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-700 ease-out ${pipeline.stage === 'complete' ? 'bg-emerald' : 'bg-sky'
                                            }`}
                                        style={{ width: `${Math.round((pipeline.stageNumber / pipeline.totalStages) * 100)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between mt-1">
                                    <span className="text-2xs text-text-muted font-mono">
                                        {pipeline.stage === 'complete' ? 'All data ready!' : `Stage ${pipeline.stageNumber}/${pipeline.totalStages}`}
                                    </span>
                                    {pipeline.startedAt && pipeline.stage !== 'complete' && (
                                        <span className="text-2xs text-text-muted font-mono">
                                            {Math.round((Date.now() - new Date(pipeline.startedAt).getTime()) / 1000)}s elapsed
                                        </span>
                                    )}
                                    {pipeline.completedAt && (
                                        <span className="text-2xs text-emerald font-mono">
                                            Done in {Math.round((new Date(pipeline.completedAt).getTime() - new Date(pipeline.startedAt!).getTime()) / 1000)}s
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Completion message */}
                            {pipeline.stage === 'complete' && (
                                <div className="mt-3 mx-2.5 p-2.5 rounded bg-emerald/5 border border-emerald/20">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={14} className="text-emerald flex-shrink-0" />
                                        <div>
                                            <p className="text-xs text-emerald font-medium">Pipeline Complete!</p>
                                            <p className="text-2xs text-text-muted mt-0.5">
                                                All data is populated. Check Overview, Analysis, and Signals pages.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Processing indicator (brief still in processing status) */}
                    {brief.status === "processing" && (!pipeline || pipeline.stage === 'idle') && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <div className="flex items-center gap-3 py-4 justify-center">
                                <Loader2 size={16} className="text-sky animate-spin" />
                                <div>
                                    <p className="text-xs text-text-primary font-medium">AI is processing your brief…</p>
                                    <p className="text-2xs text-text-muted">Generating keywords and discovering sources. This usually takes 15-30 seconds.</p>
                                </div>
                            </div>
                            {/* Show retry button after 30s of processing */}
                            {new Date().getTime() - new Date(brief.created_at).getTime() > 30000 && (
                                <div className="flex justify-center pb-2">
                                    <button
                                        onClick={async () => {
                                            try {
                                                await fetch(`${BASE}/api/test/briefs/${brief.id}/retry`, { method: "POST" });
                                                await loadBrief();
                                            } catch { /* silent */ }
                                        }}
                                        className="btn btn-ghost text-xs text-amber hover:text-amber"
                                    >
                                        <RefreshCw size={12} /> Retry Processing
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Failed state */}
                    {brief.status === "failed" && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <div className="flex items-center gap-3 py-4 justify-center">
                                <XCircle size={16} className="text-rose" />
                                <div>
                                    <p className="text-xs text-text-primary font-medium">Brief processing failed</p>
                                    <p className="text-2xs text-text-muted">The AI pipeline encountered an error. Try reprocessing.</p>
                                </div>
                                <button
                                    onClick={async () => {
                                        try {
                                            await fetch(`${BASE}/api/test/briefs/${brief.id}/retry`, { method: "POST" });
                                            await loadBrief();
                                        } catch { /* silent */ }
                                    }}
                                    className="btn btn-primary text-xs ml-2"
                                >
                                    <RefreshCw size={12} /> Retry
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
