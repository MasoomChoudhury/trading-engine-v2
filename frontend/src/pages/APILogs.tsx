import APILogTable from '../components/APILogTable';

export default function APILogs() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">API Logs</h1>
        <p className="text-slate-400 text-sm mt-1">
          Every Upstox API call made by the backend — endpoint, method, status, duration, and errors.
        </p>
      </div>
      <APILogTable />
    </div>
  );
}
