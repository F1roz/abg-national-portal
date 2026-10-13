import Link from "next/link";
import type { KpiWithActual } from "@/lib/kpi";
import { Progress, Empty } from "./ui";

export function KpiTable({ kpis, bodyNames, showBody = false }: { kpis: KpiWithActual[]; bodyNames?: Map<string, string>; showBody?: boolean }) {
  if (!kpis.length) return <Empty>No KPIs set.</Empty>;
  const fmt = (n: number, unit: string) => (unit === "BDT" ? `৳ ${n.toLocaleString("en-IN")}` : unit === "%" ? `${n}%` : n.toLocaleString("en-IN"));
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr>{showBody ? <th>Body</th> : null}<th>KPI</th><th className="text-right">Target</th><th className="text-right">Actual</th><th className="w-48">Achievement</th></tr></thead>
        <tbody>
          {kpis.map((k) => (
            <tr key={k.id}>
              {showBody ? <td><Link className="link" href={`/bodies/${k.bodyId}`}>{bodyNames?.get(k.bodyId)}</Link></td> : null}
              <td>{k.name}{k.source === "tracker" ? <span className="ml-1 text-xs text-gray-400">auto</span> : null}</td>
              <td className="text-right">{fmt(k.target, k.unit)}</td>
              <td className="text-right font-semibold">{fmt(k.actual, k.unit)}</td>
              <td><div className="flex items-center gap-2"><Progress value={k.achievement} /><span className="w-10 text-right text-xs font-semibold">{k.achievement}%</span></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
