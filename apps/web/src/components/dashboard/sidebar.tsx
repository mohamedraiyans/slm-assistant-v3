"use client";

import { useRef, useState, type DragEvent } from "react";
import type { DocumentSummary } from "@slm/shared-types";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface SidebarProps {
  documents: DocumentSummary[];
  onChanged: () => void;
}

export function Sidebar({ documents, onChanged }: SidebarProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    <aside className="flex w-72 shrink-0 flex-col gap-4 border-r border-zinc-200 p-4 dark:border-zinc-800">
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
            : "border-zinc-300 text-zinc-500 dark:border-zinc-700"
        }`}
      >
        <span>{uploading ? "Uploading..." : "Drop files or click to upload"}</span>
        <span className="text-xs text-zinc-400">.txt, .pdf, .docx</span>
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
          <p className="text-sm text-zinc-500">No documents yet.</p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
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
    </aside>
  );
}
