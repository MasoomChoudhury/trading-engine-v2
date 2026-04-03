import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMacroCalendar, MacroEvent, getFIIFlows, refreshFIIDerivatives } from '../lib/api';
import { useFIIDerivatives } from '../hooks/useIndicators';
import PreMarketBiasPanel from '../components/PreMarketBiasPanel';
import { AlertTriangle, Calendar, TrendingUp, DollarSign, BarChart2, Star, Clock, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: ReactNode }> = {
  rbi_mpc: {
    label: 'RBI MPC',
    color: 'text-violet-300',
    bg: 'bg-violet-900/30',
    border: 'border-violet-700/50',
    icon: <Star size={13} />,
  },
  fomc: {
    label: 'US FOMC',
    color: 'text-blue-300',
    bg: 'bg-blue-900/30',
    border: 'border-blue-700/50',
    icon: <DollarSign size={13} />,
  },
  us_cpi: {
    label: 'US CPI',
    color: 'text-cyan-300',
    bg: 'bg-cyan-900/30',
    border: 'border-cyan-700/50',
    icon: <TrendingUp size={13} />,
  },
  earnings: {
    label: 'Earnings',
    color: 'text-amber-300',
    bg: 'bg-amber-900/30',
    border: 'border-amber-700/50',
    icon: <BarChart2 size={13} />,
  },
  custom: {
    label: 'Custom',
    color: 'text-slate-300',
    bg: 'bg-slate-800/50',
    border: 'border-slate-600/50',
    icon: <Calendar size={13} />,
  },
};

function getTypeCfg(type: string) {
  return TYPE_CONFIG[type] ?? TYPE_CONFIG.custom;
}

// ── Countdown badge ───────────────────────────────────────────────────────────

function DaysChip({ days, isToday, isPast }: { days: number; isToday: boolean; isPast: boolean }) {
  if (isToday) return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse">
      TODAY
    </span>
  );
  if (isPast) return (
    <span className="px-2 py-0.5 rounded-full text-xs text-slate-500 bg-slate-800">
      {Math.abs(days)}d ago
    </span>
  );
  if (days <= 3) return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/40">
      {days}d
    </span>
  );
  if (days <= 7) return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/15 text-yellow-300 border border-yellow-600/30">
      {days}d
    </span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full text-xs text-slate-400 bg-slate-800/60">
      {days}d
    </span>
  );
}

// ── Single event row ──────────────────────────────────────────────────────────

function EventRow({ ev, dimmed }: { ev: MacroEvent; dimmed?: boolean }) {
  const cfg = getTypeCfg(ev.event_type);
  const dt = new Date(ev.event_date + 'T00:00:00');
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-opacity ${cfg.bg} ${cfg.border} ${dimmed ? 'opacity-45' : ''}`}>
      <div className="mt-0.5 flex-shrink-0">
        <span className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
          {cfg.icon}
          <span className="hidden sm:inline">{cfg.label}</span>
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-semibold ${dimmed ? 'text-slate-400' : 'text-slate-100'}`}>
            {ev.title}
          </p>
          {ev.is_approximate && (
            <span className="text-xs text-slate-500 italic">~approx</span>
          )}
        </div>
        {ev.description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{ev.description}</p>
        )}
        <p className="text-xs text-slate-500 mt-1">{dateStr}</p>
      </div>
      <div className="flex-shrink-0">
        <DaysChip days={ev.days_to_event} isToday={ev.is_today} isPast={ev.is_past} />
      </div>
    </div>
  );
}

// ── Grouped event list ────────────────────────────────────────────────────────

function groupByDate(events: MacroEvent[]): { date: string; events: MacroEvent[] }[] {
  const map = new Map<string, MacroEvent[]>();
  for (const ev of events) {
    if (!map.has(ev.event_date)) map.set(ev.event_date, []);
    map.get(ev.event_date)!.push(ev);
  }
  return Array.from(map.entries()).map(([date, evs]) => ({ date, events: evs }));
}

