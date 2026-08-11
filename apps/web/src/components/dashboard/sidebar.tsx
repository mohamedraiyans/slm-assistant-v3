"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import type { DocumentSummary, FaqEntry } from "@slm/shared-types";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const FAQ_POLL_MS = 30_000;

interface SidebarProps {
  documents: DocumentSummary[];
  onChanged: () => void;
  onAskQuestion: (question: string) => void;
}

export function Sidebar({ documents, onChanged, onAskQuestion }: SidebarProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState<"documents" | "faq">("documents");
  const [faq, setFaq] = useState<FaqEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadFaq() {
      try {
        const res = await fetch(`${API_URL}/chat/faq`, { credentials: "include" });
        if (res.ok) setFaq(await res.json());
      } catch {
        // Background poll — ignore transient failures.
      }
    }
    loadFaq();
    const interval = setInterval(loadFaq, FAQ_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/documents`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Failed to upload ${file.name}`);
      }
    }

    setUploading(false);
    onChanged();
  }

  async function handleDelete(filename: string) {
    await fetch(`${API_URL}/documents/${encodeURIComponent(filename)}`, {
      method: "DELETE",
      credentials: "include",
    });
    onChanged();
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 border-r border-border bg-background p-4">
      <div className="flex gap-1 rounded-md border border-border p-1 text-sm">
        <button
          onClick={() => setTab("documents")}
          className={`flex-1 rounded px-2 py-1 ${
            tab === "documents" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          Documents
        </button>
        <button
          onClick={() => setTab("faq")}
          className={`flex-1 rounded px-2 py-1 ${
            tab === "faq" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          Frequently Asked
        </button>
      </div>

      {tab === "documents" && (
        <>
          <div
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setDragOver(false);
              void uploadFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center text-sm transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border text-muted-foreground"
            }`}
          >
            <span>{uploading ? "Uploading..." : "Drop files or click to upload"}</span>
            <span className="text-xs text-muted-foreground">.txt, .pdf, .docx</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.docx"
              multiple
              className="hidden"
              onChange={(e) => void uploadFiles(e.target.files)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-col gap-2 overflow-y-auto">
            {documents.length === 0 && (
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            )}
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
              >
                <a
                  href={`${API_URL}/documents/${encodeURIComponent(doc.filename)}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:underline"
                  title={doc.filename}
                >
                  {doc.filename}
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(doc.filename)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "faq" && (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {faq.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No questions asked yet — frequently asked questions will show up here as people chat.
            </p>
          )}
          {faq.map((entry) => (
            <button
              key={entry.question}
              onClick={() => onAskQuestion(entry.question)}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-left text-sm hover:bg-muted"
              title="Click to ask this question"
            >
              <span className="truncate">{entry.question}</span>
              <span className="shrink-0 text-xs text-muted-foreground">×{entry.count}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
