"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ChatSourceMatch, ProviderName } from "@slm/shared-types";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSourceMatch[];
}

interface ChatPanelProps {
  providers: ProviderName[];
}

function scoreClass(score: number): string {
  if (score >= 0.5) return "text-green-600";
  if (score >= 0.25) return "text-orange-500";
  return "text-red-600";
}

export function ChatPanel({ providers }: ChatPanelProps) {
  const [provider, setProvider] = useState<ProviderName | undefined>(providers[0]);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider && providers.length > 0) {
      setProvider(providers[0]);
    }
  }, [providers, provider]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
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

    const data: { response: string; sources: ChatSourceMatch[] } = await res.json();
    setMessages((prev) => [...prev, { role: "assistant", content: data.response, sources: data.sources }]);
  }

  async function handleClear() {
    await fetch(`${API_URL}/chat/history/clear`, { method: "POST", credentials: "include" });
    setMessages([]);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 p-3 dark:border-zinc-800">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderName)}
          disabled={providers.length === 0}
          className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-sm dark:border-zinc-800"
        >
          {providers.length === 0 && <option>No provider configured</option>}
          {providers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={handleClear}>
          Clear history
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Ask a question about your uploaded documents to get started.
          </p>
        )}
        {messages.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-lg rounded-lg px-3 py-2 text-sm ${
                turn.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-zinc-100 dark:bg-zinc-900"
              }`}
            >
              {turn.content}
            </div>
            {turn.sources && turn.sources.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 text-left">
                {turn.sources.map((source, j) => (
                  <div
                    key={j}
                    className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{source.filename}</span>
                      <span className={scoreClass(source.score)}>
                        {Math.round(source.score * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-zinc-500">{source.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-zinc-400">Thinking...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <form onSubmit={handleSend} className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800"
        />
        <Button type="submit" disabled={loading || !provider}>
          Send
        </Button>
      </form>
    </div>
  );
}
