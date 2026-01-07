export type Plan = "free" | "basic" | "pro";

export const PLAN_LIMITS: Record<Plan, { monthlyChars: number; monthlySummaries?: number }> = {
  free:  { monthlyChars: 200_000, monthlySummaries: 30 },   // 회원 free (익명 3회는 기존 유지)
  basic: { monthlyChars: 2_000_000 },
  pro:   { monthlyChars: 10_000_000 },
};