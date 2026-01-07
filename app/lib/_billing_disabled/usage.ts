import { PLAN_LIMITS, Plan } from "./plans";

export async function getPlanAndLimit(supabase: any, userId: string) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("plan, plan_status")
    .eq("id", userId)
    .single();

  // profile 없으면 free로 취급(또는 가입 시 생성 권장)
  const plan = (profile?.plan as Plan) || "free";
  const status = profile?.plan_status || "active";
  const limit = PLAN_LIMITS[plan];

  return { plan, status, limit };
}

export async function getCurrentMonthUsage(supabase: any, userId: string) {
  const ym = new Date().toISOString().slice(0, 7); // 'YYYY-MM' (KST/UTC 차이 민감하면 서버에서 계산 권장)
  const { data } = await supabase
    .from("usage_monthly")
    .select("chars_used, summaries_used")
    .eq("user_id", userId)
    .eq("ym", ym)
    .maybeSingle();

  return {
    ym,
    charsUsed: Number(data?.chars_used ?? 0),
    summariesUsed: Number(data?.summaries_used ?? 0),
  };
}
