"use client";

import { forwardRef, useEffect, useImperativeHandle, useState, type FormEvent } from "react";
import type { ChatSourceMatch, ProviderName, ProviderUsageSnapshot, ProviderUsageWindow } from "@slm/shared-types";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const USAGE_POLL_MS = 20_000;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSourceMatch[];
  cached?: boolean;
  provider?: ProviderName;
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  GROQ: "Groq AI",
  AZURE_OPENAI: "Azure OpenAI",
  ANTHROPIC: "Anthropic",
};

const PROVIDER_LABEL_CLASSES: Record<ProviderName, string> = {
  GROQ: "text-emerald-400",
  AZURE_OPENAI: "text-sky-400",
  ANTHROPIC: "text-purple-400",
};

interface ChatPanelProps {
  providers: ProviderName[];
}

export interface ChatPanelHandle {
  ask: (question: string) => void;
}

function scoreClass(score: number): string {
  if (score >= 0.5) return "text-green-400";
  if (score >= 0.25) return "text-amber-400";
  return "text-red-400";
}

function windowPct(w: ProviderUsageWindow): number | null {
  if (w.limit === null || w.remaining === null || w.limit === 0) return null;
  return Math.round((w.remaining / w.limit) * 100);
}

// Whichever window (requests or tokens) is more constrained decides the badge,
// since exhausting either one is what actually blocks the next call.
function usagePct(snapshot: ProviderUsageSnapshot): number | null {
  const requestsPct = windowPct(snapshot.requests);
  const tokensPct = windowPct(snapshot.tokens);
  if (requestsPct === null) return tokensPct;
  if (tokensPct === null) return requestsPct;
  return Math.min(requestsPct, tokensPct);
}

function usageClass(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 50) return "text-green-400";
  if (pct >= 20) return "text-amber-400";
  return "text-red-400";
}

function usageTooltip(snapshot: ProviderUsageSnapshot): string {
  if (!snapshot.updatedAt) return "No usage data yet — send a message with this provider first";
  const parts: string[] = [];
  if (snapshot.requests.limit !== null && snapshot.requests.remaining !== null) {
    parts.push(`Requests: ${snapshot.requests.remaining}/${snapshot.requests.limit}`);
  }
  if (snapshot.tokens.limit !== null && snapshot.tokens.remaining !== null) {
    parts.push(`Tokens: ${snapshot.tokens.remaining}/${snapshot.tokens.limit}`);
  }
  const resetHint = snapshot.tokens.resetHint ?? snapshot.requests.resetHint;
  if (resetHint) parts.push(`resets in ${resetHint}`);
  return parts.length > 0 ? parts.join(" · ") : "No usage data yet";
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel(
  { providers },
  ref,
) {
  const [provider, setProvider] = useState<ProviderName | undefined>(providers[0]);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<ProviderUsageSnapshot[]>([]);

  useEffect(() => {
    if (!provider && providers.length > 0) {
      setProvider(providers[0]);
    }
  }, [providers, provider]);

  async function loadUsage() {
    try {
      const res = await fetch(`${API_URL}/providers/usage`, { credentials: "include" });
      if (res.ok) setUsage(await res.json());
    } catch {
      // Background poll — a transient network blip shouldn't surface as a page error.
    }
  }

  useEffect(() => {
    loadUsage();
    const interval = setInterval(loadUsage, USAGE_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  async function sendQuestion(question: string) {
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);
    setError(null);

    const res = await fetch(`${API_URL}/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, provider }),
    });

    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.message ?? "Something went wrong asking that question.");
      return;
    }

    const data: { response: string; sources: ChatSourceMatch[]; cached: boolean } = await res.json();
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: data.response, sources: data.sources, cached: data.cached, provider },
    ]);
    loadUsage();
  }

  useImperativeHandle(ref, () => ({
    ask: (question: string) => void sendQuestion(question),
  }));

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    setInput("");
    void sendQuestion(question);
  }

  async function handleClear() {
    await fetch(`${API_URL}/chat/history/clear`, { method: "POST", credentials: "include" });
    setMessages([]);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-y-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderName)}
            disabled={providers.length === 0}
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
          >
            {providers.length === 0 && <option>No provider configured</option>}
            {providers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2 text-xs">
            {usage.map((snapshot) => {
              const pct = usagePct(snapshot);
              return (
                <span
                  key={snapshot.provider}
                  title={usageTooltip(snapshot)}
                  className={usageClass(pct)}
                >
                  {snapshot.provider} {pct === null ? "—" : `${pct}% left`}
                </span>
              );
            })}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleClear}>
          Clear history
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask a question about your uploaded documents to get started.
          </p>
        )}
        {messages.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-lg rounded-lg px-3 py-2 text-sm ${
                turn.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {turn.content}
              {turn.provider && (
                <span className={`ml-2 text-xs font-normal ${PROVIDER_LABEL_CLASSES[turn.provider]}`}>
                  ({PROVIDER_LABELS[turn.provider]})
                </span>
              )}
              {turn.cached && (
                <span className="ml-2 text-xs font-normal text-amber-400" title="Served instantly from cache">
                  ⚡ cached
                </span>
              )}
            </div>
            {turn.sources && turn.sources.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 text-left">
                {turn.sources.map((source, j) => (
                  <div
                    key={j}
                    className="rounded-md border border-border p-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{source.filename}</span>
                      <span className={scoreClass(source.score)}>
                        {Math.round(source.score * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{source.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-muted-foreground">Thinking...</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <form onSubmit={handleSend} className="flex gap-2 border-t border-border p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={loading || !provider}>
          Send
        </Button>
      </form>
    </div>
  );
});
