"use client";

import { useRouter } from "next/navigation";
import type { UserSummary } from "@slm/shared-types";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function UserTable({
  users,
  currentUserId,
}: {
  users: UserSummary[];
  currentUserId: string;
}) {
  const router = useRouter();

  async function handleDelete(id: string) {
    await fetch(`${API_URL}/users/${id}`, { method: "DELETE", credentials: "include" });
    router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Joined</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                No users yet.
              </td>
            </tr>
          )}
          {users.map((user) => (
            <tr key={user.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">{user.email}</td>
              <td className="px-3 py-2">{user.name ?? "—"}</td>
              <td className="px-3 py-2">
                <span className={user.role === "ADMIN" ? "text-amber-400" : "text-muted-foreground"}>
                  {user.role}
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(user.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-right">
                {user.id === currentUserId ? (
                  <span className="text-xs text-muted-foreground">You</span>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void handleDelete(user.id)}>
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
