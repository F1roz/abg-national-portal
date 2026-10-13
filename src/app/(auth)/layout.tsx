export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0b3a6e] to-brand px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="mx-auto mb-3 h-14 w-14" />
          <div className="text-xl font-bold">AIESEC in Bangladesh</div>
          <div className="text-sm text-blue-100">National Portal</div>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">{children}</div>
      </div>
    </div>
  );
}
