import { cookies } from "next/headers";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Cookie: cookieStore.toString(),
    },
    cache: "no-store",
  });
}
