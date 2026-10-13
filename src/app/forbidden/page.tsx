import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div>
        <div className="text-5xl">🔒</div>
        <h1 className="mt-3 text-xl font-bold">You don't have access to this</h1>
        <p className="mt-1 text-sm text-gray-500">Access follows your position, department and LC. Ask your leader if you think you should.</p>
        <Link href="/dashboard" className="btn-primary mt-4">Back to dashboard</Link>
      </div>
    </div>
  );
}
