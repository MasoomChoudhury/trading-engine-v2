import { useQuery } from '@tanstack/react-query';
import { fetcher } from '../lib/api';
import { Database } from 'lucide-react';

interface IVContext {
  timestamp: string;
  query_dte: number;
  query_vix: number;
  current_atm_iv: number | null;
  session_count: number;
  sample_count: number;
  sufficient_history: boolean;
  progress_note: string | null;
  iv_avg: number | null;
  iv_med: number | null;
  iv_min: number | null;
  iv_max: number | null;
  iv_pct: number | null;
  verdict: 'cheap' | 'fair' | 'expensive' | null;
  verdict_note: string | null;
  dte_window: number;
  vix_window: number;
  error?: string;
}

interface Props {
  dte: number;
  vix: number;
  atmIv: number | null;
}

export default function StraddleIVContextPanel({ dte, vix, atmIv }: Props) {
  const enabled = dte > 0 && vix > 0;

  const { data, isLoading, isError } = useQuery<IVContext>({
    queryKey: ['straddle-iv-context', dte, Math.round(vix * 2) / 2, atmIv],
    queryFn: () =>
      fetcher(
        `/v1/options/straddle-iv-context?dte=${dte}&vix=${vix.toFixed(1)}${
          atmIv ? `&atm_iv=${atmIv}` : ''
        }`
      ),
    enabled,
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
  });

  const verdictStyle = {
    cheap:    'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    fair:     'border-white/15 bg-white/5 text-white/70',
    expensive:'border-red-500/40 bg-red-500/10 text-red-300',
  };

  return (
    <div className="bg-[#0d1117] border border-white/10 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Historical IV Context</h3>
        <span className="text-[10px] text-white/30 ml-auto">
          DTE≈{dte} / VIX≈{vix.toFixed(1)}
        </span>
      </div>

      {!enabled && (
        <div className="text-xs text-white/30 text-center py-4">
          Waiting for DTE and VIX data…
        </div>
      )}
      {isLoading && <div className="text-xs text-white/30 text-center py-4">Querying history…</div>}
      {isError && <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">Query failed</div>}

      {data && !data.error && (
        <>
          {/* Progress bar when insufficient history */}
          {!data.sufficient_history && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-white/50">{data.progress_note}</div>
              <div className="w-full bg-white/5 rounded-full h-1.5">
                <div
                  className="bg-cyan-500/60 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min((data.session_count / 30) * 100, 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-white/25">
                {data.session_count} / 30 sessions (DTE {data.query_dte}±{data.dte_window}, VIX {data.query_vix.toFixed(1)}±{data.vix_window})
              </div>
            </div>
          )}

          {/* Stats grid — shown even with partial history */}
          {data.iv_avg !== null && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/5 rounded p-2.5 space-y-0.5">
                <div className="text-[10px] text-white/40 uppercase tracking-wide">Hist. Avg IV</div>
                <div className="text-sm font-bold text-white">{data.iv_avg.toFixed(1)}%</div>
              </div>
              <div className="bg-white/5 rounded p-2.5 space-y-0.5">
                <div className="text-[10px] text-white/40 uppercase tracking-wide">Hist. Median IV</div>
                <div className="text-sm font-bold text-white">{data.iv_med?.toFixed(1) ?? '—'}%</div>
              </div>
              <div className="bg-white/5 rounded p-2.5 space-y-0.5">
                <div className="text-[10px] text-white/40 uppercase tracking-wide">Hist. Range</div>
                <div className="text-xs font-mono text-white/60">
                  {data.iv_min?.toFixed(1)}% – {data.iv_max?.toFixed(1)}%
                </div>
              </div>
              {data.iv_pct !== null && (
                <div className="bg-white/5 rounded p-2.5 space-y-0.5">
                  <div className="text-[10px] text-white/40 uppercase tracking-wide">Curr. IV Pct</div>
                  <div className={`text-sm font-bold ${
                    data.iv_pct >= 75 ? 'text-red-400' :
                    data.iv_pct <= 25 ? 'text-emerald-400' : 'text-white'
                  }`}>
                    {data.iv_pct.toFixed(0)}th %ile
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Verdict */}
          {data.verdict_note && (
            <div className={`text-xs rounded px-3 py-2 border ${verdictStyle[data.verdict!] ?? verdictStyle.fair}`}>
              {data.verdict_note}
            </div>
          )}

          {data.sufficient_history && (
            <div className="text-[10px] text-white/25">
              Based on {data.session_count} sessions with DTE {data.query_dte}±{data.dte_window} and VIX {data.query_vix.toFixed(1)}±{data.vix_window}
            </div>
          )}
        </>
      )}

      {data?.error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">{data.error}</div>
      )}
    </div>
  );
}
