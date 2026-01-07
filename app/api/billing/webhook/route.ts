import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { planFromPriceId } from "@/app/lib/billing/stripe";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // 네 stripe 패키지 버전에 따라 타입이 다를 수 있어서,
  // apiVersion은 없어도 동작함. (있어도 됨)
  // apiVersion: "2025-01-27.acacia",
});

function toIsoFromUnixSeconds(v: unknown): string | null {
  if (typeof v !== "number") return null;
  return new Date(v * 1000).toISOString();
}

async function findUserIdByCustomer(stripeCustomerId: string) {
  // 1) Stripe customer metadata 우선
  const c = await stripe.customers.retrieve(stripeCustomerId);
  if (!("deleted" in c) && c.metadata?.user_id) return c.metadata.user_id;

  // 2) 없으면 DB 역조회
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json(
      { ok: false, error: "missing_stripe_signature_or_webhook_secret" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("[billing/webhook] signature verify failed:", err?.message);
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    /**
     * ✅ 구독 생성/갱신/변경
     */
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      // event.data.object 타입이 union이라 TS가 빡빡함 → 여기서 단언 + 런타임 체크
      const sub = event.data.object as Stripe.Subscription;

      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

      if (!customerId) {
        console.warn("[billing/webhook] subscription has no customer");
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      // 플랜 판별: 첫 item price 기준(너는 basic/pro 1개만 들어오게 설계)
      const priceId = sub.items?.data?.[0]?.price?.id ?? null;
      const plan = planFromPriceId(priceId) ?? "free";

      const userId = await findUserIdByCustomer(customerId);
      if (!userId) {
        console.warn("[billing/webhook] cannot map userId for customer:", customerId);
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const periodStartIso = toIsoFromUnixSeconds((sub as any).current_period_start);
      const periodEndIso = toIsoFromUnixSeconds((sub as any).current_period_end);

      await supabase.from("profiles").upsert({
        id: userId,
        plan,
        plan_status: sub.status, // active | past_due | canceled | unpaid ...
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        current_period_start: periodStartIso,
        current_period_end: periodEndIso,
        updated_at: new Date().toISOString(),
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    /**
     * ✅ 구독 해지
     */
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;

      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

      if (!customerId) {
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const userId = await findUserIdByCustomer(customerId);
      if (!userId) {
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      await supabase.from("profiles").upsert({
        id: userId,
        plan: "free",
        plan_status: "canceled",
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
        current_period_start: null,
        current_period_end: null,
        updated_at: new Date().toISOString(),
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    /**
     * ✅ 결제 실패(연체 처리)
     */
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;

      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

      if (!customerId) {
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const userId = await findUserIdByCustomer(customerId);
      if (!userId) {
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      await supabase.from("profiles").upsert({
        id: userId,
        plan_status: "past_due",
        updated_at: new Date().toISOString(),
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // 그 외 이벤트는 무시
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[billing/webhook] handler error:", event.type, e?.message || e);
    return NextResponse.json({ ok: false, error: "handler_failed" }, { status: 500 });
  }
}
