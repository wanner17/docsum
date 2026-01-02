"use client";

import { useMemo, useRef, useState } from "react";

/**
 * =========================
 * Types
 * =========================
 */
type ToastType = "success" | "error" | "info";
type Toast = { id: string; type: ToastType; message: string };

type ExtractOk = {
  ok: true;
  text: string;
  filename: string;
  mime: string;
};
type ExtractFail = {
  ok: false;
  kind: "PASSWORD_REQUIRED" | "PASSWORD_INCORRECT" | "UNSUPPORTED" | "OTHER";
  message: string;
  filename?: string;
  mime?: string;
};
type ExtractResult = ExtractOk | ExtractFail;

/**
 * =========================
 * Utils
 * =========================
 */
function normalizePlainText(input: string) {
  let t = input ?? "";
  // 제어문자 제거
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  // 하이픈 줄바꿈 병합(영문)
  t = t.replace(/-\s*\n\s*/g, "");
  // 줄바꿈/공백 정리
  t = t.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
  // 빈 줄 축소
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function isLikelyPasswordIssue(err: any) {
  const raw = err?.message ?? err;
  const msg = String(raw || "");
  const lower = msg.toLowerCase();

  // 🔥 넓게 잡아서 "No password given"이든 뭐든 무조건 비번 모달로 보내기
  const hit =
    err?.name === "PasswordException" ||
    lower.includes("no password given") ||
    lower.includes("need a password") ||
    lower.includes("password required") ||
    lower.includes("incorrect password") ||
    lower.includes("bad password") ||
    lower.includes("password") ||
    lower.includes("encrypted");

  const incorrect =
    lower.includes("incorrect password") || lower.includes("bad password");

  return { hit, incorrect, msg };
}

/**
 * =========================
 * PDFJS worker setup
 * - public/pdf.worker.min.mjs 필요
 * =========================
 */
async function ensurePdfjsWorker() {
  const w: any = window as any;
  if (w.__PDFJS_WORKER_READY__) return;

  const pdfjsLib = await import("pdfjs-dist");

  // 중복 생성 방지
  if (!w.__PDFJS_WORKER__) {
    w.__PDFJS_WORKER__ = new Worker(
      new URL("/pdf.worker.min.mjs", window.location.href),
      { type: "module" }
    );
  }

  // 4.x에서 workerPort가 안정적인 경우가 많음
  (pdfjsLib as any).GlobalWorkerOptions.workerPort = w.__PDFJS_WORKER__;
  w.__PDFJS_WORKER_READY__ = true;
}

/**
 * =========================
 * Extract: PDF (NEVER throws)
 * =========================
 */
async function extractPdf(file: File, password?: string): Promise<ExtractResult> {
  try {
    await ensurePdfjsWorker();
    const pdfjsLib = await import("pdfjs-dist");

    const buffer = await file.arrayBuffer();

    let loadingTask: any | null = null;
    let pdf: any | null = null;

    try {
      loadingTask = (pdfjsLib as any).getDocument(
        password ? { data: buffer, password } : { data: buffer }
      );

      pdf = await loadingTask.promise;

      const texts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = (content.items as any[])
          .map((it) => (it?.str ? String(it.str) : ""))
          .join(" ");
        texts.push(pageText);
      }

      return {
        ok: true,
        text: normalizePlainText(texts.join("\n")),
        filename: file.name,
        mime: file.type || "application/pdf",
      };
    } catch (err: any) {
      const pw = isLikelyPasswordIssue(err);

      // ✅ password 미제공 상태에서 password issue -> PASSWORD_REQUIRED
      if (pw.hit && !password) {
        return {
          ok: false,
          kind: "PASSWORD_REQUIRED",
          message: pw.msg || "비밀번호가 필요한 PDF입니다.",
          filename: file.name,
          mime: file.type || "application/pdf",
        };
      }

      // ✅ password 제공했는데도 password issue -> PASSWORD_INCORRECT
      if (pw.hit && password) {
        return {
          ok: false,
          kind: "PASSWORD_INCORRECT",
          message: pw.incorrect
            ? "비밀번호가 올바르지 않습니다."
            : "비밀번호가 필요하거나 올바르지 않습니다.",
          filename: file.name,
          mime: file.type || "application/pdf",
        };
      }

      // 그 외
      return {
        ok: false,
        kind: "OTHER",
        message: pw.msg || "PDF 추출 중 오류가 발생했습니다.",
        filename: file.name,
        mime: file.type || "application/pdf",
      };
    } finally {
      // 리소스 정리
      try {
        await loadingTask?.destroy?.();
      } catch {}
      try {
        await pdf?.cleanup?.();
      } catch {}
      try {
        await pdf?.destroy?.();
      } catch {}
    }
  } catch (err: any) {
    return {
      ok: false,
      kind: "OTHER",
      message: String(err?.message ?? err ?? "PDF 처리 오류"),
      filename: file.name,
      mime: file.type || "application/pdf",
    };
  }
}

