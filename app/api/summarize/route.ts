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
 * 운영 안전장치(혼자 운영 B2C MVP 기준)
 */
const MAX_INPUT_CHARS = 300_000; // 업로드 텍스트 최대 길이
const CHUNK_CHARS = 18_000; // 1차 요약 chunk 크기
const CHUNK_OVERLAP = 800; // overlap
const MAX_CHUNKS = 30; // 비용 폭주 방지

/**
 * 익명 무료 제한
 */
const FREE_LIMIT = 5;

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

    // 가능하면 문단 경계에서 끊기
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

    // overlap 적용
    start = start + slice.length - overlap;
    if (start < 0) start = 0;

    if (slice.length === 0) break;
  }

  return chunks;
}

function presetInstruction(preset: Preset) {
  switch (preset) {
    case "short":
      return `아주 짧게 5~8문장으로 핵심만 요약해줘. 불필요한 서론/수사는 빼.`;
    case "bullet":
      return `핵심만 bullet로 정리해줘. (5~12개 내외)
- 결론/요지
- 근거/핵심 포인트
- 중요한 수치/기한/조건(있으면)`;
    case "detailed":
      return `자세하게 구조화해서 요약해줘:
1) 한 줄 요약
2) 핵심 요점(10~15개)
3) 중요한 세부사항(수치/조건/기한/예외)
4) 실행 항목(To-do/권고)`;
    default:
      return `핵심 요약해줘.`;
  }
}

/**
 * OpenAI 호출(간단 재시도 포함)
 */
async function callChat(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
) {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        messages,
      });
      return completion.choices?.[0]?.message?.content ?? "";
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function chunkSummarizePrompt(
  chunk: string,
  preset: Preset,
  index: number,
  total: number
) {
  return [
    {
      role: "system" as const,
      content:
        "너는 정확한 한국어 문서 요약가다. 추측하지 말고, 원문에 있는 정보만 요약해라.",
    },
    {
      role: "user" as const,
      content:
        `다음은 문서의 일부(${index}/${total})다. 이 부분의 핵심만 뽑아서 요약해줘.\n` +
        `- 반복/서식/머리말/꼬리말/페이지번호 같은 잡음은 제거\n` +
        `- 인명/기관/수치/기한/조건은 가능한 유지\n` +
        `- 다음 지침을 따른다: ${presetInstruction(preset)}\n\n` +
        `=== 문서 일부 시작 ===\n${chunk}\n=== 문서 일부 끝 ===`,
    },
  ];
}

function finalSummarizePrompt(partials: string[], preset: Preset) {
  const joined = partials
    .map((s, i) => `[#${i + 1}]\n${normalizeText(s)}`)
    .join("\n\n");

  return [
    {
      role: "system" as const,
      content:
        "너는 정확한 한국어 문서 요약가다. 여러 부분 요약을 통합하여 중복 없이 정리한다.",
    },
    {
      role: "user" as const,
      content:
        `아래는 문서 여러 부분을 요약한 결과들이다. 이를 통합해 최종 요약을 만들어줘.\n` +
        `- 중복 제거\n- 서로 모순되는 부분이 있으면 '충돌 가능'로 표시\n- 원문에 없는 추측 금지\n` +
        `- 다음 지침을 따른다: ${presetInstruction(preset)}\n\n` +
        `=== 부분 요약들 시작 ===\n${joined}\n=== 부분 요약들 끝 ===`,
    },
  ];
}

/**
 * ✅ 서버(Node)에서 SHA-256 hex 생성
 */
function sha256Hex(text: string) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * ✅ NOT NULL 컬럼 안전값 보장
 */
