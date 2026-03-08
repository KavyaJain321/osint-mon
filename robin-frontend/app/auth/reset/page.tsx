"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, CheckCircle2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ResetPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/auth/reset-password`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email }),
                }
            );

            if (res.ok) {
                setSent(true);
            } else {
                const data = await res.json();
                setError(data.error || "Failed to send reset email. Please try again.");
            }
        } catch {
            // Even on network error, show success to prevent email enumeration
            setSent(true);
        }

        setLoading(false);
    };

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
                        <div className="text-2xs text-text-muted uppercase tracking-widest">Intelligence Platform</div>
                    </div>
                </div>

                {sent ? (
                    /* Success state */
                    <div className="text-center">
                        <div className="flex justify-center mb-4">
                            <CheckCircle2 size={40} className="text-emerald-400" />
                        </div>
                        <h1 className="text-xl font-semibold text-text-primary mb-2">Check your email</h1>
                        <p className="text-sm text-text-muted mb-6">
                            If an account exists for <span className="text-text-secondary">{email}</span>, you'll
                            receive a password reset link shortly.
                        </p>
                        <Link
                            href="/auth/login"
                            className="flex items-center justify-center gap-2 text-sm text-accent hover:text-accent-bright transition-colors"
                        >
                            <ArrowLeft size={14} />
                            Back to sign in
                        </Link>
                    </div>
                ) : (
                    /* Form state */
                    <>
                        <h1 className="text-xl font-semibold text-text-primary mb-1">Reset password</h1>
                        <p className="text-sm text-text-muted mb-6">
                            Enter your email and we'll send you a reset link.
                        </p>

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
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className={cn("btn-primary w-full justify-center mt-2 h-10 text-sm", loading && "opacity-70")}
                            >
                                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                                {loading ? "Sending…" : "Send reset link"}
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <Link
                                href="/auth/login"
                                className="flex items-center justify-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
                            >
                                <ArrowLeft size={12} />
                                Back to sign in
                            </Link>
                        </div>
                    </>
                )}
            </div>

            <p className="text-center text-2xs text-text-muted mt-4">
                ROBIN Intelligence Platform · Restricted Access
            </p>
        </div>
    );
}
