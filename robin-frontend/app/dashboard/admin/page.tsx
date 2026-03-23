"use client";

import { useEffect, useState } from "react";
import { Shield, Users, BarChart2, Activity, Play, RefreshCw, Languages } from "lucide-react";
import { adminApi } from "@/lib/api";
import { formatRelative, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Client {
    id: string;
    name: string;
    industry?: string;
    is_active: boolean;
    article_count?: number;
    signal_count?: number;
    created_at: string;
}

interface SystemHealth {
    status: string;
    uptime?: number;
    database?: Record<string, unknown>;
    scraper_running?: boolean;
    version?: string;
}

export default function AdminPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [health, setHealth] = useState<SystemHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [triggerMsg, setTriggerMsg] = useState("");
    const [translateMsg, setTranslateMsg] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const [cl, hl] = await Promise.all([
                    adminApi.clients() as Promise<{ data?: Client[] }>,
                    adminApi.health() as Promise<SystemHealth>,
                ]);
                setClients(cl.data ?? []);
                setHealth(hl);
            } catch { /* graceful */ }
            setLoading(false);
        })();
    }, []);

    const runTitleTranslation = async () => {
        setTranslateMsg("Starting translation…");
        try {
            const data = await adminApi.translateTitles() as { message?: string; total_to_translate?: number };
            setTranslateMsg(data.message || "✓ Translation started");
        } catch {
            setTranslateMsg("⚠ Failed to start translation");
        }
        setTimeout(() => setTranslateMsg(""), 8000);
    };

    const triggerScrape = async (clientId: string) => {
        setTriggerMsg("Triggering scrape…");
        try {
            await adminApi.scrape(clientId);
            setTriggerMsg("✓ Scrape dispatched");
        } catch {
            setTriggerMsg("⚠ Failed to trigger");
        }
        setTimeout(() => setTriggerMsg(""), 3000);
    };

    return (
        <div className="p-4 max-w-6xl">
            <div className="mb-5">
                <h1 className="text-xl font-semibold text-text-primary">Admin Console</h1>
                <p className="text-sm text-text-muted mt-0.5">System health, client management, and operations</p>
            </div>

            {/* System Health */}
            {!loading && health && (
                <div className="card mb-4 border-l-2 border-emerald relative overflow-hidden">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-2xs uppercase tracking-widest text-text-muted mb-1">System Health</div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                    <div className={cn("w-2 h-2 rounded-full", health.status === "ok" ? "bg-emerald animate-pulse-slow" : "bg-rose")} />
                                    <span className="text-sm font-medium text-text-primary capitalize">{health.status}</span>
                                </div>
                                {health.scraper_running !== undefined && (
                                    <span className={cn("badge", health.scraper_running ? "badge-amber" : "badge-muted")}>
                                        Scraper {health.scraper_running ? "Running" : "Idle"}
                                    </span>
                                )}
                                {health.uptime !== undefined && (
                                    <span className="text-xs text-text-muted">
                                        Uptime: <span className="text-text-secondary font-mono">{Math.floor(health.uptime)}s</span>
                                    </span>
                                )}
                                {health.version && (
                                    <span className="text-xs text-text-muted font-mono">{health.version}</span>
                                )}
                            </div>
                        </div>
                        <Shield size={20} className="text-emerald/60 flex-shrink-0" />
                    </div>
                </div>
            )}

            {/* Stats row */}
            {!loading && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="stat-card">
                        <div className="stat-label">Total Clients</div>
                        <div className="stat-value">{clients.length}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Active Clients</div>
                        <div className="stat-value text-emerald">{clients.filter(c => c.is_active).length}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Total Articles</div>
                        <div className="stat-value">{formatNumber(clients.reduce((s, c) => s + (c.article_count ?? 0), 0))}</div>
                    </div>
                </div>
            )}

            {/* One-time migrations */}
            <div className="card p-4 mb-3">
                <div className="section-title mb-3">System Migrations</div>
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex flex-col gap-1">
                        <button
                            onClick={runTitleTranslation}
                            className="btn btn-secondary gap-2 text-sm"
                        >
                            <Languages size={14} />
                            Translate All Odia Titles to English
                        </button>
                        <span className="text-xs text-text-muted">Translates all existing article titles that are in Odia/Hindi. Runs in background.</span>
                    </div>
                    {translateMsg && (
                        <span className="text-xs text-accent-bright bg-accent-bright/10 border border-accent-bright/20 px-3 py-1.5 rounded">
                            {translateMsg}
                        </span>
                    )}
                </div>
            </div>

            {/* Clients table */}
            <div className="card p-0 overflow-hidden mb-3">
                <div className="px-4 py-3 border-b border-border bg-raised flex items-center justify-between">
                    <span className="section-title">Client Management</span>
                    {triggerMsg && <span className="text-xs text-text-secondary">{triggerMsg}</span>}
                </div>
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-border bg-raised/50">
                            <th className="th text-left">Client</th>
                            <th className="th text-left">Industry</th>
                            <th className="th text-left">Status</th>
                            <th className="th text-right">Articles</th>
                            <th className="th text-right">Signals</th>
                            <th className="th text-left">Created</th>
                            <th className="th text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <tr key={i} className="border-b border-border/30">
                                    {Array.from({ length: 7 }).map((_, j) => (
                                        <td key={j} className="td"><div className="skeleton h-4 rounded" /></td>
                                    ))}
                                </tr>
                            ))
                        ) : clients.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="td text-center py-10 text-text-muted">
                                    <Users size={24} className="mx-auto mb-2 opacity-30" />
                                    No clients found
                                </td>
                            </tr>
                        ) : (
                            clients.map(c => (
                                <tr key={c.id} className="table-row">
                                    <td className="td font-medium">{c.name}</td>
                                    <td className="td text-text-secondary text-xs">{c.industry ?? "—"}</td>
                                    <td className="td">
                                        <span className={cn("badge", c.is_active ? "badge-emerald" : "badge-muted")}>
                                            {c.is_active ? "Active" : "Inactive"}
                                        </span>
                                    </td>
                                    <td className="td text-right font-mono text-sm">{formatNumber(c.article_count)}</td>
                                    <td className="td text-right font-mono text-sm">{formatNumber(c.signal_count)}</td>
                                    <td className="td text-text-muted text-xs">{formatRelative(c.created_at)}</td>
                                    <td className="td text-center">
                                        <button
                                            onClick={() => triggerScrape(c.id)}
                                            title="Trigger scrape for this client"
                                            className="btn btn-ghost text-xs gap-1 mx-auto"
                                        >
                                            <Play size={11} />
                                            Scrape
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
