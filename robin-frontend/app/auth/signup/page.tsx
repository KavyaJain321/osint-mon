"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SignupPage() {
    const router = useRouter();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPwd, setShowPwd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [done, setDone] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/auth/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ full_name: name, email, password }),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Sign up failed");
            } else {
                setDone(true);
                setTimeout(() => router.push("/auth/login"), 2500);
            }
        } catch {
            setError("Could not connect to server. Is the backend running?");
        }
        setLoading(false);
    };

    if (done) {
        return (
            <div className="w-full max-w-sm mx-auto">
                <div
                    className="rounded-xl border border-emerald/30 p-8 text-center"
                    style={{ background: "rgba(13,21,37,0.95)", backdropFilter: "blur(20px)" }}
                >
                    <CheckCircle size={32} className="text-emerald mx-auto mb-4" />
                    <h2 className="text-lg font-semibold text-text-primary mb-2">Account Created</h2>
                    <p className="text-sm text-text-muted">Redirecting to sign in…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-sm mx-auto relative">
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

                <h1 className="text-xl font-semibold text-text-primary mb-1">Request Access</h1>
                <p className="text-sm text-text-muted mb-6">Create an analyst account</p>

                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-rose-subtle border border-rose/20 mb-5">
                        <AlertTriangle size={14} className="text-rose flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-rose">{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">Full Name</label>
                        <input
                            type="text"
                            required
                            className="input"
                            placeholder="Jane Doe"
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">Work Email</label>
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
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">Password</label>
                        <div className="relative">
                            <input
                                type={showPwd ? "text" : "password"}
                                required
                                minLength={8}
                                autoComplete="new-password"
                                className="input pr-10"
                                placeholder="Min. 8 characters"
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
                        {loading ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
                        {loading ? "Creating account…" : "Create Account"}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <span className="text-xs text-text-muted">Already have access? </span>
                    <Link href="/auth/login" className="text-xs text-accent hover:text-accent-bright transition-colors">
                        Sign in
                    </Link>
                </div>
            </div>

            <p className="text-center text-2xs text-text-muted mt-4">
                ROBIN Media Monitor · Restricted Access
            </p>
        </div>
    );
}
