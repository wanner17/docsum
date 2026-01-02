"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/client";

type Summary = {
  id: string;
  preset: "short" | "bullet" | "detailed";
  model: string | null;
  summary_text: string;
  created_at: string;
};

type Doc = {
  id: string;
  filename: string;
  text_len: number;
  normalized_text: string | null;
  created_at: string;
};

const PRESET_LABEL: Record<Summary["preset"], string> = {
  short: "요약(짧게)",
  bullet: "요약(핵심 요약)",
  detailed: "요약(자세히)",
};

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [doc, setDoc] = useState<Doc | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ✅ 타입 고정: headers 유니온 문제 방지
  async function getAuthHeader(): Promise<Record<string, string>> {
    const { data } = await supabaseBrowser.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const authHeader = await getAuthHeader();

      const res = await fetch(`/api/history/documents/${id}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: {
          ...authHeader,
        },
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErr(json.error || "Failed");
        setDoc(null);
        setSummaries([]);
        return;
      }

      setDoc(json.document ?? null);
      setSummaries(json.summaries ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
      setDoc(null);
      setSummaries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function deleteDocument() {
    if (!confirm("문서를 삭제할까요? (연결된 요약도 함께 삭제됩니다)")) return;
    setBusy("delete-doc");

    try {
      const authHeader = await getAuthHeader();

      const res = await fetch(`/api/history/documents/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          ...authHeader,
        },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed");

      // ✅ 목록으로 이동 + 갱신
      router.push("/history");
      router.refresh();
    } catch (e: any) {
      alert(e.message || "Error");
    } finally {
      setBusy(null);
    }
  }

  async function deleteSummary(summaryId: string) {
    if (!confirm("이 요약을 삭제할까요?")) return;
    setBusy(`delete-sum:${summaryId}`);

    try {
      const authHeader = await getAuthHeader();

      const res = await fetch(`/api/history/summaries/${summaryId}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          ...authHeader,
        },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed");

      setSummaries((prev) => prev.filter((s) => s.id !== summaryId));
    } catch (e: any) {
      alert(e.message || "Error");
    } finally {
      setBusy(null);
    }
  }

  async function resummarize(preset: "short" | "bullet" | "detailed") {
    if (!doc?.normalized_text) return alert("원문 텍스트를 저장하지 않아 재요약이 불가합니다.");

    setBusy(`resum:${preset}`);
    try {
      const authHeader = await getAuthHeader();

      const r1 = await fetch("/api/summarize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          documentId: doc.id,          // ✅ 가능하면 doc.id도 같이 보내기 (서버에서 upsert 더 안전)
          text: doc.normalized_text,
          preset,
          filename: doc.filename,
          mime_type: "text/plain",
        }),
      });

      const j1 = await r1.json().catch(() => ({}));

      if (r1.status === 402 && j1.code === "AUTH_REQUIRED") {
        if (
            !confirm(
              "무료 횟수를 모두 이용하였습니다.\n로그인 이후 계속 이용 가능합니다.\n로그인 페이지로 이동하시겠습니까?"
            )
          ) {
            return;
          }
        // 👉 로그인 페이지로 이동 (원래 페이지 기억)
        router.push(`/login?next=/history/${doc.id}`);
        return;
      }

      if (!r1.ok) throw new Error(j1.error || "Summarize failed");

      await load(); // 최신 목록 다시 로드
    } catch (e: any) {
      alert(e.message || "Error");
    } finally {
      setBusy(null);
    }
  }


  if (loading) return <main className="p-4 sm:p-6">Loading...</main>;
  if (err) return <main className="p-4 sm:p-6">Error: {err}</main>;
  if (!doc) return <main className="p-4 sm:p-6">Not found</main>;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">문서</h1>
        <Link className="text-sm underline" href="/history">
          ← History
        </Link>
      </div>

      {/* Document Card */}
      <section className="mt-6 rounded-xl border p-4">
        <p className="break-words font-medium">{doc.filename}</p>
        <p className="mt-1 text-xs opacity-70">
          {new Date(doc.created_at).toLocaleString()} ·{" "}
          {doc.text_len.toLocaleString()} chars
        </p>

        {/* Actions */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <button
            className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-40 sm:w-auto"
            disabled={busy !== null}
            onClick={() => resummarize("short")}
          >
            {busy === "resum:short" ? "요약중..." : "재요약(짧게)"}
          </button>

          <button
            className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-40 sm:w-auto"
            disabled={busy !== null}
            onClick={() => resummarize("bullet")}
          >
            {busy === "resum:bullet" ? "요약중..." : "재요약(핵심 요약)"}
          </button>

          <button
            className="col-span-2 w-full rounded-lg border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-40 sm:col-span-1 sm:w-auto"
            disabled={busy !== null}
            onClick={() => resummarize("detailed")}
          >
            {busy === "resum:detailed" ? "요약중..." : "재요약(자세히)"}
          </button>

          <button
            className="col-span-2 w-full rounded-lg border border-red-500 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 sm:ml-auto sm:col-span-1 sm:w-auto"
            disabled={busy !== null}
            onClick={deleteDocument}
          >
            {busy === "delete-doc" ? "삭제중..." : "문서 삭제"}
          </button>
        </div>

        {!doc.normalized_text && (
          <p className="mt-3 text-xs text-amber-700">
            이 문서는 normalized_text가 저장되지 않아 재요약이 불가합니다.
          </p>
        )}
      </section>

      {/* Summaries */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">요약</h2>

        <ul className="mt-3 space-y-3">
          {summaries.map((s) => (
            <li key={s.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {PRESET_LABEL[s.preset]}
                    {s.model ? ` · ${s.model}` : ""}
                  </p>
                  <p className="text-xs opacity-70">
                    {new Date(s.created_at).toLocaleString()}
                  </p>
                </div>

                <button
                  className="self-start rounded-lg border px-3 py-2 text-xs hover:bg-black/5 disabled:opacity-40 sm:self-auto"
                  disabled={busy !== null}
                  onClick={() => deleteSummary(s.id)}
                >
                  {busy === `delete-sum:${s.id}` ? "삭제중..." : "삭제"}
                </button>
              </div>

              <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                {s.summary_text}
              </pre>
            </li>
          ))}
        </ul>

        {summaries.length === 0 && (
          <p className="mt-3 text-sm opacity-70">No summaries yet.</p>
        )}
      </section>
    </main>
  );
}
