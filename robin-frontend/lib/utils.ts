import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatDate(dateStr?: string): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
    });
}

export function formatTime(dateStr?: string): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit",
    });
}

export function formatRelative(dateStr?: string): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(dateStr);
}

export function formatNumber(n?: number): string {
    if (n === undefined || n === null) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
}

export function formatPct(n?: number, decimals = 1): string {
    if (n === undefined || n === null) return "—";
    return `${n.toFixed(decimals)}%`;
}

export function formatRisk(score?: number): string {
    if (score === undefined) return "—";
    if (score >= 80) return "Critical";
    if (score >= 60) return "Elevated";
    if (score >= 40) return "Moderate";
    if (score >= 20) return "Low";
    return "Minimal";
}

export function riskColor(score?: number): string {
    if (!score) return "text-text-muted";
    if (score >= 80) return "text-rose";
    if (score >= 60) return "text-amber";
    if (score >= 40) return "text-amber/70";
    return "text-emerald";
}

export function sentimentColor(s?: string): string {
    if (s === "positive") return "text-emerald";
    if (s === "negative") return "text-rose";
    return "text-text-secondary";
}

export function severityBadge(severity?: string): string {
    if (severity === "critical") return "badge-rose";
    if (severity === "high") return "badge-amber";
    if (severity === "medium") return "badge-sky";
    return "badge-muted";
}

export function truncate(str?: string, n = 80): string {
    if (!str) return "";
    return str.length > n ? str.slice(0, n) + "…" : str;
}

export function cleanSnippet(str?: string, length = 100): string {
    if (!str) return "";
    let cleanText = str;
    
    // 1. Try proper JSON parsing
    try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) {
            cleanText = parsed.join(" ");
        } else if (typeof parsed === "string") {
            cleanText = parsed;
        }
    } catch (e) {
        // 2. Fallback: manual regex stripping for malformed AI JSON arrays
        // Matches `["Text", "More text"]` and strips brackets and joining quotes
        if (cleanText.startsWith('[') && cleanText.endsWith(']')) {
            cleanText = cleanText
                .replace(/^\[\s*"?|"?\s*\]$/g, '') // remove outer brackets and edge quotes
                .replace(/"\s*,\s*"/g, ' ')        // replace `","` with space
                .replace(/\\"/g, '"');             // unescape internal quotes
        }
    }
    
    // Fallback trim any outer quotes that might remain
    cleanText = cleanText.replace(/^"|"$/g, '').trim();

    // 3. Truncate
    if (cleanText.length > length) {
        return cleanText.slice(0, length).trimEnd() + "...";
    }
    return cleanText;
}
