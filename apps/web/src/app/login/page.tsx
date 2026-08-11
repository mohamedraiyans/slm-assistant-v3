import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 font-sans">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card/60 px-12 py-14 text-center shadow-2xl shadow-black/40 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to SLM Assistant</h1>
        <Button
          nativeButton={false}
          render={<a href={`${API_URL}/auth/google`} />}
        >
          Sign in with Google
        </Button>
      </div>
    </div>
  );
}
