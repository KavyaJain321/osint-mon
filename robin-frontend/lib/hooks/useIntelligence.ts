import { useQuery } from "@tanstack/react-query";
import { testApi, articlesApi, contentApi } from "@/lib/api";
import apiFetch from "@/lib/api";

/** Full intelligence picture: threat, signals, entities, sources, narrative */
export function useIntelligenceData() {
    return useQuery({
        queryKey: ["intelligence"],
        queryFn: () => testApi.intelligence(),
        staleTime: 5 * 60 * 1000,
    });
}

/** The Daily Intelligence Brief — fused, actionable view */
export function useIntelligenceBrief() {
    return useQuery({
        queryKey: ["intelligence-brief"],
        queryFn: () => apiFetch(`/api/test/intelligence-brief`),
        staleTime: 2 * 60 * 1000,
    });
}

/** Scraper status: running, article counts, source breakdown */
export function useScraperStatus() {
    return useQuery({
        queryKey: ["scraperStatus"],
        queryFn: () => testApi.scraperStatus(),
        staleTime: 2 * 60 * 1000,
    });
}

/** Article feed with analysis */
export function useArticles(limit = 50) {
    return useQuery({
        queryKey: ["articles", limit],
        queryFn: () => articlesApi.list(limit),
        staleTime: 3 * 60 * 1000,
    });
}

/** Unified content feed (articles + videos + PDFs + etc.) */
export function useContent(limit = 1500, type?: string) {
    return useQuery({
        queryKey: ["content", limit, type],
        queryFn: () => contentApi.list(limit, type),
        staleTime: 3 * 60 * 1000,
    });
}

/** Sources list */
export function useSources() {
    return useQuery({
        queryKey: ["sources"],
        queryFn: () => testApi.sources(),
        staleTime: 5 * 60 * 1000,
    });
}

/** Analytics (sentiment) */
export function useAnalytics() {
    return useQuery({
        queryKey: ["analytics"],
        queryFn: () => testApi.analytics(),
        staleTime: 5 * 60 * 1000,
    });
}

/** Active brief for overview banner */
export function useBriefs() {
    return useQuery({
        queryKey: ["briefs"],
        queryFn: async () => {
            const json = await apiFetch<{ data?: unknown[] }>(`/api/briefs`);
            return json.data || [];
        },
        staleTime: 5 * 60 * 1000,
    });
}
