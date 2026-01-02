import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    cwd: process.cwd(),
    urlHead: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30) ?? null,
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

}
