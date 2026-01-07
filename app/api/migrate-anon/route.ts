import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireAnonId } from "@/app/lib/anon";
import { getUserIdFromAuthHeader } from "@/app/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const anonId = await requireAnonId();
    const userId = await getUserIdFromAuthHeader(req);

    if (!userId) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { data, error } = await supabase.rpc("migrate_anon_to_user", {
      p_anon_id: anonId,
      p_user_id: userId,
    });

    if (error) {
      console.error("[migrate-anon] rpc error", {
        anonId,
        userId,
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
      });

      return NextResponse.json(
        {
          ok: false,
          code: "MIGRATE_FAILED",
          message: error.message,
          details: (error as any).details ?? null,
          hint: (error as any).hint ?? null,
        },
        { status: 500 }
      );
    }

    console.log("[migrate-anon] ok", { anonId, userId, data });
    return NextResponse.json({ ok: true, data: data ?? null });
  } catch (e: any) {
    console.error("[migrate-anon] fatal", e);
    return NextResponse.json(
      { ok: false, code: "UNKNOWN", message: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
