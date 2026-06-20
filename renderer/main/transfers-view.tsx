import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, ScrollArea, toast } from "@ui";
import { X } from "lucide-react";

const invoke = window.glazeAPI.glaze.ipc.invoke;

interface Transfer {
  id: number;
  name: string;
  status: string;
  percentDone: number;
  size: number;
  downSpeed: number;
  estimatedTime: number | null;
  errorMessage?: string;
}

// A transfer is "active" while it's still working toward completion.
const FINISHED = new Set(["COMPLETED", "SEEDING", "ERROR"]);
export const isActiveTransfer = (t: { status: string }) => !FINISHED.has(t.status);

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtEta(s: number): string {
  if (s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function statusInfo(status: string): { label: string; cls: string; bar: string } {
  switch (status) {
    case "DOWNLOADING":
    case "COMPLETING":
      return { label: status === "COMPLETING" ? "Finishing" : "Downloading", cls: "text-blue-11", bar: "bg-blue-9" };
    case "COMPLETED":
      return { label: "Completed", cls: "text-green-11", bar: "bg-green-9" };
    case "SEEDING":
      return { label: "Seeding", cls: "text-green-11", bar: "bg-green-9" };
    case "ERROR":
      return { label: "Error", cls: "text-red-11", bar: "bg-red-9" };
    case "IN_QUEUE":
    case "WAITING":
    case "PREPARING_DOWNLOAD":
      return { label: "Queued", cls: "text-gray-a10", bar: "bg-gray-a8" };
    default:
      return { label: status.replace(/_/g, " ").toLowerCase() || "—", cls: "text-gray-a10", bar: "bg-gray-a8" };
  }
}

export function TransfersView() {
  const queryClient = useQueryClient();
  const transfersQ = useQuery<{ transfers: Transfer[] }>({
    queryKey: ["putio", "transfers"],
    queryFn: () => invoke<{ transfers: Transfer[] }>("putio:listTransfers"),
    refetchInterval: 5000,
  });

  const transfers = transfersQ.data?.transfers ?? [];
  // Active transfers first; otherwise preserve put.io's order.
  const sorted = [...transfers].sort((a, b) => Number(isActiveTransfer(b)) - Number(isActiveTransfer(a)));
  const hasFinished = transfers.some((t) => t.status === "COMPLETED" || t.status === "ERROR");

  const cancel = async (t: Transfer) => {
    try {
      await invoke("putio:cancelTransfer", { id: t.id });
      toast.success(`Removed “${t.name}”`);
      transfersQ.refetch();
      queryClient.invalidateQueries({ queryKey: ["putio", "files"] });
    } catch (e) {
      toast.error(`Couldn't remove: ${(e as Error).message}`);
    }
  };

  const clearFinished = async () => {
    try {
      await invoke("putio:cleanTransfers");
      toast.success("Cleared finished transfers");
      transfersQ.refetch();
    } catch (e) {
      toast.error(`Couldn't clear: ${(e as Error).message}`);
    }
  };

  return (
    <ScrollArea title="Transfers" scrollbars="vertical">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-bodyEmphasized">Transfers</h2>
          {hasFinished && (
            <Button size="sm" variant="outline" onClick={clearFinished}>
              Clear completed
            </Button>
          )}
        </div>

        {transfersQ.isLoading && transfers.length === 0 ? (
          <div className="text-callout text-gray-a10">Loading…</div>
        ) : sorted.length === 0 ? (
          <EmptyState
            placement="inline"
            title="No transfers"
            description="Add a magnet, URL, or .torrent from New transfer and it'll show up here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((t) => {
              const info = statusInfo(t.status);
              const pct = Math.min(100, Math.max(0, t.percentDone));
              return (
                <div key={t.id} className="flex flex-col gap-1.5 rounded-lg border border-gray-a4 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-callout">{t.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote tabular-nums text-gray-a10">
                        <span className={info.cls}>{info.label}</span>
                        <span>{fmtBytes(t.size)}</span>
                        {t.downSpeed > 0 && <span>↓ {fmtBytes(t.downSpeed)}/s</span>}
                        {isActiveTransfer(t) && t.estimatedTime != null && t.estimatedTime > 0 && (
                          <span>{fmtEta(t.estimatedTime)} left</span>
                        )}
                        {t.status !== "ERROR" && pct < 100 && <span>{pct}%</span>}
                      </div>
                      {t.status === "ERROR" && t.errorMessage && (
                        <div className="mt-0.5 truncate text-footnote text-red-11">{t.errorMessage}</div>
                      )}
                    </div>
                    <button
                      onClick={() => cancel(t)}
                      aria-label="Remove transfer"
                      title="Remove"
                      className="shrink-0 rounded-md p-1 text-gray-a10 transition-colors hover:bg-gray-a3 hover:text-gray-a12"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-a3">
                    <div
                      className={`h-full rounded-full ${info.bar} transition-[width]`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
