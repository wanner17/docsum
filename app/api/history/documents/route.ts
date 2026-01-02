import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireAnonId } from "@/app/lib/anon";
import { getUserIdFromAuthHeader } from "@/app/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    const anonId = await requireAnonId();
    const userId = await getUserIdFromAuthHeader(req);

    // ✅ 디버그(로컬에서만)
    if (process.env.NODE_ENV !== "production") {
      console.log("[history/documents] hasAuth?", !!req.headers.get("authorization"), "userId:", userId, "anonId:", anonId);
    }

    const base = supabase
      .from("documents")
      .select("id, filename, mime_type, text_len, created_at, user_id, anon_id")
      .order("created_at", { ascending: false })
      .limit(100);

    const { data, error } = userId
      ? await base.eq("user_id", userId)
      : await base.eq("anon_id", anonId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, documents: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
