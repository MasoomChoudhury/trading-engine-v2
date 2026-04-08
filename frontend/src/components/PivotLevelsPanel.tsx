import { useQuery } from '@tanstack/react-query';
import { fetcher } from '../lib/api';
import { Target } from 'lucide-react';

interface PivotSet {
  label: string;
  high: number;
  low: number;
  close: number;
  pp: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
  bc: number; tc: number;
  period_open: number;
  period_start: string;
  period_end: string;
}

interface PivotsData {
  timestamp: string;
  spot: number | null;
  weekly: PivotSet | null;
  monthly: PivotSet | null;
  error?: string;
}

function lvlColor(level: number, spot: number | null) {
  if (!spot) return 'text-white/70';
  if (level > spot) return 'text-red-300';
  if (level < spot) return 'text-emerald-300';
  return 'text-yellow-300';
}

function PivotTable({ data, spot }: { data: PivotSet; spot: number | null }) {
  const rows: { key: string; label: string; value: number; bold?: boolean }[] = [
    { key: 'r3',  label: 'R3',     value: data.r3 },
    { key: 'r2',  label: 'R2',     value: data.r2 },
    { key: 'r1',  label: 'R1',     value: data.r1 },
    { key: 'tc',  label: 'TC (CPR top)', value: data.tc },
    { key: 'pp',  label: 'PP',     value: data.pp, bold: true },
    { key: 'bc',  label: 'BC (CPR btm)', value: data.bc },
    { key: 's1',  label: 'S1',     value: data.s1 },
    { key: 's2',  label: 'S2',     value: data.s2 },
    { key: 's3',  label: 'S3',     value: data.s3 },
  ];

  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-white/30 mb-1.5">
        {data.period_start} → {data.period_end} · H:{data.high.toLocaleString('en-IN')} L:{data.low.toLocaleString('en-IN')} C:{data.close.toLocaleString('en-IN')}
      </div>
      {rows.map(({ key, label, value, bold }) => {
        const isAboveSpot = spot ? value > spot : false;
        return (
          <div
            key={key}
            className={`flex justify-between items-center py-0.5 px-2 rounded text-xs
              ${bold ? 'bg-white/8 font-semibold' : ''}
              ${key === 'pp' ? 'border border-white/10' : ''}`}
          >
            <span className="text-white/50 w-24">{label}</span>
            <span className={`font-mono ${lvlColor(value, spot)}`}>
              {value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            {spot && (
              <span className="text-[10px] text-white/25 w-12 text-right">
                {isAboveSpot
                  ? `+${(value - spot).toFixed(0)}`
                  : `${(value - spot).toFixed(0)}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function PivotLevelsPanel() {
  const { data, isLoading, isError } = useQuery<PivotsData>({
    queryKey: ['pivots'],
    queryFn: () => fetcher('/v1/nifty50/pivots'),
    refetchInterval: 60 * 60 * 1000, // once per hour — pivots don't change intraday
    retry: 1,
    staleTime: 30 * 60 * 1000,
  });

  return (
    <div className="bg-[#0d1117] border border-white/10 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Weekly & Monthly Pivots</h3>
        {data?.spot && (
          <span className="text-xs text-white/30 ml-auto">
            Spot: {data.spot.toLocaleString('en-IN')}
          </span>
        )}
      </div>

      {isLoading && <div className="text-xs text-white/30 text-center py-6">Loading pivot levels…</div>}
      {isError && <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">Failed to load pivot levels</div>}

      {data && !data.error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.weekly ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-300 border-b border-white/5 pb-1">
                Weekly Pivots
              </div>
              <PivotTable data={data.weekly} spot={data.spot ?? null} />
            </div>
          ) : (
            <div className="text-xs text-white/30 text-center py-4">Weekly data unavailable</div>
          )}
          {data.monthly ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-blue-300 border-b border-white/5 pb-1">
                Monthly Pivots
              </div>
              <PivotTable data={data.monthly} spot={data.spot ?? null} />
            </div>
          ) : (
            <div className="text-xs text-white/30 text-center py-4">Monthly data unavailable</div>
          )}
        </div>
      )}

      {data?.error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">{data.error}</div>
      )}

      <div className="text-[10px] text-white/20 border-t border-white/5 pt-2">
        PP = (H+L+C)/3 · R/S = standard floor pivot · CPR = Central Pivot Range (BC–TC) · Distance from spot shown on right
      </div>
    </div>
  );
}
