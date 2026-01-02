"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/app/lib/supabase/client";

type Doc = {
  id: string;
  filename: string;
  mime_type: string | null;
  text_len: number;
  created_at: string;
};

export default function HistoryPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // ✅ 로그인 토큰 가져오기
        const { data } = await supabaseBrowser.auth.getSession();
        const token = data.session?.access_token;

        const res = await fetch("/api/history/documents", {
          method: "GET",
          credentials: "include",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed");
        setDocs(json.documents ?? []);
      } catch (e: any) {
        setErr(e.message || "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">History</h1>
        <Link className="text-sm underline" href="/">
          ← Back
        </Link>
      </div>

      {loading && <p className="mt-6 text-sm opacity-70">Loading...</p>}
      {err && <p className="mt-6 text-sm text-red-500">{err}</p>}

      <ul className="mt-6 space-y-3">
        {docs.map((d) => (
          <li key={d.id} className="rounded-xl border p-4 hover:bg-black/5">
            <Link href={`/history/${d.id}`} className="block">
              <p className="truncate font-medium">{d.filename}</p>
              <p className="mt-1 text-xs opacity-70">
                {new Date(d.created_at).toLocaleString()} ·{" "}
                {d.text_len.toLocaleString()} chars
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {!loading && !err && docs.length === 0 && (
        <p className="mt-6 text-sm opacity-70">No documents yet.</p>
      )}
    </main>
  );
}
