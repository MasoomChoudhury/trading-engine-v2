import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ScrollText, TrendingUp, RefreshCw, KeyRound, BarChart3, Layers, Activity } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './pages/Dashboard';
import APILogs from './pages/APILogs';
import Indicators from './pages/Indicators';
import Futures from './pages/Futures';
import Options from './pages/Options';
import Breadth from './pages/Breadth';
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
    { to: '/futures', icon: BarChart3, label: 'Futures Volume' },
    { to: '/options', icon: Layers, label: 'Options OI' },
    { to: '/breadth', icon: Activity, label: 'Breadth' },
    { to: '/logs', icon: ScrollText, label: 'API Logs' },
  ];

  return (
    <nav className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/60 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-1">
        <span className="text-xl font-bold mr-8 tracking-tight bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Nifty50 Analytics</span>
        {navItems.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] ${location.pathname === to
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
              }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleRequestToken}
          disabled={requestingToken}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none shadow-sm shadow-violet-500/20"
        >
          <KeyRound size={14} className={requestingToken ? 'animate-pulse' : ''} />
          {requestingToken ? 'Requesting...' : 'Request Token'}
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none shadow-sm shadow-emerald-500/20"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh Data'}
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
              <Route path="/logs" element={<APILogs />} />
            </Routes>
          </div>
        </BrowserRouter>
      </DashboardProvider>
    </QueryClientProvider>
  );
}
