import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to SLM Assistant</h1>
      <Button
        nativeButton={false}
        render={<a href={`${API_URL}/auth/google`} />}
      >
        Sign in with Google
      </Button>
    </div>
  );
}
