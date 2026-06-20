import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Toolbar,
  ToolbarContent,
  ToolbarTitle,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldSet,
  toast,
} from "@ui";
import { useTheme } from "@ui";
import type { NativeThemeInfo } from "@platform/ipc-types";

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
  // Keep the theme class in sync (Settings can be the first view a window paints).
  useTheme();
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const [_isLoading, setIsLoading] = useState(true);

  const refreshThemeInfo = async () => {
    try {
      const info = await window.glazeAPI.nativeTheme.getInfo();
      setThemeInfo(info);
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshThemeInfo();
  }, []);

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

  const handleThemeChange = async (value: string) => {
    const source = value as "system" | "light" | "dark";
    try {
      await window.glazeAPI.nativeTheme.setThemeSource(source);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set theme: ${error}`);
    }
  };

  return (
    <ScrollArea
      toolbar={
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Settings</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
      }
    >
      <div className="px-4 flex flex-col gap-8 mb-8">
        <FieldSet>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="theme">Theme</FieldLabel>
              </FieldContent>
              <RadioGroup
                value={themeInfo?.themeSource ?? "system"}
                onValueChange={handleThemeChange}
                orientation="horizontal"
              >
                <Label>
                  <RadioGroupItem value="system" />
                  Auto
                </Label>
                <Label>
                  <RadioGroupItem value="light" />
                  Light
                </Label>
                <Label>
                  <RadioGroupItem value="dark" />
                  Dark
                </Label>
              </RadioGroup>
            </Field>
          </FieldGroup>
        </FieldSet>

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
