import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getApiLogs, ApiLogEntry } from '../lib/api';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';

function statusColor(status: number | undefined) {
  if (!status) return 'text-slate-400';
  if (status < 300) return 'text-emerald-400';
  if (status < 400) return 'text-yellow-400';
  return 'text-red-400';
}

function methodColor(method: string) {
  const colors: Record<string, string> = {
    GET: 'bg-blue-900/50 text-blue-300',
    POST: 'bg-emerald-900/50 text-emerald-300',
    PUT: 'bg-amber-900/50 text-amber-300',
    DELETE: 'bg-red-900/50 text-red-300',
  };
  return colors[method] || 'bg-slate-700 text-slate-300';
}

export default function APILogTable() {
  const [page, setPage] = useState(1);
  const [endpoint, setEndpoint] = useState('');
  const [method, setMethod] = useState('');
  const [hours, setHours] = useState(24);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['api-logs', page, endpoint, method, hours],
    queryFn: () => getApiLogs({ page, page_size: 50, endpoint: endpoint || undefined, method: method || undefined, hours }),
    refetchInterval: 15000,
  });

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('en-IN', {
        day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
    } catch {
      return ts;
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
          <Search size={14} className="text-slate-400" />
          <input
            type="text"
            placeholder="Filter endpoint..."
            value={endpoint}
            onChange={(e) => { setEndpoint(e.target.value); setPage(1); }}
            className="bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none w-48"
          />
        </div>

        <select
          value={method}
          onChange={(e) => { setMethod(e.target.value); setPage(1); }}
          className="bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none border border-slate-700"
        >
          <option value="">All Methods</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>

        <select
          value={hours}
          onChange={(e) => { setHours(Number(e.target.value)); setPage(1); }}
          className="bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none border border-slate-700"
        >
          <option value={1}>Last 1 hour</option>
          <option value={6}>Last 6 hours</option>
          <option value={24}>Last 24 hours</option>
          <option value={72}>Last 3 days</option>
        </select>

        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>

        {data && (
          <span className="ml-auto text-sm text-slate-400">
            {data.total} entries
          </span>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-slate-400">
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Time</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Method</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Endpoint</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wide">Duration</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {isLoading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-800 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : data?.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No API logs found for the selected filters.
                  </td>
                </tr>
              ) : (
                data?.entries.map((entry: ApiLogEntry) => (
                  <>
                    <tr
                      key={entry.id}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <td className="px-4 py-3 text-slate-300 font-mono text-xs whitespace-nowrap">
                        {formatTime(entry.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${methodColor(entry.method)}`}>
                          {entry.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 font-mono text-xs max-w-xs truncate">
                        {entry.endpoint}
                      </td>
                      <td className={`px-4 py-3 font-mono text-xs font-medium ${statusColor(entry.response_status)}`}>
                        {entry.response_status ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 font-mono text-xs">
                        {entry.duration_ms != null ? `${entry.duration_ms}ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-red-400 text-xs max-w-xs truncate">
                        {entry.error || ''}
                      </td>
                    </tr>
                    {expandedId === entry.id && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 bg-slate-800/50">
                          {entry.request_params && (
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Request Parameters:</p>
                              <pre className="text-xs text-slate-300 bg-slate-950 rounded p-2 overflow-x-auto">
                                {JSON.stringify(entry.request_params, null, 2)}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm text-slate-400 px-4">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={!data || page >= totalPages}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
