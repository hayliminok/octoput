import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { LibraryView } from "./library-view";
import { NewTransferView } from "./new-transfer-view";
import { TransfersView } from "./transfers-view";
import { SettingsView } from "../settings/settings-view";
import { RootView } from "./root-view";
import { QueryClient } from "@tanstack/react-query";
import { ErrorBoundaryView } from "@ui";

const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootView,
  errorComponent: ErrorBoundaryView,
  notFoundComponent: () => {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="drag-region fixed top-0 left-0 right-0 h-13" />
        <p className="text-gray-a11">Route not found</p>
      </div>
    );
  },
});


const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library",
  component: LibraryView,
  validateSearch: (
    search: Record<string, unknown>,
  ): { path: { id: number; name: string }[]; file?: number } => {
    const rawPath = Array.isArray(search.path) ? search.path : [];
    const path = rawPath
      .filter(
        (p): p is { id: number; name: string } =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as { id?: unknown }).id === "number" &&
          typeof (p as { name?: unknown }).name === "string",
      )
      .map((p) => ({ id: p.id, name: p.name }));
    return { path, file: typeof search.file === "number" ? search.file : undefined };
  },
  staticData: {
    title: "Library",
  },
});

const transferRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transfer",
  component: NewTransferView,
  staticData: {
    title: "New transfer",
  },
});

const transfersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transfers",
  component: TransfersView,
  staticData: {
    title: "Transfers",
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsView,
  staticData: {
    title: "Settings",
  },
});

const routeTree = rootRoute.addChildren([
  libraryRoute,
  transferRoute,
  transfersRoute,
  settingsRoute,
]);

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  // Open on the put.io library.
  history: createMemoryHistory({ initialEntries: ["/library"] }),
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    title?: string;
    component?: any;
  }
}

export { router, queryClient };
