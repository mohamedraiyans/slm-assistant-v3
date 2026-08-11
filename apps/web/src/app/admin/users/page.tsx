import { redirect } from "next/navigation";
import type { UserSummary } from "@slm/shared-types";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { UserTable } from "./user-table";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  const res = await apiFetch("/users");
  const users: UserSummary[] = res.ok ? await res.json() : [];

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 bg-background px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <UserTable users={users} currentUserId={user.id} />
    </div>
  );
}
