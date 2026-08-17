import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { LoginPage } from '../features/auth/LoginPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { PlatformOrganizationsPage } from '../features/platform/PlatformOrganizationsPage';
import { PlatformPacksPage } from '../features/industry-packs/PlatformPacksPage';
import { DataQualityPage } from '../features/data/DataQualityPage';
import { MetricDetailPage } from '../features/metrics/MetricDetailPage';
import { MetricsPage } from '../features/metrics/MetricsPage';
import { DataSourcesPage } from '../features/data/DataSourcesPage';
import { ImportDetailPage } from '../features/data/ImportDetailPage';
import { ImportWizardPage } from '../features/data/ImportWizardPage';
import { ImportsPage } from '../features/data/ImportsPage';
import { BranchesPage } from '../features/settings/BranchesPage';
import { DepartmentsPage } from '../features/settings/DepartmentsPage';
import { OrganizationSettingsPage } from '../features/settings/OrganizationSettingsPage';
import { TeamPage } from '../features/settings/TeamPage';
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
                <Route path="/platform/industry-packs" element={<PlatformPacksPage />} />
                <Route path="/metrics" element={<MetricsPage />} />
                <Route path="/metrics/:id" element={<MetricDetailPage />} />
                <Route path="/data" element={<Navigate to="/data/sources" replace />} />
                <Route path="/data/sources" element={<DataSourcesPage />} />
                <Route path="/data/imports" element={<ImportsPage />} />
                <Route path="/data/imports/new" element={<ImportWizardPage />} />
                <Route path="/data/imports/:id" element={<ImportDetailPage />} />
                <Route path="/data/quality" element={<DataQualityPage />} />
                <Route
                  path="/settings"
                  element={<Navigate to="/settings/organization" replace />}
                />
                <Route path="/settings/organization" element={<OrganizationSettingsPage />} />
                <Route path="/settings/branches" element={<BranchesPage />} />
                <Route path="/settings/departments" element={<DepartmentsPage />} />
                <Route path="/settings/team" element={<TeamPage />} />
                <Route path="*" element={<Navigate to="/system" replace />} />
              </Routes>
            </AppShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
