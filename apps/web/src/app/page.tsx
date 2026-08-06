import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard/dashboard";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <Dashboard user={user} />;
}
