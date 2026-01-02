"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/client";

type Preset = "short" | "bullet" | "detailed";
type ToastType = "success" | "error" | "info";

type Toast = {
  id: string;
  type: ToastType;
  message: string;
};

export default function PdfExtractor() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [text, setText] = useState("");
  const [showText, setShowText] = useState(true);
  const [preset, setPreset] = useState<Preset>("bullet");
  const [result, setResult] = useState("");

  const [toasts, setToasts] = useState<Toast[]>([]);

  const canSummarize = useMemo(
    () => text.trim().length >= 20 && !summarizing,
    [text, summarizing]
  );
  const textLen = useMemo(() => text.length, [text]);
  const resultLen = useMemo(() => result.length, [result]);

  const router = useRouter();

  /* ---------------------------
   * PDF Password Modal state
   * -------------------------- */
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const pendingPdfRef = useRef<File | null>(null);

  function openPwModalFor(file: File, msg?: string) {
    pendingPdfRef.current = file;
    setPwOpen(true);
    setPw("");
    setPwError(msg ?? null);
  }

  function closePwModal() {
    setPwOpen(false);
    setPw("");
    setPwError(null);
    pendingPdfRef.current = null;
  }

  function isPasswordPdfError(e: any) {
    const msg = String(e?.message ?? e ?? "").toLowerCase();
    return (
      e?.name === "PasswordException" ||
      msg.includes("no password given") ||
      msg.includes("need a password") ||
      msg.includes("password required") ||
      msg.includes("incorrect password") ||
      msg.includes("bad password") ||
      msg.includes("password") || // 🔥 넓게 잡아서 모달로 강제 유도
      msg.includes("encrypted")
    );
  }

  /* ---------------------------
   * Toast helpers
   * -------------------------- */
  function pushToast(type: ToastType, message: string, ttlMs = 2600) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const toast: Toast = { id, type, message };
    setToasts((prev) => [toast, ...prev]);

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, ttlMs);
  }

  /* ---------------------------
   * File extractors
   * -------------------------- */

  // ✅ password 재시도 가능하도록 password?: string 추가
  async function extractPdfText(file: File, password?: string) {
    const pdfjs = await import("pdfjs-dist/build/pdf");

    // worker: public/pdf.worker.min.mjs (304는 정상)
    (pdfjs as any).GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const buf = await file.arrayBuffer();
    const uint8 = new Uint8Array(buf);

    const task = (pdfjs as any).getDocument(
      password ? { data: uint8, password } : { data: uint8 }
    );
    const pdf = await task.promise;

    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((it: any) => it.str).filter(Boolean);
      fullText += strings.join(" ") + "\n\n";
    }

    return normalizePlainText(fullText.trim());
  }

  async function extractDocxText(file: File) {
    const mammoth = await import("mammoth/mammoth.browser");
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return normalizePlainText((value ?? "").trim());
  }

  async function extractHwpxText(file: File) {
    const JSZip = (await import("jszip")).default;
    const fxp = await import("fast-xml-parser");
    const XMLParser = (fxp as any).XMLParser;

    const zip = await JSZip.loadAsync(await file.arrayBuffer());

    const allPaths = Object.keys(zip.files);

    const sectionPaths = allPaths
      .filter((p) => /section\d+\.xml$/i.test(p) && /contents\//i.test(p))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const candidatePaths =
      sectionPaths.length > 0
        ? sectionPaths
        : allPaths
            .filter((p) => /\.xml$/i.test(p) && /contents\//i.test(p))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const parser = new XMLParser({
      ignoreAttributes: true,
      trimValues: true,
      parseTagValue: true,
    });

    const out: string[] = [];
    const TEXT_KEYS = new Set(["t", "text", "#text"]);

    const collectTextOnly = (node: any) => {
      if (node == null) return;

      if (typeof node === "string") {
        const s = node.trim();
        if (s) out.push(s);
        return;
      }

      if (Array.isArray(node)) {
        for (const it of node) collectTextOnly(it);
        return;
      }

      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (TEXT_KEYS.has(k)) collectTextOnly(v);
          else collectTextOnly(v);
        }
      }
    };

    for (const path of candidatePaths) {
      try {
        const xml = await zip.files[path].async("text");
        const obj = parser.parse(xml);
        collectTextOnly(obj);
      } catch {
        // ignore
      }
    }

    const merged = out.join(" ").replace(/\s+/g, " ").trim();
    return normalizePlainText(merged);
  }

  /* ---------------------------
   * File handlers
   * -------------------------- */
  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    setFileName(file.name);
    setExtracting(true);
    setResult("");
    setText("");
    setPwOpen(false);
    setPwError(null);
    pendingPdfRef.current = null;

    try {
      let extracted = "";

      if (name.endsWith(".pdf")) {
        extracted = await extractPdfText(file); // 1차: 비번 없이
      } else if (name.endsWith(".docx")) {
        extracted = await extractDocxText(file);
      } else if (name.endsWith(".hwpx")) {
        extracted = await extractHwpxText(file);
      } else if (name.endsWith(".doc")) {
        pushToast(
          "info",
          "DOC(구형 .doc)은 브라우저 추출이 어려워요. DOCX로 저장 후 업로드해주세요."
        );
        return;
      } else if (name.endsWith(".hwp")) {
        pushToast(
          "info",
          "HWP(구형 .hwp)은 브라우저 추출이 어려워요. HWPX 또는 PDF로 저장 후 업로드해주세요."
        );
        return;
      } else {
        pushToast("error", "지원 형식: PDF / DOCX / HWPX / DOC / HWP");
        return;
      }

      if (!extracted || extracted.trim().length === 0) {
        pushToast(
          "error",
          "텍스트를 추출하지 못했어요. 스캔본(이미지) 문서일 수 있어요."
        );
      } else {
        pushToast("success", "텍스트 추출 완료");
      }

      setText(extracted);
      setShowText(true);
    } catch (e: any) {
      // ✅ 여기서 No password given이면 토스트 대신 모달
      if (name.endsWith(".pdf") && isPasswordPdfError(e)) {
        openPwModalFor(file);
        return;
      }
      pushToast("error", `추출 오류: ${e?.message ?? "unknown error"}`);
    } finally {
      setExtracting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function retryPdfWithPassword() {
    const file = pendingPdfRef.current;
    if (!file) return;

    const password = pw.trim();
    if (!password) {
      setPwError("비밀번호를 입력해주세요.");
      return;
    }

    setExtracting(true);
    setResult("");
    setText("");

    try {
      const extracted = await extractPdfText(file, password);

      if (!extracted || extracted.trim().length === 0) {
        pushToast(
          "error",
          "텍스트를 추출하지 못했어요. 스캔본(이미지) 문서일 수 있어요."
        );
        return;
      }

      setText(extracted);
      setShowText(true);
      pushToast("success", "텍스트 추출 완료");
      closePwModal();
    } catch (e: any) {
      if (isPasswordPdfError(e)) {
        setPwOpen(true);
        setPwError("비밀번호가 올바르지 않습니다. 다시 입력해주세요.");
        return;
      }
      pushToast("error", `추출 오류: ${e?.message ?? "unknown error"}`);
      closePwModal();
    } finally {
      setExtracting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave() {
    setDragOver(false);
  }

  /* ---------------------------
   * Summarize
   * -------------------------- */
  async function summarize() {
    const safeText = text.trim();
    if (safeText.length < 20) {
      pushToast("info", "텍스트가 너무 짧아요. (최소 20자)");
      return;
    }
    if (!fileName) {
      pushToast("info", "먼저 파일을 업로드해주세요.");
      return;
    }

    setSummarizing(true);
    setResult("");

    try {
      await fetch("/api/anon", {
        method: "POST",
        credentials: "include",
      }).catch(() => {});

      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;

      const sumRes = await fetch("/api/summarize", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text: safeText,
          preset,
          filename: fileName,
          mime_type: "text/plain",
        }),
      });

      if (sumRes.status === 402) {
        const j = await sumRes.json().catch(() => null);
        if (j?.code === "AUTH_REQUIRED") {
          if (
            !confirm(
              "무료 횟수를 모두 이용하였습니다.\n로그인 이후 계속 이용 가능합니다.\n로그인 페이지로 이동하시겠습니까?"
            )
          ) {
            return;
          }
          router.push("/login");
          return;
        }
      }

      const sumJson = await sumRes.json();
      if (!sumRes.ok) throw new Error(sumJson?.error || "요약 실패");

      const summaryText = sumJson.summary ?? "";
      setResult(summaryText);
      pushToast("success", "요약 완료");
    } catch (e: any) {
      pushToast("error", `요약/저장 오류: ${e?.message ?? "unknown error"}`);
    } finally {
      setSummarizing(false);
    }
  }

  /* ---------------------------
   * Copy / Download
   * -------------------------- */
  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      pushToast("success", `${label} 복사 완료`);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      pushToast("success", `${label} 복사 완료`);
    }
  }

  function downloadTextFile(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function normalizePlainText(input: string) {
    return (
      (input ?? "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/(\w)-\n(\w)/g, "$1$2")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }

  /* ---------------------------
   * UI
   * -------------------------- */
  return (
    <div className="mt-6">
      {/* Toasts */}
      <div className="fixed right-4 top-4 z-50 flex w-[320px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "rounded-xl border px-3 py-2 text-sm shadow-sm backdrop-blur",
              t.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "",
              t.type === "error"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "",
              t.type === "info"
                ? "border-slate-200 bg-white/90 text-slate-900"
                : "",
            ].join(" ")}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* PDF Password Modal */}
      {pwOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <div className="text-base font-semibold">비밀번호가 필요한 PDF</div>
            <div className="mt-1 text-sm text-slate-600">
              이 PDF는 암호로 보호되어 있어요. 비밀번호를 입력하면 다시 시도합니다.
            </div>

            <div className="mt-3 space-y-2">
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void retryPdfWithPassword();
                }}
                placeholder="PDF 비밀번호"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                autoFocus
              />
              {pwError && <div className="text-sm text-rose-600">{pwError}</div>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                onClick={closePwModal}
                disabled={extracting}
              >
                취소
              </button>
              <button
                className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
                onClick={() => void retryPdfWithPassword()}
                disabled={extracting}
              >
                {extracting ? "재시도 중…" : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">문서 업로드 & 요약</h2>
            <p className="mt-1 text-sm text-slate-600">
              지원: PDF / DOCX / HWPX (DOC/HWP는 변환 후 업로드 권장)
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>텍스트: {textLen.toLocaleString()} chars</div>
            <div>요약: {resultLen.toLocaleString()} chars</div>
          </div>
        </div>

        {/* Drag & Drop */}
        <div
          className={[
            "mt-4 rounded-2xl border-2 border-dashed p-5 transition",
            dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50",
          ].join(" ")}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="text-sm font-medium">
              파일을 드래그&드롭하거나 클릭해서 업로드
            </div>
            <div className="text-xs text-slate-600">
              PDF / DOCX / HWPX 즉시 추출 · DOC/HWP는 DOCX/HWPX/PDF로 저장 후 업로드
            </div>

            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept={[
                ".pdf",
                ".doc",
                ".docx",
                ".hwp",
                ".hwpx",
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ].join(",")}
              onChange={onFileChange}
            />

            <button
              type="button"
              className="mt-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              파일 선택
            </button>

            {fileName ? (
              <div className="mt-2 text-xs text-slate-600">선택됨: {fileName}</div>
            ) : null}
          </div>
        </div>

        {/* Skeleton for extracting */}
        {extracting ? (
          <div className="mt-4 space-y-3">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-slate-100" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : null}

        {/* Extracted text */}
        {!extracting && (text || result) ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">추출된 텍스트</h3>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                    onClick={() => setShowText((v) => !v)}
                  >
                    {showText ? "접기" : "펼치기"}
                  </button>
                  <button
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                    onClick={() => copyToClipboard(text, "추출 텍스트")}
                    disabled={!text}
                  >
                    복사
                  </button>
                  <button
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                    onClick={() => downloadTextFile(text, `extracted_${Date.now()}.txt`)}
                    disabled={!text}
                  >
                    다운로드
                  </button>
                </div>
              </div>

              {showText ? (
                <textarea
                  className="mt-3 h-64 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="추출된 텍스트가 여기에 표시됩니다."
                />
              ) : (
                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  (숨김 상태)
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as Preset)}
                >
                  <option value="short">짧게</option>
                  <option value="bullet">핵심 요약</option>
                  <option value="detailed">자세히</option>
                </select>

                <button
                  className={[
                    "rounded-xl px-4 py-2 text-sm font-medium text-white",
                    canSummarize ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300",
                  ].join(" ")}
                  disabled={!canSummarize}
                  onClick={summarize}
                >
                  {summarizing ? "요약 중…" : "요약하기"}
                </button>

                <button
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={() => {
                    setText("");
                    setResult("");
                    setFileName("");
                    pushToast("info", "초기화 완료");
                  }}
                >
                  초기화
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">요약 결과</h3>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                    onClick={() => copyToClipboard(result, "요약")}
                    disabled={!result}
                  >
                    복사
                  </button>
                  <button
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                    onClick={() => downloadTextFile(result, `summary_${Date.now()}.txt`)}
                    disabled={!result}
                  >
                    다운로드
                  </button>
                </div>
              </div>

              {summarizing ? (
                <div className="mt-3 space-y-3">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                  <div className="h-36 w-full animate-pulse rounded-xl bg-slate-100" />
                </div>
              ) : (
                <textarea
                  className="mt-3 h-64 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none"
                  value={result}
                  readOnly
                  placeholder="요약 결과가 여기에 표시됩니다."
                />
              )}

              <div className="mt-3 text-xs text-slate-500">
                팁: DOC/HWP는 변환 권장. HWPX는 한글에서 “다른 이름으로 저장 → HWPX”.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
