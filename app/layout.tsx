// app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "Docsum",
  description: "Document summary SaaS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
