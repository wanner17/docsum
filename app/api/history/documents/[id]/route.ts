import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireAnonId } from "@/app/lib/anon";
import { getUserIdFromAuthHeader } from "@/app/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = await ctx.params;

    const anonId = await requireAnonId();
    const userId = await getUserIdFromAuthHeader(req);

    // ✅ user 우선, 아니면 anon
    const base = supabase
      .from("documents")
      .select("id, filename, mime_type, text_len, normalized_text, created_at, user_id, anon_id")
      .eq("id", id)
      .limit(1);

    const { data: doc, error: docErr } = userId
      ? await base.eq("user_id", userId).maybeSingle()
      : await base.eq("anon_id", anonId).maybeSingle();

    if (docErr) {
      return NextResponse.json({ error: docErr.message }, { status: 500 });
    }
    if (!doc) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // ✅ 문서 소유자에 맞춰 summaries 조회 (owner check 우회 X)
    const sumQuery = supabase
      .from("summaries")
      .select("id, preset, model, summary_text, created_at")
      .eq("document_id", doc.id)
      .order("created_at", { ascending: false });

    const { data: sums, error: sumErr } = userId
      ? await sumQuery.eq("user_id", userId)
      : await sumQuery.eq("anon_id", anonId);

    if (sumErr) {
      return NextResponse.json({ error: sumErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      document: doc,
      summaries: sums ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}


export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = await ctx.params;

    const anonId = await requireAnonId();
    const userId = await getUserIdFromAuthHeader(req);

    const del = supabase.from("documents").delete().eq("id", id);

    const { data: deleted, error } = userId
      ? await del.eq("user_id", userId).select("id")
      : await del.eq("anon_id", anonId).select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!deleted || deleted.length === 0) {
      // ✅ 실제로는 안 지워짐(권한/owner mismatch/이미 없음)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
