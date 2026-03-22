"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, AlertTriangle, TrendingDown, Info, X, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Notification {
    id: string;
    type: "critical" | "high" | "medium" | "low";
    title: string;
    body: string;
    timestamp: string;
    read: boolean;
    signalId?: string;
}

const SEVERITY_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
    critical: { icon: <AlertTriangle size={14} />, color: "text-rose", bg: "bg-rose/10" },
    high: { icon: <TrendingDown size={14} />, color: "text-amber", bg: "bg-amber/10" },
    medium: { icon: <Info size={14} />, color: "text-sky", bg: "bg-sky/10" },
    low: { icon: <Info size={14} />, color: "text-text-muted", bg: "bg-overlay" },
};

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// Demo notifications for UI preview
function getSeedNotifications(): Notification[] {
    return [
        {
            id: "n1",
            type: "critical",
            title: "Negative Sentiment Surge",
            body: "Sentiment dropped 21% across 4 sources in the last 3 hours. 5 negative articles from major outlets detected.",
            timestamp: new Date(Date.now() - 45 * 60000).toISOString(),
            read: false,
        },
        {
            id: "n2",
            type: "high",
            title: "New Entity: Iran — Elevated Risk",
            body: "Iran appeared in 3 articles with high risk context. Connected to military operations narrative.",
            timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
            read: false,
        },
        {
            id: "n3",
            type: "medium",
            title: "Intelligence Pipeline Complete",
            body: "Batch intelligence run finished. 7 articles processed, 20 entities profiled, 6 signals generated.",
            timestamp: new Date(Date.now() - 5 * 3600000).toISOString(),
            read: true,
        },
        {
            id: "n4",
            type: "low",
            title: "Daily Digest Ready",
            body: "Your morning intelligence digest is ready. 3 new developments since last review.",
            timestamp: new Date(Date.now() - 10 * 3600000).toISOString(),
            read: true,
        },
    ];
}

const STORAGE_KEY = "robin_notifications";

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
    const bellRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = useState(false);

    // Client-only portal mount guard
    useEffect(() => { setMounted(true); }, []);

    // Load from localStorage or seed
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setNotifications(JSON.parse(stored));
            } else {
                const seed = getSeedNotifications();
                setNotifications(seed);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
            }
        } catch {
            setNotifications(getSeedNotifications());
        }
    }, []);

    // Position the portal panel relative to the bell button
    const updatePos = useCallback(() => {
        if (!bellRef.current) return;
        const rect = bellRef.current.getBoundingClientRect();
        setPanelPos({
            top: rect.bottom + 8,
            right: window.innerWidth - rect.right,
        });
    }, []);

    const handleToggle = () => {
        if (!open) updatePos();
        setOpen(o => !o);
    };

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                panelRef.current && !panelRef.current.contains(e.target as Node) &&
                bellRef.current && !bellRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        if (open) {
            document.addEventListener("mousedown", handler);
            window.addEventListener("scroll", () => setOpen(false), { once: true });
        }
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markRead = (id: string) => {
        const updated = notifications.map(n => n.id === id ? { ...n, read: true } : n);
        setNotifications(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    };

    const markAllRead = () => {
        const updated = notifications.map(n => ({ ...n, read: true }));
        setNotifications(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    };

    const dismiss = (id: string) => {
        const updated = notifications.filter(n => n.id !== id);
        setNotifications(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    };

    // Portal panel — rendered into document.body so it always sits above the map
    const panel = mounted && open && panelPos ? createPortal(
        <div
            ref={panelRef}
            style={{
                position: "fixed",
                top: panelPos.top,
                right: panelPos.right,
                zIndex: 9999,
                width: 384, // w-96
                maxHeight: 480,
            }}
            className="bg-surface border border-border rounded-lg shadow-elevated overflow-hidden animate-fade-in"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-text-primary">Notifications</h3>
                <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                        <button
                            onClick={markAllRead}
                            className="text-2xs text-accent hover:underline flex items-center gap-1"
                        >
                            <CheckCheck size={12} /> Mark all read
                        </button>
                    )}
                </div>
            </div>

            {/* Notification List */}
            <div className="overflow-y-auto no-scrollbar" style={{ maxHeight: 400 }}>
                {notifications.length === 0 ? (
                    <div className="p-8 text-center text-text-muted">
                        <Bell size={24} className="mx-auto mb-2 opacity-30" />
                        <p className="text-xs">No notifications</p>
                    </div>
                ) : (
                    notifications.map(n => {
                        const config = SEVERITY_CONFIG[n.type] || SEVERITY_CONFIG.low;
                        return (
                            <div
                                key={n.id}
                                className={cn(
                                    "px-4 py-3 border-b border-border/50 transition-colors group cursor-pointer",
                                    !n.read ? "bg-accent/[0.03]" : "hover:bg-overlay/50"
                                )}
                                onClick={() => markRead(n.id)}
                            >
                                <div className="flex items-start gap-3">
                                    {/* Severity icon */}
                                    <div className={cn("mt-0.5 p-1.5 rounded-md flex-shrink-0", config.bg, config.color)}>
                                        {config.icon}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className={cn("text-xs font-semibold", !n.read ? "text-text-primary" : "text-text-secondary")}>
                                                {n.title}
                                            </span>
                                            {!n.read && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                                            )}
                                        </div>
                                        <p className="text-2xs text-text-muted line-clamp-2 mb-1">
                                            {n.body}
                                        </p>
                                        <span className="text-2xs text-text-muted">
                                            {timeAgo(n.timestamp)}
                                        </span>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                        {!n.read && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                                                className="p-1 rounded hover:bg-overlay text-text-muted"
                                                title="Mark as read"
                                            >
                                                <Check size={12} />
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                                            className="p-1 rounded hover:bg-overlay text-text-muted"
                                            title="Dismiss"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border text-center">
                <button className="text-2xs text-accent hover:underline">
                    View All Notifications →
                </button>
            </div>
        </div>,
        document.body
    ) : null;

    return (
        <>
            {/* Bell Button */}
            <button
                ref={bellRef}
                onClick={handleToggle}
                className="relative p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-overlay transition-colors"
                aria-label="Notifications"
            >
                <Bell size={18} />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-rose text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none animate-pulse">
                        {unreadCount}
                    </span>
                )}
            </button>

            {panel}
        </>
    );
}
