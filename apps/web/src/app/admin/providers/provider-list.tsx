"use client";

import { useRouter } from "next/navigation";
import type { ProviderCredentialPublic } from "@slm/shared-types";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function ProviderList({ credentials }: { credentials: ProviderCredentialPublic[] }) {
  const router = useRouter();

  async function handleDelete(id: string) {
    await fetch(`${API_URL}/providers/${id}`, { method: "DELETE", credentials: "include" });
    router.refresh();
  }

  return (
    <ul className="flex flex-col gap-2">
      {credentials.length === 0 && (
        <li className="text-sm text-muted-foreground">No provider keys added yet.</li>
      )}
      {credentials.map((credential) => (
        <li
          key={credential.id}
          className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
        >
          <span>
            <span className="font-medium">{credential.provider}</span> — {credential.label}
          </span>
          <div className="flex items-center gap-3">
            <span className={credential.isActive ? "text-green-400" : "text-muted-foreground"}>
              {credential.isActive ? "active" : "inactive"}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void handleDelete(credential.id)}>
              Delete
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
