import { NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";

const COOKIE_NAME = "anon_id";
const FREE_LIMIT = 3;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUsageCount(anonId: string) {
  const supabaseAdmin = getSupabaseAdmin();

  const { count, error } = await supabaseAdmin
    .from("summaries")
    .select("id", { count: "exact", head: true })
    .eq("anon_id", anonId);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function POST() {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;

  const anonId = existing ?? crypto.randomUUID();

  // 쿠키가 없었으면 새로 세팅
  const res = NextResponse.json({
    ok: true,
    anon_id: anonId,
    existing: Boolean(existing),
    usage_count: 0,
    free_limit: FREE_LIMIT,
  });

  if (!existing) {
    res.cookies.set({
      name: COOKIE_NAME,
      value: anonId,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  const usage = await getUsageCount(anonId);

  // 응답 JSON만 업데이트 (NextResponse는 immutable 느낌이라 새로 만들어줌)
  return NextResponse.json(
    {
      ok: true,
      anon_id: anonId,
      existing: Boolean(existing),
      usage_count: usage,
      free_limit: FREE_LIMIT,
    },
    {
      headers: res.headers,
    }
  );
}
