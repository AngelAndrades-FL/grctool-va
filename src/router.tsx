import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell';
import { FamilyView } from '@/routes/FamilyView';
import { ControlDetail } from '@/routes/ControlDetail';
import { Settings } from '@/routes/Settings';
import { GapReport } from '@/routes/GapReport';
import { Export } from '@/routes/Export';
import { Dashboard } from '@/routes/Dashboard';

const rootRoute = createRootRoute({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' });
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: Dashboard,
});

const familyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/family/$familyId',
  component: FamilyView,
});

const controlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/control/$controlId',
  component: ControlDetail,
});

const gapsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gaps',
  component: GapReport,
});

const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/export',
  component: Export,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
});

// Catches any unmatched path and sends it back to the dashboard.
const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  familyRoute,
  controlRoute,
  gapsRoute,
  exportRoute,
  settingsRoute,
  catchAllRoute,
]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
