// app/(app)/page.tsx
import AnonInit from "../AnonInit";
import PdfExtractorLoader from "../PdfExtractorLoader"; // 이 파일 위치에 따라 조정
// 만약 PdfExtractorLoader도 ui 폴더에 있다면 "../ui/PdfExtractorLoader"

export default function Page() {
  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <AnonInit />
      <PdfExtractorLoader />
    </main>
  );
}
