import { redirect } from "next/navigation";
import type { ProviderCredentialPublic } from "@slm/shared-types";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { ProviderForm } from "./provider-form";
import { ProviderList } from "./provider-list";

export default async function AdminProvidersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  const res = await apiFetch("/providers");
  const credentials: ProviderCredentialPublic[] = res.ok ? await res.json() : [];

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Provider Keys</h1>
      <ProviderForm />
      <ProviderList credentials={credentials} />
    </div>
  );
}
