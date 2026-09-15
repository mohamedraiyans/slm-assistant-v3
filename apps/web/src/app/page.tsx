import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ApiUnavailable } from "@/components/api-unavailable";
import { Dashboard } from "@/components/dashboard/dashboard";

export default async function Home() {
  const session = await getSession();
  if (session.status === "api-unavailable") return <ApiUnavailable />;
  if (session.status === "signed-out") redirect("/login");

  return <Dashboard user={session.user} />;
}
