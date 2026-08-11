"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AuthUser, DocumentSummary, ProviderName } from "@slm/shared-types";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { Sidebar } from "./sidebar";
import { ChatPanel, type ChatPanelHandle } from "./chat-panel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function Dashboard({ user }: { user: AuthUser }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [providers, setProviders] = useState<ProviderName[]>([]);
  const [loaded, setLoaded] = useState(false);
  const chatRef = useRef<ChatPanelHandle>(null);

  const refreshDocuments = useCallback(async () => {
    const res = await fetch(`${API_URL}/documents`, { credentials: "include" });
    if (res.ok) setDocuments(await res.json());
  }, []);

  useEffect(() => {
    (async () => {
      const [docsRes, providersRes] = await Promise.all([
        fetch(`${API_URL}/documents`, { credentials: "include" }),
        fetch(`${API_URL}/providers/available`, { credentials: "include" }),
      ]);
      if (docsRes.ok) setDocuments(await docsRes.json());
      if (providersRes.ok) setProviders(await providersRes.json());
      setLoaded(true);
    })();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">SLM Assistant v3</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {user.email} · {user.role}
          </span>
          {user.role === "ADMIN" && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/admin/providers" />}
            >
              Provider keys
            </Button>
          )}
          <LogoutButton />
        </div>
      </header>

      {loaded && providers.length === 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          No LLM provider is configured yet.{" "}
          {user.role === "ADMIN" ? (
            <Link href="/admin/providers" className="underline">
              Add one
            </Link>
          ) : (
            "Ask an admin to add one under Provider Keys."
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          documents={documents}
          onChanged={refreshDocuments}
          onAskQuestion={(question) => chatRef.current?.ask(question)}
        />
        <ChatPanel ref={chatRef} providers={providers} />
      </div>
    </div>
  );
}
