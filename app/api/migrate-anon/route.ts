import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireAnonId } from "@/app/lib/anon";
import { getUserIdFromAuthHeader } from "@/app/lib/auth";

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();

  const anonId = await requireAnonId();
  const userId = await getUserIdFromAuthHeader(req);

  if (!userId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const { error } = await supabase.rpc("migrate_anon_to_user", {
    p_anon_id: anonId,
    p_user_id: userId,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, code: "MIGRATE_FAILED", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
