import { useState, useMemo } from 'react';
import { usePnLSimulator } from '../hooks/useIndicators';
import { PnLSimulator, PnLScenarioRow } from '../lib/api';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';

// ── Cell colour ─────────────────────────────────────────────────────────────
function cellBg(pnl: number, isBreakEvenBoundary: boolean): string {
  const base =
    pnl >= 5000  ? 'bg-emerald-700/80 text-emerald-100' :
    pnl >= 2000  ? 'bg-emerald-800/70 text-emerald-200' :
    pnl >= 500   ? 'bg-emerald-900/60 text-emerald-300' :
    pnl >= 0     ? 'bg-emerald-950/50 text-emerald-400' :
    pnl >= -500  ? 'bg-red-950/50 text-red-400'         :
    pnl >= -2000 ? 'bg-red-900/60 text-red-300'         :
    pnl >= -5000 ? 'bg-red-800/70 text-red-200'         :
                   'bg-red-700/80 text-red-100';
  return isBreakEvenBoundary
    ? `${base} ring-2 ring-white/70 z-10 relative font-bold`
    : base;
}

function fmtPnl(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 1000).toFixed(0)}K`;
  if (abs >= 1000)  return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(0);
}

// ── Break-even detection ────────────────────────────────────────────────────
function breakEvenBoundaries(cells: number[]): Set<number> {
  const be = new Set<number>();
  for (let i = 1; i < cells.length; i++) {
    if ((cells[i - 1] < 0 && cells[i] >= 0) || (cells[i - 1] >= 0 && cells[i] < 0)) {
      be.add(i - 1);
      be.add(i);
    }
  }
  return be;
}

// ── Scenario grid ───────────────────────────────────────────────────────────
function ScenarioGrid({
  rows,
  spotSteps,
}: {
  rows: PnLScenarioRow[];
  spotSteps: number[];
}) {
  // Find the flat-IV row for break-even annotation
  const flatRow = rows.find(r => r.iv_change === 0);
  const beSpotIdx = flatRow
    ? flatRow.cells.findIndex((v, i) => i > 0 && flatRow.cells[i - 1] < 0 && v >= 0)
    : -1;
  const beSpotMove = beSpotIdx !== -1 ? spotSteps[beSpotIdx] : null;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 text-slate-400 font-medium bg-slate-900/60 sticky left-0 z-10 min-w-[52px]">
                IV Δ \ Spot Δ
              </th>
              {spotSteps.map(ds => (
                <th
                  key={ds}
                  className={`px-1.5 py-1.5 text-center font-medium text-[11px] ${
                    ds === 0 ? 'text-white bg-slate-700/60' :
                    ds > 0   ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {ds >= 0 ? `+${ds}` : ds}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const beCells = breakEvenBoundaries(row.cells);
              return (
                <tr
                  key={row.iv_change}
                  className={row.iv_change === 0 ? 'outline outline-1 outline-slate-500' : ''}
                >
                  <td className={`px-2 py-1 font-medium sticky left-0 z-10 bg-slate-900 text-xs ${
                    row.iv_change === 0 ? 'text-white' :
                    row.iv_change > 0   ? 'text-amber-400' : 'text-blue-400'
                  }`}>
                    {row.iv_change >= 0 ? `+${row.iv_change}` : row.iv_change}
                  </td>
                  {row.cells.map((pnl, ci) => (
                    <td
                      key={ci}
                      className={`px-1 py-1 text-center tabular-nums rounded-sm text-[11px] ${cellBg(pnl, beCells.has(ci))}`}
                    >
                      {fmtPnl(pnl)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Break-even annotation on flat-IV row */}
      {beSpotMove !== null && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-slate-400">Break-even (IV flat):</span>
          <span className="font-bold text-white bg-slate-700 px-2 py-0.5 rounded">
            {beSpotMove >= 0 ? `+${beSpotMove}` : beSpotMove} pts
          </span>
          <span className="text-slate-500">
            → spot {beSpotMove >= 0 ? '≥' : '≤'} highlighted cells
          </span>
        </div>
      )}
    </div>
  );
}

// ── Time slice config ───────────────────────────────────────────────────────
const TIME_TABS: { label: string; key: string }[] = [
  { label: 'Today',    key: 'days_0'  },
  { label: '+1d',      key: 'days_1'  },
  { label: '+2d',      key: 'days_2'  },
  { label: '+3d',      key: 'days_3'  },
  { label: 'At expiry', key: 'expiry' },
];

// ── Main panel ──────────────────────────────────────────────────────────────
export default function PnLSimulatorPanel() {
  const [expanded, setExpanded] = useState(true);

  // ── Inputs ────────────────────────────────────────────────────────────────
  const [strike, setStrike]           = useState('');
  const [optionType, setOptionType]   = useState<'call' | 'put'>('call');
  const [entryPrice, setEntryPrice]   = useState('');
  const [quantity, setQuantity]       = useState('1');
  const [spreadMode, setSpreadMode]   = useState(false);
  const [spreadStrike, setSpreadStrike] = useState('');

  // ── View state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]     = useState('days_0');

  // ── Submitted params (triggers API call) ─────────────────────────────────
  const [submitted, setSubmitted] = useState<{
    strike: number;
    option_type: string;
    entry_price?: number;
    quantity: number;
    spread_strike?: number;
  } | null>(null);

  const { data, isLoading } = usePnLSimulator(submitted);

  const handleRun = () => {
    const s = parseFloat(strike);
    if (!s || s <= 0) return;
    setSubmitted({
      strike: s,
      option_type: optionType,
      entry_price: entryPrice ? parseFloat(entryPrice) : undefined,
      quantity: parseInt(quantity) || 1,
      spread_strike: spreadMode && spreadStrike ? parseFloat(spreadStrike) : undefined,
    });
  };

  // Active grid rows from selected time tab
  const activeRows: PnLScenarioRow[] | null = useMemo(() => {
    if (!data || data.error) return null;
    return (data.scenarios[activeTab] as PnLScenarioRow[]) ?? null;
  }, [data, activeTab]);

  return (
    <div className="panel-card">
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer select-none mb-4"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <Calculator size={14} className="text-violet-400" />
          <span className="text-sm font-semibold text-slate-200">P&amp;L Scenario Simulator</span>
        </div>
        {expanded
          ? <ChevronUp size={14} className="text-slate-400" />
          : <ChevronDown size={14} className="text-slate-400" />}
      </div>

      {expanded && (
        <>
          {/* ── Mode toggle ─────────────────────────────────────────────────── */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700 mb-4 text-xs">
            <button
              onClick={() => setSpreadMode(false)}
              className={`flex-1 py-1.5 font-medium transition-colors ${
                !spreadMode ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Single Leg
            </button>
            <button
              onClick={() => setSpreadMode(true)}
              className={`flex-1 py-1.5 font-medium transition-colors ${
                spreadMode ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Debit Spread
            </button>
          </div>

          {/* ── Inputs ──────────────────────────────────────────────────────── */}
          <div className={`grid gap-3 mb-3 ${spreadMode ? 'grid-cols-2' : 'grid-cols-2'}`}>
            {/* Long strike */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                {spreadMode ? 'Long Strike' : 'Strike'}
              </label>
              <input
                type="number"
                value={strike}
                onChange={e => setStrike(e.target.value)}
                placeholder="e.g. 22700"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            {/* Call/Put toggle */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Type</label>
              <div className="flex rounded overflow-hidden border border-slate-600">
                <button
                  onClick={() => setOptionType('call')}
                  className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                    optionType === 'call' ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >Call</button>
                <button
                  onClick={() => setOptionType('put')}
                  className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                    optionType === 'put' ? 'bg-red-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >Put</button>
              </div>
            </div>

            {/* Short strike — spread mode only */}
            {spreadMode && (
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Short Strike</label>
                <input
                  type="number"
                  value={spreadStrike}
                  onChange={e => setSpreadStrike(e.target.value)}
                  placeholder={optionType === 'call' ? 'e.g. 23000' : 'e.g. 22400'}
                  className="w-full bg-slate-800 border border-orange-700/60 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            )}

            {/* Entry price */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Entry Price (opt.)</label>
              <input
                type="number"
                value={entryPrice}
                onChange={e => setEntryPrice(e.target.value)}
                placeholder="Defaults to LTP"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            {/* Lots */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Lots</label>
              <input
                type="number"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                min={1}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={!strike || (spreadMode && !spreadStrike) || isLoading}
            className="w-full py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold text-sm transition-colors mb-4"
          >
            {isLoading ? 'Computing…' : 'Run Scenarios'}
          </button>

          {/* ── Results ─────────────────────────────────────────────────────── */}
          {data && !data.error && (
            <>
              {/* Greeks row */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { label: 'Delta',     value: data.greeks.delta.toFixed(3) },
                  { label: 'Gamma',     value: data.greeks.gamma.toFixed(5) },
                  { label: 'Θ/day',     value: data.greeks.theta.toFixed(2) },
                  { label: 'Vega/1%',   value: data.greeks.vega.toFixed(2)  },
                ].map(g => (
                  <div key={g.label} className="stat-card text-center py-2">
                    <div className="text-xs text-slate-400">{g.label}</div>
                    <div className="text-sm font-bold text-slate-100 tabular-nums">{g.value}</div>
                  </div>
                ))}
              </div>

              {/* Summary stats */}
              {data.spread_mode ? (
                /* Spread mode stats */
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { label: 'Long Entry',  value: `₹${data.entry_price}`,         color: 'text-slate-100' },
                    { label: 'Short Entry', value: `₹${data.spread_entry_price}`,   color: 'text-slate-100' },
                    { label: 'Net Debit',   value: `₹${data.net_debit}`,            color: 'text-amber-300' },
                    { label: 'Max Loss',    value: `₹${Math.abs(data.summary.max_loss_spread ?? 0).toLocaleString('en-IN')}`, color: 'text-red-400' },
                  ].map(s => (
                    <div key={s.label} className="stat-card text-center py-2">
                      <div className="text-xs text-slate-400">{s.label}</div>
                      <div className={`text-sm font-bold ${s.color} tabular-nums`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Single leg stats */
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="stat-card text-center py-2">
                    <div className="text-xs text-slate-400">Entry</div>
                    <div className="text-sm font-bold text-slate-100">₹{data.entry_price}</div>
                  </div>
                  <div className="stat-card text-center py-2">
                    <div className="text-xs text-slate-400">Break-even</div>
                    <div className="text-sm font-bold text-blue-300">
                      {data.summary.breakeven_spot
                        ? `₹${data.summary.breakeven_spot.toLocaleString('en-IN')}`
                        : '—'}
                    </div>
                  </div>
                  <div className="stat-card text-center py-2">
                    <div className="text-xs text-slate-400">Daily Θ</div>
                    <div className="text-sm font-bold text-red-400">
                      ₹{data.summary.daily_theta_pnl.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Time selector ────────────────────────────────────────── */}
              <div className="flex rounded-lg overflow-hidden border border-slate-700 mb-3 text-[11px]">
                {TIME_TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`flex-1 py-1.5 font-medium transition-colors ${
                      activeTab === t.key
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Grid legend */}
              <div className="text-[10px] text-slate-400 mb-2 flex items-center gap-3">
                <span>Rows = IV change · Cols = spot Δ · <span className="text-white font-medium">outlined row</span> = IV flat</span>
                <span className="text-white ring-1 ring-white/70 px-1 rounded text-[9px]">bold border</span>
                <span>= break-even boundary</span>
              </div>

              {/* P&L grid */}
              {activeRows && (
                <ScenarioGrid rows={activeRows} spotSteps={data.spot_steps} />
              )}

              <div className="mt-2 text-[10px] text-slate-500">
                Formula: ΔP ≈ Δ·ΔS + ½Γ·ΔS² + V·ΔIV + θ·t
                {data.spread_mode && ' · Net = Long − Short'}
                {' '}· {data.quantity} lot{data.quantity > 1 ? 's' : ''} × {data.lot_size}
                {activeTab === 'expiry' && ' · Expiry uses intrinsic value (exact)'}
              </div>
            </>
          )}

          {data?.error && (
            <div className="text-sm text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg p-3">
              {data.error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
