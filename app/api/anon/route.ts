import { NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "anon_id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;

  if (existing) {
    return NextResponse.json({ ok: true, anon_id: existing, existing: true });
  }

  const anonId = crypto.randomUUID();
  const res = NextResponse.json({ ok: true, anon_id: anonId, existing: false });

  res.cookies.set({
    name: COOKIE_NAME,
    value: anonId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return res;
}
