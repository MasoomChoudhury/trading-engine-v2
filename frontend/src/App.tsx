import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ScrollText, TrendingUp, RefreshCw } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import APILogs from './pages/APILogs';
import Indicators from './pages/Indicators';
import { useState, useCallback } from 'react';
import { triggerRefresh } from './lib/api';

function NavBar() {
  const location = useLocation();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await triggerRefresh();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/indicators', icon: TrendingUp, label: 'Indicators' },
    { to: '/logs', icon: ScrollText, label: 'API Logs' },
  ];

  return (
    <nav className="bg-slate-900 border-b border-slate-700 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-1">
        <span className="text-xl font-bold text-blue-400 mr-8">Nifty50 Analytics</span>
        {navItems.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              location.pathname === to
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </div>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
      >
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Refreshing...' : 'Refresh Data'}
      </button>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <NavBar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/indicators" element={<Indicators />} />
          <Route path="/logs" element={<APILogs />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
