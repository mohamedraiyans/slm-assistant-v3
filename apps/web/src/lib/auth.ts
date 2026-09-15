import type { AuthUser } from "@slm/shared-types";
import { API_URL, apiFetch } from "./api";

export type Session =
  | { status: "signed-in"; user: AuthUser }
  | { status: "signed-out" }
  // The api isn't accepting connections — normal for the first minute or so of
  // `turbo run dev`, and briefly after every api file save while nest restarts.
  | { status: "api-unavailable" };

export async function getSession(): Promise<Session> {
  let res: Response;
  try {
    res = await apiFetch("/auth/me");
  } catch {
    // Only the network call is guarded: a refused connection must not surface as a
    // 500 page and a stack trace in the dev terminal, but anything else still should.
    console.warn(`[web] API not reachable at ${API_URL} yet - still starting? Retrying from the browser.`);
    return { status: "api-unavailable" };
  }

  if (!res.ok) return { status: "signed-out" };
  return { status: "signed-in", user: (await res.json()) as AuthUser };
}
