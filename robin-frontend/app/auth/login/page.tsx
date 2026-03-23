"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPwd, setShowPwd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Invalid credentials");
            } else {
                localStorage.setItem("robin_token", data.token ?? data.access_token ?? "");
                if (data.refresh_token) localStorage.setItem("robin_refresh_token", data.refresh_token);
                router.push("/dashboard");
            }
        } catch {
            setError("Could not connect to server. Is the backend running?");
        }
        setLoading(false);
    };

    return (
        <div className="w-full max-w-sm mx-auto relative">
            {/* Card */}
            <div
                className="rounded-xl border border-border p-8"
                style={{ background: "rgba(13,21,37,0.95)", backdropFilter: "blur(20px)" }}
            >
                {/* Logo */}
                <div className="flex items-center gap-2 mb-8">
                    <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                        <span className="text-white font-mono font-bold text-base">R</span>
                    </div>
                    <div>
                        <div className="text-base font-semibold text-text-primary tracking-wide">ROBIN</div>
                        <div className="text-2xs text-text-muted uppercase tracking-widest">Media Monitor</div>
                    </div>
                </div>

                <h1 className="text-xl font-semibold text-text-primary mb-1">Sign in</h1>
                <p className="text-sm text-text-muted mb-6">Access your media monitoring dashboard</p>

                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-rose-subtle border border-rose/20 mb-5">
                        <AlertTriangle size={14} className="text-rose flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-rose">{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
                        <input
                            type="email"
                            required
                            autoComplete="email"
                            className="input"
                            placeholder="analyst@company.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-text-secondary">Password</label>
                            <Link href="/auth/reset" className="text-xs text-accent hover:text-accent-bright transition-colors">
                                Forgot?
                            </Link>
                        </div>
                        <div className="relative">
                            <input
                                type={showPwd ? "text" : "password"}
                                required
                                autoComplete="current-password"
                                className="input pr-10"
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPwd(!showPwd)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                            >
                                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={cn("btn-primary w-full justify-center mt-2 h-10 text-sm", loading && "opacity-70")}
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                        {loading ? "Signing in…" : "Sign in"}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <span className="text-xs text-text-muted">Don't have access? </span>
                    <Link href="/auth/signup" className="text-xs text-accent hover:text-accent-bright transition-colors">
                        Request access
                    </Link>
                </div>
            </div>

            {/* Bottom caption */}
            <p className="text-center text-2xs text-text-muted mt-4">
                ROBIN Media Monitor · Restricted Access
            </p>
        </div>
    );
}