function safeNonEmptyString(v: unknown, fallback: string) {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return t.length > 0 ? t : fallback;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    // ✅ anon 쿠키 확보(익명일 때만 실제 사용)
    const anonId = await requireAnonId();

    // ✅ Authorization: Bearer <token> 있으면 userId
    const userId = await getUserIdFromAuthHeader(req); // uuid string | null

    const body = await req.json();

    const preset: Preset = isPreset(body?.preset) ? body.preset : "bullet";
    const rawText = (body?.text ?? "") as string;

    // ✅ 기본값 보장 (documents NOT NULL 대비)
    const filename = safeNonEmptyString(body?.filename, "untitled");
    const mimeType = safeNonEmptyString(body?.mime_type, "text/plain");

    const text = normalizeText(rawText);

    if (text.length < 20) {
      return NextResponse.json({ error: "text too short" }, { status: 400 });
    }

    if (text.length > MAX_INPUT_CHARS) {
      return NextResponse.json(
        {
          error: `text too long (max ${MAX_INPUT_CHARS.toLocaleString()} chars)`,
        },
        { status: 413 }
      );
    }

    // ✅ 익명 무료 5회 제한 (로그인하면 제한 없음)
    if (!userId) {
      const { data: usedRaw, error } = await supabase.rpc("get_summary_count", {
        p_anon_id: anonId,
        p_user_id: null,
      });

      const used = (usedRaw ?? 0) as number;
      if (!error && used >= FREE_LIMIT) {
        return NextResponse.json(
          {
            ok: false,
            code: "AUTH_REQUIRED",
            message: `익명 요약은 ${FREE_LIMIT}회까지 가능합니다. 로그인 후 계속 이용할 수 있어요.`,
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
        {
          role: "system",
          content:
            "너는 정확한 한국어 문서 요약가다. 추측하지 말고, 원문에 있는 정보만 요약해라.",
        },
        {
          role: "user",
          content: `${presetInstruction(preset)}\n\n${text}`,
        },
      ]);
      mode = "single";
    } else {
      const chunks = chunkText(text, CHUNK_CHARS, CHUNK_OVERLAP);
      chunkCount = chunks.length;

      if (chunks.length > MAX_CHUNKS) {
        return NextResponse.json(
          {
            error: `document too long (chunks ${chunks.length} > max ${MAX_CHUNKS}). Consider shortening input.`,
          },
          { status: 413 }
        );
      }

      const partials: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const prompt = chunkSummarizePrompt(
          chunks[i],
          preset,
          i + 1,
          chunks.length
        );
        partials.push(await callChat(prompt));
      }

      summary = await callChat(finalSummarizePrompt(partials, preset));
      mode = "chunked";
    }

    /**
     * 2) DB 저장
     * ✅ documents_owner_check / summaries_owner_check 만족: (anon_id XOR user_id)
     */
    const ownerAnonId = userId ? null : anonId;
    const ownerUserId = userId ?? null;

    const docPayload: any = {
      anon_id: ownerAnonId,
      user_id: ownerUserId,
      filename,
      mime_type: mimeType,
      text_hash: textHash,
      text_len: text.length,
      normalized_text: text,
    };

    // ✅ 로그인/익명에 따라 conflict target 분기
    const conflictTarget = userId ? "user_id,text_hash" : "anon_id,text_hash";

    const { data: docRow, error: docErr } = await supabase
      .from("documents")
      .upsert(docPayload, { onConflict: conflictTarget })
      .select("id")
      .single();

    if (docErr || !docRow?.id) {
      return NextResponse.json(
        { error: docErr?.message ?? "failed to save document" },
        { status: 500 }
      );
    }

    const summaryPayload: any = {
      document_id: docRow.id,
      preset,
      summary_text: summary,
      model: "gpt-4.1-mini",
      anon_id: ownerAnonId, // ✅ 익명일 때만 값
      user_id: ownerUserId, // ✅ 로그인일 때만 값
    };

    const { data: sumRow, error: sumErr } = await supabase
      .from("summaries")
      .insert(summaryPayload)
      .select("id")
      .single();

    if (sumErr) {
      return NextResponse.json(
        { error: sumErr.message ?? "failed to save summary" },
        { status: 500 }
      );
    }

    /**
     * 3) ✅ 성공 후 카운트 +1
     */
    await supabase.rpc("increment_summary_count", {
      p_anon_id: userId ? null : anonId,
      p_user_id: userId,
    });

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
        summary_id: sumRow?.id ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
