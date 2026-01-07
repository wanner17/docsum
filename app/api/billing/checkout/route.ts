import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { getUserIdFromAuthHeader } from "@/app/lib/auth";
import { STRIPE_PRICE_ID, PaidPlan } from "@/app/lib/billing/stripe";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover", // 최신이 아니어도 동작하지만, 너 설치된 stripe 버전에 맞춰 자동으로 잡히기도 함
});

function getSiteUrl(req: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    req.headers.get("origin") ||
    "http://localhost:3000"
  );
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "not_logged_in" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as PaidPlan;

    if (plan !== "basic" && plan !== "pro") {
      return NextResponse.json({ ok: false, error: "invalid_plan" }, { status: 400 });
    }

    const priceId = STRIPE_PRICE_ID[plan];
    if (!priceId) {
      return NextResponse.json({ ok: false, error: "missing_price_id" }, { status: 500 });
    }

    const supabase = getSupabaseAdmin();

    // profiles 조회 (없으면 upsert로 만들 예정)
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id ?? null;

    // customer 없으면 생성
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { user_id: userId },
      });
      customerId = customer.id;

      await supabase.from("profiles").upsert({
        id: userId,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });
    }

    const siteUrl = getSiteUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${siteUrl}/billing?success=1`,
      cancel_url: `${siteUrl}/billing?canceled=1`,
      // 나중에 세금/주소 필요하면 여기 추가
      // customer_update: { address: "auto" },
    });

    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error("[billing/checkout] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
