import type { AuthUser } from "@slm/shared-types";
import { apiFetch } from "./api";

export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) return null;
  return (await res.json()) as AuthUser;
}