/**
 * =========================
 * Extract: DOCX (optional, NEVER throws)
 * =========================
 */
async function extractDocx(file: File): Promise<ExtractResult> {
  try {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = normalizePlainText(result?.value || "");
    return { ok: true, text, filename: file.name, mime: file.type || "docx" };
  } catch (err: any) {
    return {
      ok: false,
      kind: "OTHER",
      message: String(err?.message ?? err ?? "DOCX 추출 오류"),
      filename: file.name,
      mime: file.type || "docx",
    };
  }
}

/**
 * =========================
 * Extract: HWPX (optional, NEVER throws)
 * - zip + xml 파싱(간단 버전). 실제 네 로직이 있으면 교체해서 써도 됨.
 * =========================
 */
async function extractHwpx(file: File): Promise<ExtractResult> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());

    // Contents/section*.xml 텍스트만 수집
    const keys = Object.keys(zip.files).filter((k) =>
      /^Contents\/section\d+\.xml$/i.test(k)
    );
    if (keys.length === 0) {
      return {
        ok: false,
        kind: "OTHER",
        message: "HWPX에서 section XML을 찾지 못했습니다.",
        filename: file.name,
        mime: file.type || "hwpx",
      };
    }

    const parser = new DOMParser();
    const all: string[] = [];

    for (const k of keys.sort()) {
      const xml = await zip.files[k].async("string");
      const doc = parser.parseFromString(xml, "text/xml");

      // t / text / #text 노드만 긁기: 여기선 간단하게 모든 텍스트 노드 수집
      const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        const v = (node.nodeValue || "").trim();
        if (v) all.push(v);
        node = walker.nextNode();
      }
    }

    const text = normalizePlainText(all.join("\n"));
    return { ok: true, text, filename: file.name, mime: file.type || "hwpx" };
  } catch (err: any) {
    return {
      ok: false,
      kind: "OTHER",
      message: String(err?.message ?? err ?? "HWPX 추출 오류"),
      filename: file.name,
      mime: file.type || "hwpx",
    };
  }
}

/**
 * =========================
 * Dispatcher: NEVER throws
 * =========================
 */
async function extractFileText(
  file: File,
  opts?: { password?: string }
): Promise<ExtractResult> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file, opts?.password);
  }
  if (name.endsWith(".docx")) {
    return extractDocx(file);
  }
  if (name.endsWith(".hwpx")) {
    return extractHwpx(file);
  }
  if (name.endsWith(".doc") || name.endsWith(".hwp")) {
    return {
      ok: false,
      kind: "UNSUPPORTED",
      message: "DOC/HWP(구형)은 DOCX/HWPX/PDF로 변환 후 업로드해 주세요.",
      filename: file.name,
      mime: file.type,
    };
  }

  return {
    ok: false,
    kind: "UNSUPPORTED",
    message: "지원하지 않는 파일 형식입니다.",
    filename: file.name,
    mime: file.type,
  };
}

/**
 * =========================
 * Component
 * =========================
 */
