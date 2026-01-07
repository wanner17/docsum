import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "crypto";

import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireAnonId } from "@/app/lib/anon";
import { getUserIdFromAuthHeader } from "@/app/lib/auth";

export const runtime = "nodejs";

/**
 * OpenAI
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 운영 안전장치 (1인 운영 B2C MVP)
 */
const MAX_INPUT_CHARS = 300_000;
const CHUNK_CHARS = 18_000;
const CHUNK_OVERLAP = 800;
const MAX_CHUNKS = 30;

/**
 * 익명 무료 제한
 */
const FREE_LIMIT = 3;

type Preset = "short" | "bullet" | "detailed";

function isPreset(x: any): x is Preset {
  return x === "short" || x === "bullet" || x === "detailed";
}

function normalizeText(s: string) {
  return (s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(
  input: string,
  chunkSize = CHUNK_CHARS,
  overlap = CHUNK_OVERLAP
) {
  const text = normalizeText(input);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let slice = text.slice(start, end);

    if (end < text.length) {
      const lastPara = slice.lastIndexOf("\n\n");
      if (lastPara > chunkSize * 0.6) slice = slice.slice(0, lastPara);
      else {
        const lastLine = slice.lastIndexOf("\n");
        if (lastLine > chunkSize * 0.7) slice = slice.slice(0, lastLine);
      }
    }

    slice = slice.trim();
    if (slice) chunks.push(slice);

    start = start + slice.length - overlap;
    if (start < 0) start = 0;
    if (slice.length === 0) break;
  }

  return chunks;
}

function presetInstruction(preset: Preset) {
  switch (preset) {
    case "short":
      return "아주 짧게 5~8문장으로 핵심만 요약해줘.";
    case "bullet":
      return `핵심만 bullet로 정리해줘.
- 결론/요지
- 근거/핵심 포인트
- 중요한 수치/기한/조건(있으면)`;
    case "detailed":
      return `자세하게 구조화해서 요약해줘:
1) 한 줄 요약
2) 핵심 요점
3) 중요한 세부사항
4) 실행 항목`;
  }
}

async function callChat(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    messages,
  });
  return completion.choices?.[0]?.message?.content ?? "";
}

function sha256Hex(text: string) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function safeNonEmptyString(v: unknown, fallback: string) {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return t.length > 0 ? t : fallback;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    const anonId = await requireAnonId();
    const userId = await getUserIdFromAuthHeader(req); // uuid | null

    const body = await req.json();

    const preset: Preset = isPreset(body?.preset) ? body.preset : "bullet";
    const rawText = (body?.text ?? "") as string;

    const filename = safeNonEmptyString(body?.filename, "untitled");
    const mimeType = safeNonEmptyString(body?.mime_type, "text/plain");

    const text = normalizeText(rawText);

    if (text.length < 20) {
      return NextResponse.json({ error: "text too short" }, { status: 400 });
    }

    if (text.length > MAX_INPUT_CHARS) {
      return NextResponse.json(
        { error: `text too long (max ${MAX_INPUT_CHARS})` },
        { status: 413 }
      );
    }

    /**
     * ✅ 익명 무료 제한 (summaries 기준)
     */
    if (!userId) {
      const { count, error } = await supabase
        .from("summaries")
        .select("id", { count: "exact", head: true })
        .eq("anon_id", anonId);

      const used = count ?? 0;

      if (!error && used >= FREE_LIMIT) {
        return NextResponse.json(
          {
            ok: false,
            code: "AUTH_REQUIRED",
            message: `익명 요약은 ${FREE_LIMIT}회까지 가능합니다.`,
            limit: FREE_LIMIT,
            used,
          },
          { status: 402 }
        );
      }
    }

    const textHash = sha256Hex(text);

    /**
     * 1) 요약 수행
     */
    let summary = "";
    let mode: "single" | "chunked" = "single";
    let chunkCount = 0;

    if (text.length <= CHUNK_CHARS * 1.2) {
      summary = await callChat([
        { role: "system", content: "너는 정확한 한국어 문서 요약가다." },
        { role: "user", content: `${presetInstruction(preset)}\n\n${text}` },
      ]);
    } else {
      const chunks = chunkText(text);
      chunkCount = chunks.length;

      if (chunks.length > MAX_CHUNKS) {
        return NextResponse.json({ error: "document too long" }, { status: 413 });
      }

      const partials: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        partials.push(
          await callChat([
            { role: "system", content: "너는 정확한 한국어 문서 요약가다." },
            { role: "user", content: `${presetInstruction(preset)}\n\n${chunks[i]}` },
          ])
        );
      }

      summary = await callChat([
        { role: "system", content: "여러 요약을 중복 없이 통합해라." },
        { role: "user", content: partials.join("\n\n") },
      ]);

      mode = "chunked";
    }

    /**
     * 2) DB 저장
     */
    const ownerAnonId = userId ? null : anonId;
    const ownerUserId = userId ?? null;

    const conflictTarget = userId ? "user_id,text_hash" : "anon_id,text_hash";

    const { data: docRow, error: docErr } = await supabase
      .from("documents")
      .upsert(
        {
          anon_id: ownerAnonId,
          user_id: ownerUserId,
          filename,
          mime_type: mimeType,
          text_hash: textHash,
          text_len: text.length,
          normalized_text: text,
        },
        { onConflict: conflictTarget }
      )
      .select("id")
      .single();

    if (docErr || !docRow?.id) {
      return NextResponse.json(
        { error: docErr?.message ?? "failed to save document" },
        { status: 500 }
      );
    }

    // ✅ 재요약 히스토리가 "누적"되도록 RPC append_summary 사용
    const { data: summaryId, error: sumErr } = await supabase.rpc("append_summary", {
      p_document_id: docRow.id,
      p_preset: preset,
      p_summary_text: summary,
      p_model: "gpt-4.1-mini",
      p_anon_id: ownerAnonId,
      p_user_id: ownerUserId,
    });

    if (sumErr || !summaryId) {
      return NextResponse.json(
        { error: sumErr?.message ?? "failed to save summary" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      summary,
      model: "gpt-4.1-mini",
      meta: {
        mode,
        chars: text.length,
        chunks: mode === "chunked" ? chunkCount : 0,
        preset,
        document_id: docRow.id,
        // ✅ 여기! sumRow.id -> summaryId 로 변경
        summary_id: summaryId,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
