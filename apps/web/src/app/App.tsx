import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { LoginPage } from '../features/auth/LoginPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { PlatformOrganizationsPage } from '../features/platform/PlatformOrganizationsPage';
import { SystemStatusPage } from '../features/system/SystemStatusPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppShell>
              <Routes>
                <Route path="/" element={<Navigate to="/system" replace />} />
                <Route path="/system" element={<SystemStatusPage />} />
                <Route path="/platform/organizations" element={<PlatformOrganizationsPage />} />
                <Route path="*" element={<Navigate to="/system" replace />} />
              </Routes>
            </AppShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
