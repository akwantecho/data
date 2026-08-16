import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { SystemStatusPage } from '../features/system/SystemStatusPage';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/system" replace />} />
        <Route path="/system" element={<SystemStatusPage />} />
        <Route path="*" element={<Navigate to="/system" replace />} />
      </Routes>
    </AppShell>
  );
}
