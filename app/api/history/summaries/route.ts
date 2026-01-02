import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireAnonId } from "../../_anon";

export async function POST(req: Request) {
  const anonId = await requireAnonId();
  const supabase = getSupabaseAdmin();
  
  if (!anonId) return NextResponse.json({ error: "NO_ANON" }, { status: 401 });

  const body = await req.json();
  const { documentId, preset, model, summaryText, inputChars, chunkCount } = body as {
    documentId: string;
    preset: "short" | "bullet" | "detailed";
    model?: string | null;
    summaryText: string;
    inputChars?: number;
    chunkCount?: number;
  };

  const { data, error } = await supabase
    .from("summaries")
    .insert({
      document_id: documentId,
      anon_id: anonId,
      user_id: null,
      preset,
      model: model ?? null,
      summary_text: summaryText,
      input_chars: inputChars ?? 0,
      chunk_count: chunkCount ?? 0,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ summaryId: data.id });
}
