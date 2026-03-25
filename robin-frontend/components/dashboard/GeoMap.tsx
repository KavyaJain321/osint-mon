"use client";

import { useEffect, useState, Fragment } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLngExpression, PointExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

interface GeoNode {
    label: string; lat: number; lng: number; events: number;
    avgImportance: number; sentiments: { positive: number; negative: number; neutral: number };
    articles: { id: string; title: string; importance: number; sentiment: string }[];
}

/* Fixed bounds for Odisha */
function FitBounds() {
    const map = useMap();
    useEffect(() => {
        const odishaBounds: [LatLngExpression, LatLngExpression] = [[17.5, 81.5], [22.5, 87.5]];
        map.fitBounds(odishaBounds as any, { padding: [20, 20], maxZoom: 8 });
    }, [map]);
    return null;
}

function getColor(importance: number) {
    if (importance >= 7) return "#ef4444"; // Red (Critical)
    if (importance >= 5) return "#f97316"; // Orange (Elevated)
    if (importance > 0) return "#14b8a6";  // Teal (Normal)
    return "#475569"; // Grey (Empty)
}

function getRadius(events: number) {
    if (events === 0) return 6; // Empty state
    return Math.min(30, Math.max(10, events * 2.5));
}

export default function GeoMap({ nodes }: { nodes: GeoNode[] }) {
    const [activeCluster, setActiveCluster] = useState<string | null>(null);

    // Click outside to deselect cluster
    useEffect(() => {
        function rootClick(e: MouseEvent) {
            const target = e.target as HTMLElement;
            if (!target.closest('.leaflet-marker-pane') && !target.closest('.leaflet-popup-pane') && !target.closest('.leaflet-tooltip-pane')) {
                setActiveCluster(null);
            }
        }
        document.body.addEventListener('click', rootClick);
        return () => document.body.removeEventListener('click', rootClick);
    }, []);

    const center: LatLngExpression = [20.29, 84.80]; // Central Odisha

    // ── Inject Default Baseline Odisha Districts ──
    const DEFAULT_DISTRICTS = [
        { label: 'Bhubaneswar', lat: 20.30, lng: 85.83 },
        { label: 'Cuttack', lat: 20.46, lng: 85.88 },
        { label: 'Puri', lat: 19.81, lng: 85.83 },
        { label: 'Sambalpur', lat: 21.47, lng: 83.97 },
        { label: 'Rourkela', lat: 22.26, lng: 84.86 },
        { label: 'Berhampur', lat: 19.32, lng: 84.79 },
        { label: 'Balasore', lat: 21.49, lng: 86.93 },
    ];

    const mergedNodes = [...nodes];
    for (const def of DEFAULT_DISTRICTS) {
        if (!mergedNodes.some(n => n.label.toLowerCase() === def.label.toLowerCase())) {
            mergedNodes.push({
                ...def,
                events: 0,
                avgImportance: 0,
                sentiments: { positive: 0, negative: 0, neutral: 0 },
                articles: []
            });
        }
    }

    // ── 1. Group densely packed nodes into Clusters ──
    const CLUSTER_THRESHOLD = 0.5; // ~50km
    const rawClusters: { isCluster: boolean; id: string; label: string; lat: number; lng: number; events: number; avgImportance: number; nodes: GeoNode[] }[] = [];

    for (const node of mergedNodes) {
        let added = false;
        // Don't cluster empty baseline nodes
        for (const cluster of rawClusters) {
            const dist = Math.sqrt(Math.pow(cluster.lat - node.lat, 2) + Math.pow(cluster.lng - node.lng, 2));
            if (dist < CLUSTER_THRESHOLD && cluster.events > 0 && node.events > 0) {
                cluster.nodes.push(node);
                cluster.lat = cluster.nodes.reduce((s, n) => s + n.lat, 0) / cluster.nodes.length;
                cluster.lng = cluster.nodes.reduce((s, n) => s + n.lng, 0) / cluster.nodes.length;
                cluster.events += node.events;
                cluster.avgImportance = Math.max(cluster.avgImportance, node.avgImportance);
                added = true;
                break;
            }
        }
        if (!added) {
            rawClusters.push({
                isCluster: false,
                id: `node-${node.label}`,
                label: node.label,
                lat: node.lat,
                lng: node.lng,
                events: node.events,
                avgImportance: node.avgImportance,
                nodes: [node]
            });
        }
    }

    // Convert clusters with >3 nodes to real visual clusters
    const mapItems = rawClusters.flatMap((c, i) => {
        if (c.nodes.length > 3) {
            const clusterId = `cluster-${i}`;
            if (activeCluster === clusterId) {
                return c.nodes.map((n, idx) => {
                    const angle = (idx / c.nodes.length) * Math.PI * 2;
                    const r = 0.6; // radius of explosion in degrees
                    return {
                        id: `spider-${n.label}`,
                        isCluster: false,
                        label: n.label,
                        lat: c.lat + Math.cos(angle) * r,
                        lng: c.lng + Math.sin(angle) * r,
                        events: n.events,
                        avgImportance: n.avgImportance,
                        nodes: [n]
                    };
                });
            }
            return [{
                ...c,
                id: clusterId,
                isCluster: true,
                label: `${c.nodes.length} Locations Grouped`,
            }];
        } else {
            return c.nodes.map(n => ({
                id: `node-${n.label}`,
                isCluster: false,
                label: n.label,
                lat: n.lat,
                lng: n.lng,
                events: n.events,
                avgImportance: n.avgImportance,
                nodes: [n]
            }));
        }
    });

    return (
        <div className="relative w-full h-full group">
            <style>{`
                /* Subtle Scrim Backdrop via huge box-shadow on the active tooltip */
                .leaflet-tooltip-pane { z-index: 650; }
                .focus-scrim {
                    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.65), 0 8px 32px rgba(0,0,0,0.8) !important;
                    position: relative;
                    z-index: 9999 !important;
                }
                .leaflet-tooltip { backgroundColor: transparent; border: none; box-shadow: none; white-space: normal; }
                /* Permanent label styling via DivIcon */
                .geo-label-always {
                    background: transparent !important; border: none !important; box-shadow: none !important; 
                    color: white !important; font-size: 11px !important; font-weight: 600 !important; font-family: monospace !important;
                    text-shadow: 0 1px 3px black, 0 1px 6px black, 0 0 10px black !important; 
                    text-align: center;
                    pointer-events: none !important;
                }
            `}</style>
            
            <MapContainer
                center={center}
                zoom={6}
                className="w-full h-full"
                style={{ background: "#070910" }}
                zoomControl={true}
                attributionControl={false}
            >
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png" />
                <FitBounds />

                {/* Map Legend */}
                <div className="leaflet-bottom leaflet-left pointer-events-none" style={{ zIndex: 1000, position: 'absolute' }}>
                    <div className="bg-slate-900/80 border border-slate-700/50 backdrop-blur-sm p-3 m-4 rounded shadow-xl text-slate-300 pointer-events-auto">
                        <div className="text-[10px] font-mono text-slate-500 mb-2 uppercase tracking-wide">Alert Level Key</div>
                        <div className="flex flex-col gap-1.5 text-xs">
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> Critical (≥7.0)
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span> Elevated (5.0 - 6.9)
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span> Normal (&lt;5.0)
                            </div>
                            <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-700/50 text-slate-500">
                                <span className="w-2 h-2 rounded-full border border-slate-500 bg-slate-600"></span> No data yet
                            </div>
                        </div>
                    </div>
                </div>

                {/* Render Processed Items */}
                {mapItems.map(item => {
                    const color = getColor(item.avgImportance);
                    const radius = item.isCluster ? Math.min(40, getRadius(item.events) + 10) : getRadius(item.events);
                    const isSpiderfiedNode = item.id.startsWith('spider-');
                    const isEmpty = item.events === 0;
                    
                    return (
                        <Fragment key={item.id}>
                            <CircleMarker
                                center={[item.lat, item.lng]}
                                radius={radius}
                                eventHandlers={{
                                    click: () => {
                                        if (item.isCluster) {
                                            setActiveCluster(prev => prev === item.id ? null : item.id);
                                        }
                                    },
                                }}
                                pathOptions={{
                                    color: isEmpty ? '#475569' : color,
                                    fillColor: color,
                                    fillOpacity: item.isCluster ? 0.35 : (isEmpty ? 0.1 : 0.25),
                                    weight: item.isCluster ? 2 : (isEmpty ? 1 : 1.5),
                                    opacity: isEmpty ? 0.3 : 0.7,
                                    dashArray: isEmpty ? "2 2" : undefined
                                }}
                            >
                                {/* Spiderfy dashed connection lines */}
                                {!item.isCluster && isSpiderfiedNode && (
                                    <Polyline 
                                        positions={[[item.lat, item.lng], [item.lat - Math.cos(Math.PI/2)*0.6, item.lng]]} 
                                        pathOptions={{color: '#ffffff30', weight: 1, dashArray: "2 2"}} 
                                    />
                                )}

                                {/* Data Hover Card (Interactive & Scrimmed natively on hover) */}
                                <Tooltip
                                    direction="auto"
                                    interactive={true}
                                    className={`geo-tooltip bg-transparent border-0 shadow-none !p-0`}
                                >
                                    <div 
                                        className={`focus-scrim transition-all duration-300 origin-center cursor-default`}
                                        style={{ 
                                            background: item.isCluster ? `${color}dd` : "#1e293b", 
                                            border: `1px solid ${item.isCluster ? color : '#334155'}`, 
                                            borderRadius: "4px", 
                                            padding: "10px 14px", 
                                            color: "#e2e8f0", 
                                            minWidth: "180px",
                                            maxWidth: "280px"
                                        }}
                                    >
                                        <div style={{ fontWeight: 700, color: item.isCluster ? '#ffffff' : color, fontSize: "14px", marginBottom: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <span>{item.label}</span>
                                            {item.isCluster && <span className="text-[10px] opacity-80 cursor-pointer ml-4">EXPAND ⤢</span>}
                                        </div>
                                        
                                        <div style={{ color: item.isCluster ? "#ffffffdd" : "#cbd5e1", fontSize: "11px", paddingBottom: "8px", borderBottom: `1px solid ${item.isCluster ? '#ffffff30' : '#334155'}` }}>
                                            {isEmpty ? (
                                                <span className="italic text-slate-400 font-sans">No data yet</span>
                                            ) : (
                                                <span className="font-mono">
                                                    {item.events} events 
                                                    {item.avgImportance > 0 && <span> &middot; </span>}
                                                    {item.avgImportance > 0 && <span style={{ color: item.avgImportance >= 7 ? '#ef4444' : item.avgImportance >= 5 ? '#f97316' : '#14b8a6', fontWeight: 600 }}>Alert Level {item.avgImportance.toFixed(1)}</span>}
                                                </span>
                                            )}
                                        </div>
                                        
                                        {!item.isCluster && item.nodes[0] && item.nodes[0].articles.length > 0 && (
                                            <div className="mt-2 flex flex-col gap-1.5">
                                                {item.nodes[0].articles.slice(0, 3).map(a => (
                                                    <div key={a.id} className="text-[11px] leading-snug line-clamp-2" style={{ color: "#94a3b8" }}>
                                                        <span className="text-slate-600 mr-1">■</span> {a.title_en || a.title}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </Tooltip>
                            </CircleMarker>

                            {/* Always-visible text label for major nodes (Rendered completely detached from Marker) */}
                            {(!isEmpty || radius >= 10) && (
                                <Marker 
                                    position={[item.lat, item.lng]} 
                                    interactive={false} 
                                    icon={L.divIcon({
                                        className: 'geo-label-always',
                                        html: item.label,
                                        iconSize: [120, 20],
                                        iconAnchor: [60, -(radius + 8)] // offset below the circle
                                    })}
                                />
                            )}
                        </Fragment>
                    );
                })}

                {/* Outer pulse rings for critical nodes */}
                {mapItems.filter(n => n.avgImportance >= 7 && !n.isCluster).map(item => {
                    const pulseCenter: LatLngExpression = [item.lat, item.lng];
                    return (
                        <CircleMarker
                            key={`pulse-${item.id}`}
                            center={pulseCenter}
                            radius={getRadius(item.events) + 6}
                            pathOptions={{
                                color: getColor(item.avgImportance),
                                fillColor: "transparent",
                                fillOpacity: 0,
                                weight: 1,
                                opacity: 0.4,
                                dashArray: "2 3",
                            }}
                        />
                    );
                })}
            </MapContainer>
        </div>
    );
}
