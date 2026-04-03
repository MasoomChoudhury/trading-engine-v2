import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ScrollText, TrendingUp, RefreshCw, KeyRound, BarChart3, Layers, Activity, CalendarDays, Landmark, TrendingUpDown } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './pages/Dashboard';
import APILogs from './pages/APILogs';
import Indicators from './pages/Indicators';
import Futures from './pages/Futures';
import Options from './pages/Options';
import Breadth from './pages/Breadth';
import Macro from './pages/Macro';
import BankNifty from './pages/BankNifty';
import { DashboardProvider } from './context/DashboardContext';
import { useState, useCallback } from 'react';
import { triggerRefresh, requestToken } from './lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function NavBar() {
  const location = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const [requestingToken, setRequestingToken] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await triggerRefresh();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleRequestToken = useCallback(async () => {
    setRequestingToken(true);
    try {
      await requestToken();
    } finally {
      setRequestingToken(false);
    }
  }, []);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/indicators', icon: TrendingUp, label: 'Indicators' },
    { to: '/futures', icon: BarChart3, label: 'Futures' },
    { to: '/options', icon: Layers, label: 'Options' },
    { to: '/breadth', icon: Activity, label: 'Breadth' },
    { to: '/banknifty', icon: Landmark, label: 'BankNifty' },
    { to: '/macro', icon: CalendarDays, label: 'Macro' },
    { to: '/logs', icon: ScrollText, label: 'Logs' },
  ];

  return (
    <nav className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/60 px-4 py-2 flex items-center gap-4 sticky top-0 z-50">
      {/* Logo */}
      <Link to="/" className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex-shrink-0" title="Nifty50 Analytics">
        <TrendingUpDown size={16} className="text-white" />
      </Link>

      {/* Divider */}
      <div className="w-px h-5 bg-slate-700/80 flex-shrink-0" />

      {/* Nav links */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-[background-color,transform] duration-150 active:scale-[0.97] ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`}
            >
              <Icon size={13} />
              {label}
            </Link>
          );
        })}
      </div>

      {/* Action buttons — icon-only with tooltips */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={handleRequestToken}
          disabled={requestingToken}
          title={requestingToken ? 'Requesting token…' : 'Request Token'}
          className="flex items-center justify-center w-7 h-7 rounded-md bg-violet-600/80 hover:bg-violet-500 text-white transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
        >
          <KeyRound size={13} className={requestingToken ? 'animate-pulse' : ''} />
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title={refreshing ? 'Refreshing…' : 'Refresh Data'}
          className="flex items-center justify-center w-7 h-7 rounded-md bg-emerald-600/80 hover:bg-emerald-500 text-white transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardProvider>
        <BrowserRouter>
          <div className="min-h-screen bg-slate-950 text-slate-100">
            <NavBar />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/indicators" element={<Indicators />} />
              <Route path="/futures" element={<Futures />} />
              <Route path="/options" element={<Options />} />
              <Route path="/breadth" element={<Breadth />} />
              <Route path="/banknifty" element={<BankNifty />} />
              <Route path="/macro" element={<Macro />} />
              <Route path="/logs" element={<APILogs />} />
            </Routes>
          </div>
        </BrowserRouter>
      </DashboardProvider>
    </QueryClientProvider>
  );
}
