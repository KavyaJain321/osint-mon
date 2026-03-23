"use client";

import { useMemo } from "react";
import { Target, TrendingUp, TrendingDown, Minus, Check, AlertTriangle, ChevronRight } from "lucide-react";
import { useIntelligenceData } from "@/lib/hooks/useIntelligence";

interface Scenario {
    scenario_name?: string;
    scenario?: string;
    description?: string;
    likelihood?: number;
    probability?: string;
    triggers?: string[];
    impact?: string;
    recommended_actions?: string[];
}

interface ThreatData {
    scenarios?: Scenario[];
    overall_risk?: number;
    risk_level?: string;
}

const SCENARIO_STYLES: Record<string, { border: string; badge: string; icon: React.ReactNode }> = {
    downside: { border: "border-l-rose", badge: "badge-rose", icon: <TrendingDown size={14} /> },
    worst: { border: "border-l-rose", badge: "badge-rose", icon: <AlertTriangle size={14} /> },
    baseline: { border: "border-l-sky", badge: "badge-sky", icon: <Minus size={14} /> },
    upside: { border: "border-l-emerald", badge: "badge-emerald", icon: <TrendingUp size={14} /> },
    best: { border: "border-l-emerald", badge: "badge-emerald", icon: <TrendingUp size={14} /> },
};

function getScenarioType(name: string): string {
    const l = name.toLowerCase();
    if (l.includes("downside") || l.includes("worst") || l.includes("negative")) return "downside";
    if (l.includes("upside") || l.includes("best") || l.includes("positive")) return "upside";
    return "baseline";
}

export default function ScenarioPanel() {
    const { data: intel } = useIntelligenceData();
    const threat = (intel as { threat_assessment?: ThreatData } | undefined)?.threat_assessment;
    const scenarios = threat?.scenarios || [];

    if (scenarios.length === 0) {
        return (
            <div className="card p-6 text-center">
                <Target size={32} className="text-text-muted mx-auto mb-2 opacity-30" />
                <p className="text-xs text-text-muted">Scenarios will be generated after the analysis pipeline runs.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <Target size={16} className="text-text-secondary" />
                <h3 className="section-title">Scenario Analysis</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {scenarios.slice(0, 3).map((scenario, i) => {
                    const type = getScenarioType(scenario.scenario_name || scenario.scenario || `Scenario ${i + 1}`);
                    const style = SCENARIO_STYLES[type] || SCENARIO_STYLES.baseline;
                    const name = scenario.scenario_name || scenario.scenario || `Scenario ${i + 1}`;
                    const likelihood = scenario.likelihood || 0;
                    const prob = scenario.probability || `${likelihood}%`;

                    return (
                        <div key={i} className={`card border-l-2 ${style.border} p-4`}>
                            {/* Header */}
                            <div className="flex items-center gap-2 mb-2">
                                {style.icon}
                                <h4 className="text-sm font-semibold text-text-primary">{name}</h4>
                            </div>

                            {/* Likelihood bar */}
                            <div className="mb-3">
                                <div className="flex items-center justify-between text-2xs text-text-muted mb-1">
                                    <span>Likelihood</span>
                                    <span className="font-mono">{prob}</span>
                                </div>
                                <div className="h-1.5 bg-overlay rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-700 ${type === "downside" ? "bg-rose/70" : type === "upside" ? "bg-emerald/70" : "bg-sky/50"
                                            }`}
                                        style={{ width: `${likelihood}%` }}
                                    />
                                </div>
                            </div>

                            {/* Description */}
                            {scenario.description && (
                                <p className="text-xs text-text-secondary leading-relaxed mb-3 truncate-3">
                                    {scenario.description}
                                </p>
                            )}

                            {/* Triggers */}
                            {scenario.triggers && scenario.triggers.length > 0 && (
                                <div className="mb-2">
                                    <p className="text-2xs text-text-muted uppercase tracking-wider mb-1">Triggers</p>
                                    <div className="space-y-1">
                                        {scenario.triggers.slice(0, 3).map((trigger, j) => (
                                            <div key={j} className="flex items-start gap-1.5 text-2xs text-text-secondary">
                                                <ChevronRight size={10} className="text-text-muted mt-0.5 flex-shrink-0" />
                                                <span>{trigger}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Impact */}
                            {scenario.impact && (
                                <div className="mt-2 pt-2 border-t border-border">
                                    <p className="text-2xs text-text-muted">Impact: <span className="text-text-secondary">{scenario.impact}</span></p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
