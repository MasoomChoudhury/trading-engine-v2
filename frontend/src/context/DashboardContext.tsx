import { createContext, useContext, useState, ReactNode } from 'react';

interface DashboardContextValue {
  hideExpiry: boolean;
  setHideExpiry: (v: boolean) => void;
  dateRangeDays: number;
  setDateRangeDays: (v: number) => void;
}

const DashboardContext = createContext<DashboardContextValue>({
  hideExpiry: false,
  setHideExpiry: () => {},
  dateRangeDays: 60,
  setDateRangeDays: () => {},
});

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [hideExpiry, setHideExpiry] = useState(false);
  const [dateRangeDays, setDateRangeDays] = useState(60);
  return (
    <DashboardContext.Provider value={{ hideExpiry, setHideExpiry, dateRangeDays, setDateRangeDays }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DashboardContext);
}
