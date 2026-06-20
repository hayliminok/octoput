import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sidebar, SidebarList, SidebarListItem } from "@ui";
import { ArrowDownToLine, Download, FolderOpen, Plus, Settings } from "lucide-react";
import putioLogo from "../assets/putio-logo.svg";
import putioLogoDark from "../assets/putio-logo-dark.svg";

interface PutioAuthStatus {
  authenticated: boolean;
  username?: string;
}

interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

// Transfers that count toward the sidebar badge (still working toward completion).
const FINISHED = new Set(["COMPLETED", "SEEDING", "ERROR"]);

export function AppSidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: auth } = useQuery({
    queryKey: ["putio", "authStatus"],
    queryFn: () => window.glazeAPI.glaze.ipc.invoke<PutioAuthStatus>("putio:authStatus"),
  });

  // Poll transfers so the badge stays live app-wide; shared key with the page.
  const { data: transfersData } = useQuery({
    queryKey: ["putio", "transfers"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ transfers: { status: string }[] }>("putio:listTransfers"),
    refetchInterval: 5000,
    enabled: auth?.authenticated === true,
  });
  const activeCount = (transfersData?.transfers ?? []).filter((t) => !FINISHED.has(t.status)).length;

  // Check for a newer release once per session; render a notice if found.
  const { data: update } = useQuery({
    queryKey: ["updates", "check"],
    queryFn: () => window.glazeAPI.glaze.ipc.invoke<UpdateStatus>("updates:check"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const openSettings = () => navigate({ to: "/settings" });

  return (
    <Sidebar>
      <img
        src={putioLogo}
        alt="put.io"
        className="mb-3 ml-1.5 mt-[3px] h-6 w-auto self-start dark:hidden"
      />
      <img
        src={putioLogoDark}
        alt="put.io"
        className="mb-3 ml-1.5 mt-[3px] hidden h-6 w-auto self-start dark:block"
      />

      <div data-nav-pane="sidebar">
        <SidebarList>
          <SidebarListItem
            icon={<Plus className="size-4" />}
            title="New transfer"
            selected={pathname === "/transfer"}
            onClick={() => navigate({ to: "/transfer" })}
          />
          <SidebarListItem
            icon={<FolderOpen className="size-4" />}
            title="Your files"
            selected={pathname.startsWith("/library")}
            onClick={() => navigate({ to: "/library", search: { path: [], file: undefined } })}
          />
          <SidebarListItem
            icon={<ArrowDownToLine className="size-4" />}
            title="Transfers"
            selected={pathname.startsWith("/transfers")}
            onClick={() => navigate({ to: "/transfers" })}
            trailing={
              activeCount > 0 ? (
                <span className="rounded-full bg-blue-9 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                  {activeCount}
                </span>
              ) : undefined
            }
          />
        </SidebarList>
      </div>

      {/* Push the account row to the bottom of the sidebar. */}
      <div className="flex-1" />

      <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-callout text-gray-a11">
          {auth?.username ?? (auth?.authenticated ? "Your account" : "put.io")}
        </span>
        <button
          type="button"
          onClick={openSettings}
          aria-label="Settings"
          title="Settings"
          className="shrink-0 rounded-md p-1.5 text-gray-a10 transition-colors hover:bg-gray-a3 hover:text-gray-a12"
        >
          <Settings className="size-4" />
        </button>
      </div>

      {update?.updateAvailable && update.releaseUrl ? (
        <button
          type="button"
          onClick={() => window.glazeAPI.glaze.ipc.invoke("shell:openExternal", update.releaseUrl)}
          title="Open the release page"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-footnote text-blue-11 transition-colors hover:bg-blue-a3"
        >
          <Download className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Octoput {update.latestVersion} available</span>
        </button>
      ) : null}
    </Sidebar>
  );
}
