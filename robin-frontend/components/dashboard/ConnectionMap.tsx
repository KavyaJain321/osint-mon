"use client";

import { useMemo, useState } from "react";
import { GitBranch, ZoomIn, ZoomOut } from "lucide-react";
import { useIntelligenceData } from "@/lib/hooks/useIntelligence";

interface Entity {
    name: string;
    type: string;
    mentionCount?: number;
    mentions?: number;
    relevance_score?: number;
    connected_stories?: Array<{ theme: string; article_count: number; sentiment: string }>;
    relationships?: Array<{ entity_name: string; strength: number }>;
}

interface Signal {
    id: string;
    title: string;
    severity: string;
    related_entities?: string[];
}

const TYPE_COLOR: Record<string, string> = {
    person: "#38bdf8",     // sky
    org: "#a78bfa",        // violet
    organization: "#a78bfa",
    location: "#34d399",   // emerald
    government: "#818cf8", // indigo
    regulation: "#fbbf24", // amber
    media: "#f472b6",      // pink
};

const SEV_COLOR: Record<string, string> = {
    critical: "#f43f5e",
    high: "#f59e0b",
    medium: "#38bdf8",
    low: "#6b7280",
    warning: "#f59e0b",
    watch: "#38bdf8",
};

export default function ConnectionMap() {
    const { data: intel } = useIntelligenceData();
    const intelData = intel as {
        entity_profiles?: Entity[];
        signals?: Signal[];
    } | undefined;

    const [zoom, setZoom] = useState(1);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);

    const entities = (intelData?.entity_profiles ?? []).slice(0, 12);
    const signals = (intelData?.signals ?? []).slice(0, 6);

    // Build graph layout
    const { nodes, edges } = useMemo(() => {
        const nodeList: Array<{
            id: string;
            label: string;
            type: "entity" | "signal" | "story";
            subtype: string;
            x: number;
            y: number;
            size: number;
            color: string;
        }> = [];

        const edgeList: Array<{
            from: string;
            to: string;
            label: string;
        }> = [];

        const W = 800;
        const H = 500;
        const cx = W / 2;
        const cy = H / 2;

        // Place entities in an ellipse
        entities.forEach((ent, i) => {
            const angle = (i / Math.max(entities.length, 1)) * Math.PI * 2 - Math.PI / 2;
            const rx = 280;
            const ry = 180;
            const mentions = ent.mentionCount ?? ent.mentions ?? 1;
            nodeList.push({
                id: `ent-${ent.name}`,
                label: ent.name,
                type: "entity",
                subtype: ent.type,
                x: cx + Math.cos(angle) * rx,
                y: cy + Math.sin(angle) * ry,
                size: Math.max(14, Math.min(28, 10 + Math.sqrt(mentions) * 3)),
                color: TYPE_COLOR[ent.type?.toLowerCase()] || "#6b7280",
            });
        });

        // Place signals in inner ring
        signals.forEach((sig, i) => {
            const angle = (i / Math.max(signals.length, 1)) * Math.PI * 2;
            const r = 100;
            nodeList.push({
                id: `sig-${sig.id}`,
                label: sig.title.length > 25 ? sig.title.slice(0, 22) + "…" : sig.title,
                type: "signal",
                subtype: sig.severity,
                x: cx + Math.cos(angle) * r,
                y: cy + Math.sin(angle) * r,
                size: 12,
                color: SEV_COLOR[sig.severity] || "#6b7280",
            });

            // Connect signals to related entities
            for (const eName of sig.related_entities || []) {
                const entNode = nodeList.find(n => n.id === `ent-${eName}`);
                if (entNode) {
                    edgeList.push({ from: `sig-${sig.id}`, to: entNode.id, label: "triggers" });
                }
            }
        });

        // Entity-entity edges (top relationships)
        for (const ent of entities.slice(0, 8)) {
            for (const rel of (ent.relationships ?? []).slice(0, 2)) {
                const target = nodeList.find(n => n.id === `ent-${rel.entity_name}`);
                if (target) {
                    edgeList.push({ from: `ent-${ent.name}`, to: target.id, label: "appears with" });
                }
            }
        }

        return { nodes: nodeList, edges: edgeList };
    }, [entities, signals]);

    if (nodes.length === 0) {
        return (
            <div className="card p-8 text-center">
                <GitBranch size={32} className="text-text-muted mx-auto mb-2 opacity-30" />
                <p className="text-xs text-text-muted">No connections to visualize. Run the analysis pipeline first.</p>
            </div>
        );
    }

    return (
        <div className="card overflow-hidden">
            {/* Controls */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                    <GitBranch size={14} className="text-text-secondary" />
                    <h3 className="section-title">Entity-Signal Connection Map</h3>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="btn btn-ghost p-1"><ZoomOut size={14} /></button>
                    <span className="text-2xs text-text-muted font-mono">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.min(1.5, z + 0.1))} className="btn btn-ghost p-1"><ZoomIn size={14} /></button>
                </div>
            </div>

            {/* SVG Canvas */}
            <div className="relative overflow-hidden" style={{ height: 500 }}>
                <svg
                    width="100%"
                    height="100%"
                    viewBox={`0 0 800 500`}
                    style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
                >
                    {/* Edges */}
                    {edges.map((edge, i) => {
                        const fromNode = nodes.find(n => n.id === edge.from);
                        const toNode = nodes.find(n => n.id === edge.to);
                        if (!fromNode || !toNode) return null;
                        const isHighlight = hoveredNode === fromNode.id || hoveredNode === toNode.id;
                        return (
                            <g key={i}>
                                <line
                                    x1={fromNode.x}
                                    y1={fromNode.y}
                                    x2={toNode.x}
                                    y2={toNode.y}
                                    stroke={isHighlight ? "#a78bfa" : "rgba(255,255,255,0.07)"}
                                    strokeWidth={isHighlight ? 1.5 : 0.8}
                                    strokeDasharray={edge.label === "triggers" ? "none" : "4 3"}
                                />
                                {isHighlight && (
                                    <text
                                        x={(fromNode.x + toNode.x) / 2}
                                        y={(fromNode.y + toNode.y) / 2 - 5}
                                        fill="rgba(255,255,255,0.5)"
                                        fontSize={8}
                                        textAnchor="middle"
                                    >
                                        {edge.label}
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* Nodes */}
                    {nodes.map(node => {
                        const isHovered = hoveredNode === node.id;
                        return (
                            <g
                                key={node.id}
                                onMouseEnter={() => setHoveredNode(node.id)}
                                onMouseLeave={() => setHoveredNode(null)}
                                style={{ cursor: "pointer" }}
                            >
                                {node.type === "entity" ? (
                                    <circle
                                        cx={node.x}
                                        cy={node.y}
                                        r={isHovered ? node.size + 3 : node.size}
                                        fill={node.color}
                                        fillOpacity={isHovered ? 0.5 : 0.25}
                                        stroke={node.color}
                                        strokeWidth={isHovered ? 2 : 1}
                                    />
                                ) : (
                                    <rect
                                        x={node.x - 8}
                                        y={node.y - 8}
                                        width={16}
                                        height={16}
                                        rx={3}
                                        fill={node.color}
                                        fillOpacity={isHovered ? 0.6 : 0.3}
                                        stroke={node.color}
                                        strokeWidth={isHovered ? 2 : 1}
                                        transform={`rotate(45 ${node.x} ${node.y})`}
                                    />
                                )}
                                <text
                                    x={node.x}
                                    y={node.y + node.size + 12}
                                    fill={isHovered ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)"}
                                    fontSize={isHovered ? 10 : 9}
                                    textAnchor="middle"
                                    fontWeight={isHovered ? "600" : "400"}
                                >
                                    {node.label}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-2xs text-text-muted">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-sky/40 border border-sky" /> Entity</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose/40 border border-rose rotate-45" /> Signal</span>
                <span className="flex items-center gap-1"><span className="w-6 h-px bg-white/20" /> appears with</span>
                <span className="flex items-center gap-1"><span className="w-6 h-px bg-violet" /> triggers</span>
            </div>
        </div>
    );
}
