"use client";

import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, X, Sparkles, Loader2, ChevronUp } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Message {
    role: "user" | "assistant";
    content: string;
}

const SUGGESTED_QUESTIONS = [
    "What are the top developments today?",
    "Which entities are getting negative coverage?",
    "Summarize the threat landscape",
    "What should I be watching for this week?",
];

export default function AskRobin() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const sendMessage = async (text?: string) => {
        const question = text || input.trim();
        if (!question || loading) return;

        setInput("");
        setMessages(prev => [...prev, { role: "user", content: question }]);
        setLoading(true);

        try {
            const res = await fetch(`${BASE}/api/test/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question }),
            });

            const data = await res.json();
            const answer = (data as Record<string, unknown>).answer || (data as Record<string, unknown>).response || "I couldn't generate a response.";
            setMessages(prev => [...prev, { role: "assistant", content: String(answer) }]);
        } catch {
            setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I'm unable to connect right now." }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {/* Floating Trigger Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-accent flex items-center justify-center shadow-elevated hover:bg-accent-bright transition-all hover:scale-105 active:scale-95"
                    title="Ask ROBIN"
                >
                    <MessageSquare size={20} className="text-base" />
                </button>
            )}

            {/* Chat Panel */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 z-50 w-[380px] h-[520px] bg-surface border border-border rounded-xl shadow-elevated flex flex-col animate-slide-up overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-raised">
                        <div className="flex items-center gap-2">
                            <Sparkles size={16} className="text-accent" />
                            <h3 className="text-sm font-semibold text-text-primary">Ask ROBIN</h3>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-text-muted hover:text-text-primary transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-3">
                        {messages.length === 0 && (
                            <div className="text-center pt-8">
                                <Sparkles size={28} className="text-text-muted mx-auto mb-3 opacity-30" />
                                <p className="text-xs text-text-muted mb-4">Ask me anything about your media data.</p>
                                <div className="space-y-1.5">
                                    {SUGGESTED_QUESTIONS.map((q, i) => (
                                        <button
                                            key={i}
                                            onClick={() => sendMessage(q)}
                                            className="w-full text-left text-xs px-3 py-2 rounded-md bg-overlay text-text-secondary hover:bg-raised hover:text-text-primary transition-colors"
                                        >
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed ${msg.role === "user"
                                        ? "bg-accent/10 text-text-primary rounded-br-sm"
                                        : "bg-raised text-text-secondary rounded-bl-sm"
                                    }`}>
                                    {msg.content}
                                </div>
                            </div>
                        ))}

                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-raised px-3 py-2 rounded-lg rounded-bl-sm">
                                    <Loader2 size={14} className="text-text-muted animate-spin" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Input */}
                    <div className="px-4 py-3 border-t border-border">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                                placeholder="Ask a question..."
                                className="input text-sm flex-1"
                                disabled={loading}
                            />
                            <button
                                onClick={() => sendMessage()}
                                disabled={!input.trim() || loading}
                                className="btn btn-primary p-2"
                            >
                                <Send size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
