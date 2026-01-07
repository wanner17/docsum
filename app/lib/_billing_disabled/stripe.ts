export type PaidPlan = "basic" | "pro";

export const STRIPE_PRICE_ID: Record<PaidPlan, string> = {
  basic: process.env.STRIPE_PRICE_BASIC!,
  pro: process.env.STRIPE_PRICE_PRO!,
};

export function planFromPriceId(priceId: string | null | undefined): PaidPlan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_BASIC) return "basic";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  return null;
}
