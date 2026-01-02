"use client";

import dynamic from "next/dynamic";

const PdfExtractor = dynamic(() => import("./PdfExtractor"), {
  ssr: false,
  loading: () => <p style={{ marginTop: 16 }}>PDF 모듈 로딩 중…</p>,
});

export default function PdfExtractorLoader() {
  return <PdfExtractor />;
}
