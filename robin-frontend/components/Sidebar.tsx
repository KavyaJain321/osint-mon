"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Zap,
    Radio,
    Users,
    FileText,
    Database,
    Activity,
    MessageSquare,
    Settings,
    Shield,
    BarChart3,
    Network,
    Radar,
    BookOpen,
    Bell,
    Crosshair,
    Newspaper,
    ChevronDown,
    ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

/* ── Section definitions ────────────────────────────────────── */

interface NavItem {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
}

interface NavSection {
    id: string;
    label: string;
    items: NavItem[];
    collapsible?: boolean;
    defaultOpen?: boolean;
}

const sections: NavSection[] = [
    {
        id: "command",
        label: "Command Center",
        items: [
            { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
            { href: "/dashboard/daily-intel", label: "Daily Intel", icon: ClipboardList },
        ],
    },
    {
        id: "investigate",
        label: "Investigate",
        collapsible: true,
        defaultOpen: true,
        items: [
            { href: "/dashboard/intelligence", label: "Intelligence", icon: Zap },
            { href: "/dashboard/entities", label: "Entities", icon: Users },
        ],
    },
    {
        id: "feed",
        label: "Content Feed",
        items: [
            { href: "/dashboard/activity", label: "Activity Feed", icon: Newspaper },
        ],
    },
    {
        id: "alerts",
        label: "Alerts",
        items: [
            { href: "/dashboard/signals", label: "Signals & Alerts", icon: Bell },
        ],
    },
    {
        id: "reports",
        label: "Reports",
        items: [
            { href: "/dashboard/reports", label: "Reports & Analytics", icon: BarChart3 },
        ],
    },
    {
        id: "sources",
        label: "Sources",
        items: [
            { href: "/dashboard/sources", label: "Source Management", icon: Database },
        ],
    },
    {
        id: "setup",
        label: "Setup",
        collapsible: true,
        defaultOpen: true,
        items: [
            { href: "/dashboard/briefs", label: "Intelligence Brief", icon: FileText },
            { href: "/dashboard/chat", label: "Ask ROBIN", icon: MessageSquare },
            { href: "/dashboard/admin", label: "Admin Panel", icon: Shield },
            { href: "/dashboard/admin/briefs", label: "Brief Review", icon: Settings },
            { href: "/dashboard/settings/notifications", label: "Notifications", icon: Bell },
        ],
    },
];

export default function Sidebar() {
    const router = useRouter();

    const handleLogout = () => {
        // Clear authentication token
        localStorage.removeItem('robin_token');
        // Optionally clear any other stored user data
        // Redirect to login page
        router.push('/auth/login');
    };
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

    const isActive = (href: string) =>
        href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(href);

    const isOpen = (section: NavSection) => {
        if (!section.collapsible) return true;
        if (collapsed[section.id] !== undefined) return !collapsed[section.id];
        return section.defaultOpen ?? true;
    };

    const toggleSection = (id: string) =>
        setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

    // Check if any item in section is active
    const sectionHasActive = (section: NavSection) =>
        section.items.some(item => isActive(item.href));

    return (
        <aside className="fixed inset-y-0 left-0 z-30 w-[220px] bg-surface border-r border-border flex flex-col">
            {/* Logo */}
            <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
                <div className="w-7 h-7 rounded bg-accent flex items-center justify-center">
                    <span className="text-white font-mono font-bold text-sm">R</span>
                </div>
                <div>
                    <div className="text-sm font-semibold text-text-primary tracking-wide">ROBIN</div>
                    <div className="text-2xs text-text-muted uppercase tracking-widest">Intelligence</div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-2 px-2 no-scrollbar">
                {sections.map((section, idx) => {
                    const open = isOpen(section);
                    const hasActive = sectionHasActive(section);

                    return (
                        <div key={section.id} className={cn(idx > 0 && "mt-1")}>
                            {/* Section header */}
                            {section.collapsible ? (
                                <button
                                    onClick={() => toggleSection(section.id)}
                                    className={cn(
                                        "w-full flex items-center justify-between px-3 py-1.5 text-2xs uppercase tracking-wider rounded transition-colors",
                                        hasActive ? "text-accent" : "text-text-muted hover:text-text-secondary"
                                    )}
                                >
                                    <span>{section.label}</span>
                                    <ChevronDown
                                        size={10}
                                        className={cn(
                                            "transition-transform duration-200",
                                            !open && "-rotate-90"
                                        )}
                                    />
                                </button>
                            ) : (
                                <div className={cn(
                                    "px-3 py-1.5 text-2xs uppercase tracking-wider",
                                    hasActive ? "text-accent" : "text-text-muted"
                                )}>
                                    {section.label}
                                </div>
                            )}

                            {/* Section items */}
                            {open && (
                                <div className="mt-0.5">
                                    {section.items.map((item) => {
                                        const Icon = item.icon;
                                        const active = isActive(item.href);
                                        return (
                                            <Link key={item.href} href={item.href}>
                                                <div className={cn(
                                                    active ? "nav-item-active" : "nav-item",
                                                    "mb-0.5"
                                                )}>
                                                    <Icon size={15} className={active ? "text-accent" : "text-text-muted"} />
                                                    {item.label}
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-border flex flex-col space-y-2">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald animate-pulse-slow" />
                    <span className="text-xs text-text-muted">System Online</span>
                </div>
                <button
                    onClick={handleLogout}
                    className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-surface-secondary rounded transition-colors"
                >
                    Logout
                </button>
            </div>
        </aside>
    );
}
