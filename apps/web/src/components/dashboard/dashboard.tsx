"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthUser, DocumentSummary, ProviderName } from "@slm/shared-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { LogoutButton } from "@/components/logout-button";
import { ProviderManager } from "./provider-manager";
import { UserManager } from "./user-manager";
import { Sidebar } from "./sidebar";
import { ChatPanel, type ChatPanelHandle } from "./chat-panel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function Dashboard({ user }: { user: AuthUser }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [providers, setProviders] = useState<ProviderName[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatRef = useRef<ChatPanelHandle>(null);

  const refreshDocuments = useCallback(async () => {
    const res = await fetch(`${API_URL}/documents`, { credentials: "include" });
    if (res.ok) setDocuments(await res.json());
  }, []);

  const refreshProviders = useCallback(async () => {
    const res = await fetch(`${API_URL}/providers/available`, { credentials: "include" });
    if (res.ok) setProviders(await res.json());
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
      <header className="flex flex-wrap items-center justify-between gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            ☰
          </Button>
          <h1 className="text-lg font-semibold tracking-tight">SLM Assistant v3</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">
            {user.email} · {user.role}
          </span>
          {user.role === "ADMIN" && (
            <>
              <Dialog
                open={providersOpen}
                onOpenChange={(open) => {
                  setProvidersOpen(open);
                  if (!open) refreshProviders();
                }}
              >
                <DialogTrigger render={<Button variant="outline" size="sm" />}>
                  Provider keys
                </DialogTrigger>
                <DialogContent>
                  <ProviderManager />
                </DialogContent>
              </Dialog>
              <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
                <DialogTrigger render={<Button variant="outline" size="sm" />}>
                  Users
                </DialogTrigger>
                <DialogContent>
                  <UserManager currentUserId={user.id} />
                </DialogContent>
              </Dialog>
            </>
          )}
          <LogoutButton />
        </div>
      </header>

      {loaded && providers.length === 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          No LLM provider is configured yet.{" "}
          {user.role === "ADMIN" ? (
            <button onClick={() => setProvidersOpen(true)} className="underline">
              Add one
            </button>
          ) : (
            "Ask an admin to add one under Provider Keys."
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          className={`fixed inset-y-0 left-0 z-40 flex transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            documents={documents}
            onChanged={refreshDocuments}
            onAskQuestion={(question) => {
              chatRef.current?.ask(question);
              setSidebarOpen(false);
            }}
            isAdmin={user.role === "ADMIN"}
          />
        </div>
        <ChatPanel ref={chatRef} providers={providers} />
      </div>
    </div>
  );
}
