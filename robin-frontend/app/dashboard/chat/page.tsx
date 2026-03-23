"use client";

import { useEffect, useRef, useState } from "react";
import { Send, MessageSquare, Loader2, History, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
}

interface HistoryItem {
    id: string;
    question: string;
    answer: string;
    articles_referenced: string[];
    created_at: string;
}

const STARTER_QUESTIONS = [
    "What are the top risks this week?",
    "Summarise the latest regulatory signals",
    "Which entities have the highest influence right now?",
    "What is the overall sentiment trend?",
];

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyOpen, setHistoryOpen] = useState(true);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Load history on mount
    useEffect(() => {
        (async () => {
            try {
                const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
                const token = localStorage.getItem("robin_token") || sessionStorage.getItem("robin_token") || "";
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (token) headers["Authorization"] = `Bearer ${token}`;
                const res = await fetch(`${BASE}/api/test/chat/history`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    setHistory(data.history ?? []);
                }
            } catch { /* silent */ }
            setLoadingHistory(false);
        })();
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const send = async (text?: string) => {
        const content = (text ?? input).trim();
        if (!content || sending) return;

        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content,
            timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setSending(true);

        const assistantId = crypto.randomUUID();

        setMessages(prev => [...prev, {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
        }]);

        try {
            const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            const token = localStorage.getItem("robin_token") || sessionStorage.getItem("robin_token") || "";
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${BASE}/api/test/chat`, {
                method: "POST",
                headers,
                body: JSON.stringify({ question: content }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const reader = res.body?.getReader();
            if (!reader) throw new Error("No response stream");

            const decoder = new TextDecoder();
            let fullText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

                for (const line of lines) {
                    const payload = line.slice(6);
                    if (payload === "[DONE]") continue;

                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed.type === "token" && parsed.token) {
                            fullText += parsed.token;
                            setMessages(prev =>
                                prev.map(m =>
                                    m.id === assistantId ? { ...m, content: fullText } : m
                                )
                            );
                        }
                    } catch {
                        // Skip unparseable
                    }
                }
            }

            if (!fullText) {
                setMessages(prev =>
                    prev.map(m =>
                        m.id === assistantId
                            ? { ...m, content: "No response generated. Please try again." }
                            : m
                    )
                );
            }

            // Refresh history after successful chat (the backend saves it)
            setTimeout(async () => {
                try {
                    const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
                    const token = localStorage.getItem("robin_token") || sessionStorage.getItem("robin_token") || "";
                    const hdrs: Record<string, string> = { "Content-Type": "application/json" };
                    if (token) hdrs["Authorization"] = `Bearer ${token}`;
                    const hRes = await fetch(`${BASE}/api/test/chat/history`, { headers: hdrs });
                    if (hRes.ok) {
                        const hData = await hRes.json();
                        setHistory(hData.history ?? []);
                    }
                } catch { /* silent */ }
            }, 1000);

        } catch {
            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantId
                        ? { ...m, content: "⚠ Unable to reach the analysis backend. Please verify the server is running." }
                        : m
                )
            );
        }
        setSending(false);
    };

    const loadHistoryItem = (item: HistoryItem) => {
        setMessages([
            {
                id: crypto.randomUUID(),
                role: "user",
                content: item.question,
                timestamp: item.created_at,
            },
            {
                id: crypto.randomUUID(),
                role: "assistant",
                content: item.answer,
                timestamp: item.created_at,
            },
        ]);
    };

    const clearConversation = () => {
        setMessages([]);
    };

    const formatHistoryDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        const diffH = (now.getTime() - d.getTime()) / 3600000;
        if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
        if (diffH < 24) return `${Math.round(diffH)}h ago`;
        if (diffH < 48) return "Yesterday";
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    return (
        <div className="flex h-full max-h-screen">
            {/* History sidebar */}
            <div className={cn(
                "flex-shrink-0 border-r border-border bg-surface transition-all duration-200 flex flex-col",
                historyOpen ? "w-72" : "w-10"
            )}>
                {/* Sidebar header */}
                <div className="flex items-center justify-between px-2 py-3 border-b border-border min-h-[52px]">
                    {historyOpen && (
                        <div className="flex items-center gap-1.5 px-1">
                            <History size={14} className="text-text-muted" />
                            <span className="text-xs font-medium text-text-secondary">Past Conversations</span>
                        </div>
                    )}
                    <button
                        onClick={() => setHistoryOpen(!historyOpen)}
                        className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
                        title={historyOpen ? "Collapse" : "Expand"}
                    >
                        {historyOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                    </button>
                </div>

                {/* History items */}
                {historyOpen && (
                    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                        {loadingHistory ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 size={16} className="animate-spin text-text-muted" />
                            </div>
                        ) : history.length === 0 ? (
                            <p className="text-2xs text-text-muted text-center py-8">No past conversations</p>
                        ) : (
                            history.slice(0, 20).map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => loadHistoryItem(item)}
                                    className="w-full text-left p-2 rounded hover:bg-overlay transition-colors group"
                                >
                                    <p className="text-xs text-text-primary truncate group-hover:text-accent transition-colors">
                                        {item.question.substring(0, 80)}
                                    </p>
                                    <p className="text-2xs text-text-muted mt-0.5">
                                        {formatHistoryDate(item.created_at)}
                                        {item.articles_referenced?.length > 0 && (
                                            <span className="ml-1">· {item.articles_referenced.length} refs</span>
                                        )}
                                    </p>
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Main chat area */}
            <div className="flex flex-col flex-1 min-w-0">
                {/* Header */}
                <div className="flex-shrink-0 px-4 py-4 border-b border-border flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold text-text-primary">Media Chat</h1>
                        <p className="text-sm text-text-muted mt-0.5">Ask anything about your monitored media landscape</p>
                    </div>
                    {messages.length > 0 && (
                        <button
                            onClick={clearConversation}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                            <Trash2 size={12} />
                            Clear
                        </button>
                    )}
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center py-8">
                            <MessageSquare size={32} className="text-text-muted mb-3 opacity-40" />
                            <p className="text-text-secondary text-sm mb-1">Start a conversation</p>
                            <p className="text-text-muted text-xs mb-6">Ask about threats, signals, entities, narratives, or trends</p>

                            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                                {STARTER_QUESTIONS.map(q => (
                                    <button
                                        key={q}
                                        onClick={() => send(q)}
                                        className="px-3 py-1.5 rounded-full bg-raised border border-border text-xs text-text-secondary hover:text-text-primary hover:border-border-active transition-colors"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map(msg => (
                            <div
                                key={msg.id}
                                className={cn(
                                    "flex gap-3",
                                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                                )}
                            >
                                <div className={cn(
                                    "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                                    msg.role === "user" ? "bg-accent text-white" : "bg-overlay text-text-secondary"
                                )}>
                                    {msg.role === "user" ? "U" : "R"}
                                </div>

                                <div className={cn(
                                    "max-w-[75%] rounded-xl px-4 py-3",
                                    msg.role === "user"
                                        ? "bg-accent text-white rounded-tr-sm"
                                        : "bg-surface border border-border text-text-primary rounded-tl-sm"
                                )}>
                                    <div className="message-content text-sm leading-relaxed">
                                        {msg.role === "assistant" ? (
                                            <ReactMarkdown
                                                components={{
                                                    h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1 text-text-primary">{children}</h2>,
                                                    h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-text-secondary">{children}</h3>,
                                                    strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                                                    ul: ({ children }) => <ul className="list-disc ml-4 my-1.5 space-y-1">{children}</ul>,
                                                    ol: ({ children }) => <ol className="list-decimal ml-4 my-1.5 space-y-1">{children}</ol>,
                                                    li: ({ children }) => <li className="text-text-secondary text-sm">{children}</li>,
                                                    p: ({ children }) => <p className="mb-2 text-text-secondary leading-relaxed">{children}</p>,
                                                    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>,
                                                }}
                                            >
                                                {msg.content}
                                            </ReactMarkdown>
                                        ) : (
                                            <p className="text-white whitespace-pre-wrap">{msg.content}</p>
                                        )}
                                    </div>
                                    <div className={cn(
                                        "text-2xs mt-1.5",
                                        msg.role === "user" ? "text-white/60 text-right" : "text-text-muted"
                                    )}>
                                        {formatTime(msg.timestamp)}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}

                    {sending && (
                        <div className="flex gap-3">
                            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-overlay flex items-center justify-center">
                                <span className="text-xs font-bold text-text-secondary">R</span>
                            </div>
                            <div className="bg-surface border border-border rounded-xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                                <Loader2 size={13} className="animate-spin text-text-muted" />
                                <span className="text-xs text-text-muted">Analysing data…</span>
                            </div>
                        </div>
                    )}

                    <div ref={bottomRef} />
                </div>

                {/* Input area */}
                <div className="flex-shrink-0 px-4 py-4 border-t border-border bg-surface">
                    <div className="flex items-end gap-2 max-w-4xl mx-auto">
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    send();
                                }
                            }}
                            placeholder="Ask about threats, signals, entities, or recent articles… (Enter to send)"
                            rows={1}
                            className="input resize-none flex-1 min-h-[42px] max-h-[120px] overflow-y-auto leading-relaxed py-2.5"
                            style={{ height: "auto" }}
                            onInput={e => {
                                const el = e.target as HTMLTextAreaElement;
                                el.style.height = "auto";
                                el.style.height = Math.min(el.scrollHeight, 120) + "px";
                            }}
                        />
                        <button
                            onClick={() => send()}
                            disabled={!input.trim() || sending}
                            className={cn(
                                "btn-primary flex-shrink-0 h-[42px] px-4",
                                (!input.trim() || sending) && "opacity-40 cursor-not-allowed"
                            )}
                        >
                            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
