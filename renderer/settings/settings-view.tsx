import { useQuery } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  ScrollArea,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldSet,
  toast,
} from "@ui";

const invoke = window.glazeAPI.glaze.ipc.invoke;
const openExternal = window.glazeAPI.shell.openExternal;

// Indexer selection for the bundled Jackett source.
function JackettPanel() {
  const statusQ = useQuery<{ installed: boolean; running: boolean }>({
    queryKey: ["jackett", "status"],
    queryFn: () => invoke<{ installed: boolean; running: boolean }>("jackett:status"),
  });
  const indexersQ = useQuery<{ indexers: { id: string; name: string }[] }>({
    queryKey: ["jackett", "indexers"],
    queryFn: () => invoke<{ indexers: { id: string; name: string }[] }>("jackett:indexers"),
    enabled: statusQ.data?.installed === true,
  });
  const selectedQ = useQuery<{ selected: string[] }>({
    queryKey: ["jackett", "selected"],
    queryFn: () => invoke<{ selected: string[] }>("jackett:selectedIndexers"),
  });
  const selected = new Set(selectedQ.data?.selected ?? []);

  const toggle = async (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    await invoke("jackett:setSelectedIndexers", { ids: [...next] });
    selectedQ.refetch();
  };
  const openJackett = async () => {
    const { url } = await invoke<{ url: string }>("jackett:webUrl");
    openExternal(url);
  };

  if (statusQ.data && !statusQ.data.installed) {
    return (
      <div className="rounded-lg border border-gray-a4 p-3 text-footnote text-gray-a10">
        Jackett isn't bundled in this build yet.
      </div>
    );
  }
  const indexers = indexersQ.data?.indexers ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-a4 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-footnote text-gray-a11">Indexers to search</span>
        <Button size="sm" variant="outline" onClick={openJackett}>
          Open Jackett
        </Button>
      </div>
      {indexersQ.isLoading ? (
        <div className="text-footnote text-gray-a10">Starting Jackett…</div>
      ) : indexers.length === 0 ? (
        <div className="text-footnote text-gray-a10">
          No indexers configured yet. Use “Open Jackett” to add some.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {indexers.map((ix) => (
            <label key={ix.id} className="flex items-center gap-2 text-callout">
              <input
                type="checkbox"
                checked={selected.has(ix.id)}
                onChange={() => toggle(ix.id)}
                className="accent-blue-9"
              />
              {ix.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const handleLogout = async () => {
    try {
      await window.glazeAPI.glaze.ipc.invoke("auth:logout");
      toast.success("Signed out of put.io");
      // No window to close — the app re-gates to Connect once auth clears.
    } catch (error) {
      toast.error(`Couldn't sign out: ${error}`);
      throw error; // keep the dialog open for retry
    }
  };

  return (
    <ScrollArea title="Settings">
      <div className="flex flex-col gap-8 px-4 pt-6 mb-8">
        <FieldSet>
          <FieldGroup>
            <Field>
              <FieldContent>
                <FieldLabel>Torrent search</FieldLabel>
                <p className="text-footnote text-gray-a10">
                  Choose which indexers the bundled Jackett searches.
                </p>
              </FieldContent>
              <JackettPanel />
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Account</FieldLabel>
              </FieldContent>
              <AlertDialog
                trigger={<Button variant="filled">Log out</Button>}
                title="Log out of put.io?"
                description="This signs out of put.io on this Mac. You'll need to reconnect to search and stream again."
                confirmLabel="Log out"
                confirmVariant="destructive"
                onConfirm={handleLogout}
              />
            </Field>
          </FieldGroup>
        </FieldSet>
      </div>
    </ScrollArea>
  );
}
