import AuthHeader from "../components/AuthHeader";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-slate-900 px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <AuthHeader />
        {children}
      </div>
    </div>
  );
}