export default function PdfExtractor() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // UI state
  const [fileName, setFileName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [text, setText] = useState("");

  // Toast
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  };

  // Password modal state
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);

  const closePwModal = () => {
    setPwOpen(false);
    setPw("");
    setPwError(null);
    pendingFileRef.current = null;
  };

  const openPwModalFor = (file: File, msg?: string) => {
    pendingFileRef.current = file;
    setPwOpen(true);
    setPwError(msg || null);
    setPw(""); // 기본은 초기화
  };

  /**
   * ✅ 여기만 토스트를 띄운다 (중요)
   * - extractFileText는 절대 throw 안 하므로 "외부 catch 토스트"가 새지 않음
   */
  const handleFile = async (file: File) => {
    setFileName(file.name);
    setText("");
    setExtracting(true);
    closePwModal();

    const res = await extractFileText(file);

    setExtracting(false);

    if (res.ok) {
      setText(res.text);
      pushToast("success", "추출 완료");
      return;
    }

    if (res.kind === "PASSWORD_REQUIRED") {
      // ✅ No password given → 토스트 금지, 무조건 모달
      openPwModalFor(file, undefined);
      return;
    }

    // PASSWORD_INCORRECT는 이 시점엔 거의 안 오지만 안전하게 처리
    if (res.kind === "PASSWORD_INCORRECT") {
      openPwModalFor(file, "비밀번호가 올바르지 않습니다.");
      return;
    }

    // OTHER/UNSUPPORTED만 토스트
    pushToast("error", `추출 오류: ${res.message}`);
  };

  const retryWithPassword = async () => {
    const file = pendingFileRef.current;
    if (!file) return;

    const password = pw.trim();
    if (!password) {
      setPwError("비밀번호를 입력해주세요.");
      return;
    }

    setExtracting(true);

    const res = await extractFileText(file, { password });

    setExtracting(false);

    if (res.ok) {
      setText(res.text);
      pushToast("success", "비밀번호 PDF 추출 완료");
      closePwModal();
      return;
    }

    if (res.kind === "PASSWORD_REQUIRED" || res.kind === "PASSWORD_INCORRECT") {
      // ✅ 비번 넣었는데도 password 계열이면 → 대부분 틀린 비번
      setPwOpen(true);
      setPwError("비밀번호가 올바르지 않습니다. 다시 입력해주세요.");
      return;
    }

    pushToast("error", `추출 오류: ${res.message}`);
    closePwModal();
  };

  return (
    <div className="space-y-4">
      {/* Toast */}
      <div className="fixed right-4 top-4 z-[60] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "max-w-sm rounded-xl border bg-white px-3 py-2 text-sm shadow",
              t.type === "success" ? "border-green-200" : "",
              t.type === "error" ? "border-red-200" : "",
              t.type === "info" ? "border-blue-200" : "",
            ].join(" ")}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* File input */}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.hwpx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          void handleFile(f);
        }}
      />

      <div className="flex items-center gap-2">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60"
          onClick={() => inputRef.current?.click()}
          disabled={extracting}
        >
          파일 선택
        </button>

        <div className="text-sm text-black/60">
          {fileName ? (
            <>
              {fileName} {extracting ? "(추출 중...)" : ""}
            </>
          ) : (
            "PDF / DOCX / HWPX"
          )}
        </div>

        <div className="ml-auto text-xs text-black/50">
          텍스트: {text.length} chars
        </div>
      </div>

      {/* Result */}
      <div className="rounded-xl border p-3">
        <div className="mb-2 text-sm font-medium">추출 텍스트 (plain)</div>
        <pre className="whitespace-pre-wrap break-words text-sm">
          {text || "아직 추출된 텍스트가 없습니다."}
        </pre>
      </div>

      {/* Password Modal */}
      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <div className="text-base font-semibold">비밀번호가 필요한 PDF</div>
            <div className="mt-1 text-sm text-black/60">
              이 PDF는 암호로 보호되어 있어요. 비밀번호를 입력하면 다시 시도합니다.
            </div>

            <div className="mt-3 space-y-2">
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void retryWithPassword();
                }}
                placeholder="PDF 비밀번호"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                autoFocus
              />
              {pwError && <div className="text-sm text-red-600">{pwError}</div>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60"
                onClick={closePwModal}
                disabled={extracting}
              >
                취소
              </button>
              <button
                className="rounded-lg bg-black px-3 py-2 text-sm text-white hover:bg-black/90 disabled:opacity-60"
                onClick={() => void retryWithPassword()}
                disabled={extracting}
              >
                {extracting ? "재시도 중..." : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
