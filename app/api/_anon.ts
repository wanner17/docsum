import { cookies } from "next/headers";

export async function requireAnonId() {
  const cookieStore = await cookies();
  const anonId = cookieStore.get("anon_id")?.value;
  return anonId ?? null;
}
