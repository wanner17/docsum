import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireAnonId } from "../../../_anon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function getUserIdFromAuth(req: Request, supabase: ReturnType<typeof getSupabaseAdmin>) {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  // service_role client라도 "user 조회"는 supabase.auth.getUser(token)로 가능
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data.user?.id ?? null;
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const userId = await getUserIdFromAuth(req, supabase);

  // 1) 로그인 유저면 user_id로 삭제 시도
  if (userId) {
    const { data, error } = await supabase
      .from("summaries")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id"); // ✅ 삭제된 row 확인용

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "NOT_FOUND_OR_FORBIDDEN" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  // 2) 아니면 익명 anon_id로 삭제
  const anonId = await requireAnonId();
  if (!anonId) return NextResponse.json({ error: "NO_ANON" }, { status: 401 });

  const { data, error } = await supabase
    .from("summaries")
    .delete()
    .eq("id", id)
    .eq("anon_id", anonId)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "NOT_FOUND_OR_FORBIDDEN" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
