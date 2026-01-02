import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin"; // 너가 쓰는 지연 생성

export async function getUserIdFromAuthHeader(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user?.id) return null;
  return data.user.id; // uuid string
}
