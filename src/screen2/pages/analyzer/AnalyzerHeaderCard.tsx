import type { AnalyzerAddressFormat } from "../../utils/analyzerAddressFormat";

type Props = {
  loading: boolean;
  onRefresh: () => void;
  trendWindowMinutes: number | null;
  onChangeTrendWindowMinutes: (next: number | null) => void;
  addressFormat: AnalyzerAddressFormat;
  onChangeAddressFormat: (next: AnalyzerAddressFormat) => void;
};

export default function AnalyzerHeaderCard(props: Props) {
  return (
    <div className="flex flex-row items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-inner shadow-black/5 dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-black/30">
      <div>
        <p className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Analyzer</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-slate-600 dark:text-slate-400">Address:</div>
        <select
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 outline-hidden transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
          value={props.addressFormat}
          onChange={(e) => {
            props.onChangeAddressFormat(e.currentTarget.value === "hex" ? "hex" : "dec");
          }}
          title="Analyzer address display format"
        >
          <option value="dec">Dec</option>
          <option value="hex">Hex</option>
        </select>

        <div className="ml-2 text-xs text-slate-600 dark:text-slate-400">Trends to show:</div>
        <select
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 outline-hidden transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
          value={props.trendWindowMinutes == null ? "all" : String(props.trendWindowMinutes)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === "all") {
              props.onChangeTrendWindowMinutes(null);
              return;
            }
            const n = Number(v);
            props.onChangeTrendWindowMinutes(Number.isFinite(n) && n > 0 ? n : 10);
          }}
          title="Trend history window"
        >
          <option value="1">Last 1 min</option>
          <option value="5">Last 5 min</option>
          <option value="10">Last 10 min</option>
          <option value="30">Last 30 min</option>
          <option value="60">Last 60 min</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
  );
}