// ── Next event banner ─────────────────────────────────────────────────────────

function NextEventBanner({ ev }: { ev: MacroEvent }) {
  const cfg = getTypeCfg(ev.event_type);
  return (
    <div className={`rounded-xl p-4 border ${cfg.bg} ${cfg.border} flex items-center gap-4`}>
      <div className={`p-2 rounded-lg ${cfg.bg} border ${cfg.border}`}>
        <Clock size={20} className={cfg.color} />
      </div>
      <div className="flex-1">
        <p className="text-xs text-slate-400 mb-0.5">Next macro event</p>
        <p className="font-semibold text-slate-100">{ev.title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{ev.description}</p>
      </div>
      <div className="text-right">
        <p className={`text-3xl font-bold tabular-nums ${ev.days_to_event <= 3 ? 'text-orange-400' : cfg.color}`}>
          {ev.days_to_event}
        </p>
        <p className="text-xs text-slate-400">days away</p>
      </div>
    </div>
  );
}

// ── Type legend ───────────────────────────────────────────────────────────────

function TypeLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(TYPE_CONFIG).filter(([k]) => k !== 'custom').map(([key, cfg]) => (
        <span key={key} className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
          {cfg.icon}{cfg.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-slate-500 bg-slate-800 border border-slate-700">
        ~approx = estimated date
      </span>
    </div>
  );
}

// ── Panel 6: FII/DII Flows ────────────────────────────────────────────────────

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function FIIFlowsPanel() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fii-flows'],
    queryFn: () => getFIIFlows(30),
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) return <div className="panel-card animate-pulse h-64 flex items-center justify-center text-slate-500 text-sm">Loading FII/DII flows…</div>;

  if (error || !data || !data.series.length) {
    return (
      <div className="panel-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">FII / DII Equity Flows</h3>
          <button onClick={() => getFIIFlows(30, true).then(() => refetch())} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
            <RefreshCw size={12} /> Refresh from NSE
          </button>
        </div>
        <div className="text-slate-500 text-sm text-center py-8">
          No FII/DII data yet. Click "Refresh from NSE" to fetch latest data.
        </div>
      </div>
    );
  }

  const { series, latest_fii_net, latest_dii_net, fii_5d_net, dii_5d_net, fii_trend, dii_trend, unit } = data;

  const fmtCr = (v: number | null | undefined) => {
    if (v == null) return '—';
    const abs = Math.abs(v);
    const sign = v >= 0 ? '+' : '-';
    return `${sign}₹${abs.toFixed(0)} (×100Cr)`;
  };

  const chartData = series.map(s => ({
    date: new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    FII: s.fii_net,
    DII: s.dii_net,
    Combined: s.combined_net,
  }));

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">FII / DII Equity Flows</h3>
          <p className="text-xs text-slate-500 mt-0.5">NSE daily equity flows · {unit}</p>
        </div>
        <button
          onClick={() => { getFIIFlows(30, true).then(() => refetch()); }}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">FII Latest</div>
          <div className={`text-sm font-bold ${(latest_fii_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {latest_fii_net != null ? `${latest_fii_net >= 0 ? '+' : ''}${latest_fii_net?.toFixed(0)}` : '—'}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">DII Latest</div>
          <div className={`text-sm font-bold ${(latest_dii_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {latest_dii_net != null ? `${latest_dii_net >= 0 ? '+' : ''}${latest_dii_net?.toFixed(0)}` : '—'}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">FII 5d Net</div>
          <div className={`text-sm font-bold ${(fii_5d_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fii_5d_net != null ? `${fii_5d_net >= 0 ? '+' : ''}${fii_5d_net?.toFixed(0)}` : '—'}
            <span className={`ml-1 text-xs ${fii_trend === 'buying' ? 'text-emerald-500' : 'text-red-500'}`}>
              ({fii_trend})
            </span>
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">DII 5d Net</div>
          <div className={`text-sm font-bold ${(dii_5d_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {dii_5d_net != null ? `${dii_5d_net >= 0 ? '+' : ''}${dii_5d_net?.toFixed(0)}` : '—'}
            <span className={`ml-1 text-xs ${dii_trend === 'buying' ? 'text-emerald-500' : 'text-red-500'}`}>
              ({dii_trend})
            </span>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="FII" fill="#3b82f6" opacity={0.8} name="FII Net" />
          <Bar dataKey="DII" fill="#f59e0b" opacity={0.8} name="DII Net" />
          <Line type="monotone" dataKey="Combined" stroke="#a78bfa" dot={false} strokeWidth={1.5} name="Combined" />
        </ComposedChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-600 mt-2">
        FII buying + DII buying = broad institutional support. FII selling offset by DII = domestic resilience.
      </p>
    </div>
  );
}

// ── Panel 7: FII Derivatives ──────────────────────────────────────────────────

function FIIDerivativesPanel() {
  const { data, isLoading, error: derivError, refetch } = useFIIDerivatives(20);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshFIIDerivatives();
      await refetch();
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  const netPositionColor = data?.net_position === 'net_long' ? 'text-emerald-400 bg-emerald-900/30 border-emerald-700/50'
    : data?.net_position === 'net_short' ? 'text-red-400 bg-red-900/30 border-red-700/50'
    : 'text-slate-400 bg-slate-800/50 border-slate-700/50';

  const fmtK = (v: number | null | undefined) => {
    if (v == null) return '—';
    const abs = Math.abs(v);
    const sign = v >= 0 ? '+' : '-';
    if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
    return `${sign}${v.toFixed(0)}`;
  };

  if (isLoading) return (
    <div className="panel-card animate-pulse h-64 flex items-center justify-center text-slate-500 text-sm">
      Loading FII derivatives…
    </div>
  );

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">FII / FPI Index Futures Positioning</h3>
          <p className="text-xs text-slate-500 mt-0.5">NSE participant-wise OI · {data?.latest_date ?? 'No date'}</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.net_position && data.net_position !== 'unknown' && (
            <span className={`text-xs font-bold px-2 py-1 rounded-full border ${netPositionColor}`}>
              {data.net_position === 'net_long' ? 'NET LONG' : 'NET SHORT'}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Fetching…' : 'Refresh'}
          </button>
        </div>
      </div>

      {derivError ? (
        <div className="text-center py-8">
          <p className="text-red-400 text-sm mb-1">Failed to fetch FII derivative data.</p>
          <p className="text-slate-500 text-xs">{(derivError as Error).message}</p>
        </div>
      ) : (!data || !data.series.length) ? (
        <div className="text-center py-8">
          <p className="text-slate-400 text-sm mb-2">No FII derivative data available.</p>
          <p className="text-slate-500 text-xs">
            NSE publishes participant OI after market close daily. Click Refresh to fetch.
          </p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Index Fut Long', value: fmtK(data.latest?.future_index_long), color: 'text-emerald-400' },
              { label: 'Index Fut Short', value: fmtK(data.latest?.future_index_short), color: 'text-red-400' },
              { label: 'Index Fut Net', value: fmtK(data.index_fut_net), color: (data.index_fut_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Options Net', value: fmtK(data.total_options_net), color: (data.total_options_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-800/60 rounded p-2 text-center">
                <div className="text-xs text-slate-400">{label}</div>
                <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Bar chart of index fut net over time */}
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1 h-32 min-w-0">
              {data.series.map((row) => {
                const val = row.future_index_net;
                const maxAbs = Math.max(...data.series.map(r => Math.abs(r.future_index_net)), 1);
                const heightPct = Math.min(100, (Math.abs(val) / maxAbs) * 90 + 5);
                const isPos = val >= 0;
                const dateLabel = new Date(row.trade_date + 'T00:00:00').toLocaleDateString('en-IN', {
                  day: '2-digit', month: 'short',
                });
                return (
                  <div
                    key={row.trade_date}
                    className="flex-1 flex flex-col items-center justify-end gap-0.5 min-w-[20px] group cursor-default"
                    title={`${dateLabel}: ${val >= 0 ? '+' : ''}${val.toFixed(0)} lots`}
                  >
                    <div
                      className={`w-full rounded-sm transition-all ${isPos ? 'bg-emerald-500/70 group-hover:bg-emerald-400' : 'bg-red-500/70 group-hover:bg-red-400'}`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-slate-600 text-[9px] rotate-90 origin-left whitespace-nowrap translate-x-1 translate-y-1 hidden sm:block">
                      {dateLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-slate-600 mt-3">{data.note}</p>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Macro() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['macro-calendar'],
    queryFn: () => getMacroCalendar(14, 120),
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto page-enter space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-7 bg-slate-800 rounded w-48" />
          <div className="h-24 bg-slate-800 rounded-xl" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-800 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-4xl mx-auto page-enter">
        <div className="flex items-center gap-3 bg-red-900/20 border border-red-800/40 rounded-xl p-4">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <span className="text-red-400 flex-1">Failed to load macro calendar. {(error as Error)?.message}</span>
          <button onClick={() => refetch()} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const upcomingGroups = groupByDate(data.upcoming);
  const pastGroups = groupByDate([...data.past].reverse()).slice(0, 5); // last 5 past dates

  return (
    <div className="p-6 max-w-4xl mx-auto page-enter space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Macro Calendar</h1>
          <p className="text-sm text-slate-400 mt-1">
            RBI MPC · US FOMC · US CPI · Quarterly earnings — event risk at a glance
          </p>
        </div>
        <TypeLegend />
      </div>

      {/* Pre-market bias panel */}
      <PreMarketBiasPanel />

      {/* Next event banner */}
      {data.next_event && <NextEventBanner ev={data.next_event} />}

      {/* Today */}
      {data.today.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-red-400 uppercase tracking-widest mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse inline-block" />
            Today
          </h2>
          <div className="space-y-2">
            {data.today.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>
        </section>
      )}

      {/* Upcoming */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">
          Upcoming ({data.upcoming.length})
        </h2>
        <div className="space-y-4">
          {upcomingGroups.map(({ date, events }) => {
            const dt = new Date(date + 'T00:00:00');
            const dateLabel = dt.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
            const daysTo = events[0].days_to_event;
            return (
              <div key={date}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-slate-500">{dateLabel}</span>
                  {daysTo <= 7 && (
                    <span className={`text-xs font-semibold ${daysTo <= 3 ? 'text-orange-400' : 'text-yellow-400'}`}>
                      ({daysTo}d)
                    </span>
                  )}
                </div>
                <div className="space-y-2 pl-3 border-l border-slate-700/60">
                  {events.map(ev => <EventRow key={ev.id} ev={ev} />)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Past (recent) */}
      {pastGroups.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-widest mb-3">
            Recent past
          </h2>
          <div className="space-y-4">
            {pastGroups.map(({ date, events }) => {
              const dt = new Date(date + 'T00:00:00');
              const dateLabel = dt.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
              return (
                <div key={date}>
                  <p className="text-xs text-slate-600 mb-1.5">{dateLabel}</p>
                  <div className="space-y-1.5 pl-3 border-l border-slate-800">
                    {events.map(ev => <EventRow key={ev.id} ev={ev} dimmed />)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Panel 6: FII/DII Flows */}
      <FIIFlowsPanel />

      {/* Panel 7: FII Derivatives */}
      <FIIDerivativesPanel />

      <p className="text-xs text-slate-600 text-center pb-4">
        Dates marked ~approx are estimated. Confirm exact dates before trading around events.
      </p>
    </div>
  );
}
