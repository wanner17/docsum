import { cookies } from "next/headers";
import { randomUUID } from "crypto";

const ANON_COOKIE = "anon_id";

export async function requireAnonId() {
  const cookieStore = await cookies();

  let anonId = cookieStore.get(ANON_COOKIE)?.value;

  if (!anonId) {
    anonId = randomUUID();

    cookieStore.set({
      name: ANON_COOKIE,
      value: anonId,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }

  return anonId;
}
