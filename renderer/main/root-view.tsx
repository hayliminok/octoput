import { Outlet, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SplitView, Status } from "@ui";
import { AppSidebar } from "./app-sidebar";
import { ConnectView } from "./connect-view";
import { PaneEmptyState } from "./pane-empty-state";
import { useTheme, useConnection, useEnvironment } from "@ui";
import { isDevelopmentFlavor } from "@ui";
import { KeyboardNavProvider } from "./keyboard-nav";

interface AuthStatus {
  putio: boolean;
}

export function RootView() {
  useTheme();
  const navigate = useNavigate();

  // The "Settings…" app menu item (Cmd+,) navigates to the settings pane.
  React.useEffect(() => {
    return window.glazeAPI.glaze.ipc.onNotification("app:navigate", () => {
      navigate({ to: "/settings" });
    });
  }, [navigate]);

  // IPC connection and environment
  const connectionQuery = useConnection();
  const environmentQuery = useEnvironment();

  // Gate the app behind a put.io sign-in.
  const authQuery = useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => window.glazeAPI.glaze.ipc.invoke<AuthStatus>("auth:status"),
  });
  const connected = authQuery.data?.putio === true;

  // Re-check auth when the backend signals a change (e.g. logout from Settings).
  const queryClient = useQueryClient();
  React.useEffect(() => {
    return window.glazeAPI.glaze.ipc.onNotification("auth:changed", () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "status"] });
    });
  }, [queryClient]);

  // Cleanup IPC connection on unmount
  React.useEffect(() => {
    return () => {
      console.log("[RootView] cleanup - disconnecting IPC client");
      window.glazeAPI.glaze.ipc.disconnect();
    };
  }, []);

  return (
    <KeyboardNavProvider>
    <div className="h-full relative [&:not(:has([data-toolbar]))_.drag-region]:z-50">
      {/* Draggable top bar - fallback for when no toolbar is present */}
      <div className="drag-region fixed top-0 left-0 right-0 h-13" />
      {authQuery.isPending ? (
        <PaneEmptyState description="Checking your put.io connection…" />
      ) : connected ? (
        <SplitView
          className="h-full"
          storageKey="app-shell"
          sidebar={<AppSidebar />}
          sidebarSize={{ default: 200, min: 170, max: 240 }}
        >
          <Outlet />
        </SplitView>
      ) : (
        <ConnectView />
      )}

      <div className="flex flex-col items-end gap-1 mt-2 fixed bottom-12 right-2">
        {isDevelopmentFlavor() ? (
          <>
            {connectionQuery.error ? <Status variant="error">Backend disconnected</Status> : null}
            {environmentQuery.data ? null : <Status variant="error">Dev Server not found</Status>}
          </>
        ) : null}
      </div>
    </div>
    </KeyboardNavProvider>
  );
}
