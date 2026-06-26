import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  toast,
} from "@ui";
import {
  ArrowUpDown,
  ChevronRight,
  FileUp,
  FolderOpen,
  Search,
  SlidersHorizontal,
} from "lucide-react";

const invoke = window.glazeAPI.glaze.ipc.invoke;

interface PutioFile {
  id: number;
  name: string;
  isFolder: boolean;
}
interface Listing {
  files: PutioFile[];
  parent: { id: number; name: string; parentId: number };
}
type PathItem = { id: number; name: string };

interface SourceInfo {
  id: string;
  name: string;
  description: string;
  active: boolean;
}
interface SourceStatus {
  connected: boolean;
  username?: string;
}
interface ReleaseInfo {
  resolution?: string;
  quality?: string;
  codec?: string;
  audio?: string;
  bitDepth?: string;
}
interface SearchResult {
  id: string;
  title: string;
  link: string;
  indexer: string;
  source: string;
  seeders: string;
  size: string;
  uploadedAt?: string;
  releaseInfo?: ReleaseInfo;
}

type SortKey = "seeders" | "size" | "age";
interface SearchPrefs {
  sort: SortKey;
  resolutions: string[];
  codecs: string[];
}
const PREFS_KEY = "octoput.search.prefs";
const SORT_KEYS: SortKey[] = ["seeders", "size", "age"];
const SORT_LABEL: Record<SortKey, string> = {
  seeders: "Seeders",
  size: "Size",
  age: "Age",
};
// Codecs we don't expose as filter options.
const EXCLUDED_CODECS = ["av1", "xvid"];

function uploadedTs(s?: string): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

// Rank resolutions for sorting (higher = better).
const RES_RANK: Record<string, number> = {
  "4320p": 6,
  "2160p": 5,
  "1440p": 4,
  "1080p": 3,
  "720p": 2,
  "576p": 1,
  "480p": 0,
};
function resRank(r?: string): number {
  return r ? (RES_RANK[r.toLowerCase()] ?? -1) : -1;
}

function loadPrefs(): SearchPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SearchPrefs>;
      return {
        sort: p.sort && SORT_KEYS.includes(p.sort) ? p.sort : "seeders",
        resolutions: Array.isArray(p.resolutions) ? p.resolutions : [],
        codecs: Array.isArray(p.codecs) ? p.codecs : [],
      };
    }
  } catch {
    // ignore malformed prefs
  }
  return { sort: "seeders", resolutions: [], codecs: [] };
}

function formatBytes(input: string | number): string {
  const bytes = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── Target-folder picker (breadcrumb + folder list) ───────────────────
function FolderPicker({ value, onChange }: { value: PathItem[]; onChange: (p: PathItem[]) => void }) {
  const parentId = value.length ? value[value.length - 1].id : 0;
  const listing = useQuery<Listing>({
    queryKey: ["putio", "files", parentId],
    queryFn: () => invoke<Listing>("putio:listFiles", { parentId }),
    staleTime: 30 * 1000,
  });
  const folders = (listing.data?.files ?? []).filter((f) => f.isFolder);
  const segments: PathItem[] = [{ id: 0, name: "Your Files" }, ...value];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-a4">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-a3 bg-gray-2 px-2 py-1.5 text-footnote text-gray-a11">
        {segments.map((seg, i) => (
          <React.Fragment key={`${seg.id}-${i}`}>
            {i > 0 && <ChevronRight className="size-3 shrink-0 text-gray-a7" />}
            <button onClick={() => onChange(value.slice(0, i))} className="rounded px-1 hover:bg-gray-a3">
              {seg.name}
            </button>
          </React.Fragment>
        ))}
      </div>
      <div className="max-h-44 divide-y divide-gray-a3 overflow-auto">
        {listing.isLoading ? (
          <div className="p-3 text-callout text-gray-a10">Loading…</div>
        ) : folders.length === 0 ? (
          <div className="p-3 text-callout text-gray-a10">No subfolders here.</div>
        ) : (
          folders.map((f) => (
            <button
              key={f.id}
              onClick={() => onChange([...value, { id: f.id, name: f.name }])}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-a2"
            >
              <FolderOpen className="size-4 shrink-0 text-blue-11" />
              <span className="min-w-0 flex-1 truncate text-body">{f.name}</span>
              <ChevronRight className="size-4 shrink-0 text-gray-a8" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Prompt shown when the active search source isn't connected ────────
// Source selection + connection lives in Settings, so this stays generic
// (no provider-specific wording).
function NoSourcePrompt() {
  const navigate = useNavigate();
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-gray-a4 bg-gray-2 p-5 text-center">
      <Search className="size-6 text-gray-a10" />
      <div className="text-bodyEmphasized">Search for torrents</div>
      <p className="max-w-sm text-callout text-gray-a11">
        Connect a search source to find torrents and add them here.
      </p>
      <Button variant="accent" onClick={() => navigate({ to: "/settings" })}>
        <SlidersHorizontal className="size-4" />
        Choose a source in Settings
      </Button>
    </section>
  );
}

// Remembers the last search across navigation. The /transfer route unmounts when
// you browse elsewhere; React Query keeps the results cached, and this restores
// the query string so they re-display on return (resets on full app reload).
const searchMemory: { draft: string; query: string } = { draft: "", query: "" };

// ── Source search (shown when the active source is connected) ─────────
function SourceSearch({
  source,
  destId,
  onAdded,
}: {
  source: SourceInfo;
  destId: number;
  onAdded: () => void;
}) {
  const [draft, setDraft] = React.useState(searchMemory.draft);
  const [query, setQuery] = React.useState(searchMemory.query);
  const [addingId, setAddingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    searchMemory.draft = draft;
    searchMemory.query = query;
  }, [draft, query]);

  const searchQ = useQuery<{ results: SearchResult[] }>({
    queryKey: ["sources", "search", source.id, query],
    queryFn: () => invoke<{ results: SearchResult[] }>("sources:search", { query }),
    enabled: query.length > 0,
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000, // keep results cached through typical browsing
  });

  const [prefs, setPrefs] = React.useState<SearchPrefs>(loadPrefs);
  React.useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const add = async (r: SearchResult) => {
    setAddingId(r.id);
    try {
      await invoke("putio:addTransfer", { url: r.link, saveParentId: destId });
      toast.success(`Added “${r.title}” to put.io`);
      onAdded();
    } catch (e) {
      toast.error(`Couldn't add: ${(e as Error).message}`);
    } finally {
      setAddingId(null);
    }
  };

  const raw = searchQ.data?.results ?? [];

  // Distinct resolution/codec values present in the current results.
  const resolutionOptions = Array.from(
    new Set(raw.map((r) => r.releaseInfo?.resolution).filter((v): v is string => !!v)),
  ).sort((a, b) => resRank(b) - resRank(a));
  const codecOptions = Array.from(
    new Set(raw.map((r) => r.releaseInfo?.codec).filter((v): v is string => !!v)),
  )
    .filter((c) => !EXCLUDED_CODECS.includes(c.toLowerCase()))
    .sort();

  const toggle = (key: "resolutions" | "codecs", v: string) =>
    setPrefs((p) => {
      const set = new Set(p[key]);
      set.has(v) ? set.delete(v) : set.add(v);
      return { ...p, [key]: [...set] };
    });

  const filtered = raw.filter((r) => {
    const res = r.releaseInfo?.resolution;
    const cod = r.releaseInfo?.codec;
    if (prefs.resolutions.length && !(res && prefs.resolutions.includes(res))) return false;
    if (prefs.codecs.length && !(cod && prefs.codecs.includes(cod))) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (prefs.sort === "size") return Number(b.size) - Number(a.size);
    if (prefs.sort === "age") {
      const d = uploadedTs(b.uploadedAt) - uploadedTs(a.uploadedAt); // newest first
      return d !== 0 ? d : Number(b.seeders) - Number(a.seeders);
    }
    return Number(b.seeders) - Number(a.seeders);
  });

  return (
    <section className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type="search"
          placeholder={`Search torrents (${source.name})`}
          aria-label="Search torrents"
          className="w-full"
        />
      </form>

      {query && raw.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <ArrowUpDown className="size-3.5" />
                Sort: {SORT_LABEL[prefs.sort]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              {SORT_KEYS.map((k) => (
                <DropdownMenuCheckboxItem
                  key={k}
                  checked={prefs.sort === k}
                  onCheckedChange={() => setPrefs((p) => ({ ...p, sort: k }))}
                >
                  {SORT_LABEL[k]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {resolutionOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <SlidersHorizontal className="size-3.5" />
                  Resolution{prefs.resolutions.length ? ` (${prefs.resolutions.length})` : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Resolution</DropdownMenuLabel>
                {resolutionOptions.map((res) => (
                  <DropdownMenuCheckboxItem
                    key={res}
                    checked={prefs.resolutions.includes(res)}
                    onCheckedChange={() => toggle("resolutions", res)}
                  >
                    {res}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {codecOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <SlidersHorizontal className="size-3.5" />
                  Codec{prefs.codecs.length ? ` (${prefs.codecs.length})` : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Codec</DropdownMenuLabel>
                {codecOptions.map((cod) => (
                  <DropdownMenuCheckboxItem
                    key={cod}
                    checked={prefs.codecs.includes(cod)}
                    onCheckedChange={() => toggle("codecs", cod)}
                  >
                    {cod}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {(prefs.resolutions.length > 0 || prefs.codecs.length > 0) && (
            <button
              onClick={() => setPrefs((p) => ({ ...p, resolutions: [], codecs: [] }))}
              className="text-footnote text-blue-11 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {query &&
        (searchQ.isFetching && raw.length === 0 ? (
          <div className="text-callout text-gray-a10">Searching…</div>
        ) : searchQ.error ? (
          <div className="text-callout text-red-11">{(searchQ.error as Error).message}</div>
        ) : raw.length === 0 ? (
          <div className="text-callout text-gray-a10">No results for “{query}”.</div>
        ) : sorted.length === 0 ? (
          <div className="text-callout text-gray-a10">No results match the current filters.</div>
        ) : (
          <div className="divide-y divide-gray-a3 overflow-hidden rounded-lg border border-gray-a4">
            {sorted.slice(0, 50).map((r) => {
              const ri = r.releaseInfo;
              const badges = [ri?.resolution, ri?.codec, ri?.quality].filter(Boolean) as string[];
              return (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-callout">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {badges.map((b) => (
                        <span
                          key={b}
                          className="rounded bg-gray-a3 px-1.5 py-0.5 text-[11px] font-medium text-gray-a11"
                        >
                          {b}
                        </span>
                      ))}
                      <span className="text-footnote text-gray-a10 tabular-nums">
                        {r.indexer} · {r.seeders} seeders · {formatBytes(r.size)}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={addingId === r.id}
                    onClick={() => add(r)}
                  >
                    {addingId === r.id ? "Adding…" : "Add"}
                  </Button>
                </div>
              );
            })}
          </div>
        ))}
    </section>
  );
}

// ── New transfer view ─────────────────────────────────────────────────
export function NewTransferView() {
  const queryClient = useQueryClient();

  // Target folder — initialised to the put.io default download folder.
  const [pickPath, setPickPath] = React.useState<PathItem[] | null>(null);
  const defaultFolderQ = useQuery({
    queryKey: ["putio", "defaultFolder"],
    queryFn: () => invoke<{ id: number; name: string }>("putio:defaultFolder"),
    staleTime: 5 * 60 * 1000,
  });
  React.useEffect(() => {
    if (pickPath === null && defaultFolderQ.data) {
      const { id, name } = defaultFolderQ.data;
      setPickPath(id > 0 ? [{ id, name }] : []);
    }
  }, [defaultFolderQ.data, pickPath]);
  const path = pickPath ?? [];
  const dest = path.length ? path[path.length - 1] : { id: 0, name: "Your Files" };
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Paste links → put.io transfers.
  const [links, setLinks] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const refreshFiles = () => queryClient.invalidateQueries({ queryKey: ["putio", "files"] });

  // Upload local .torrent files → put.io transfers.
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const uploadTorrents = async (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setUploading(true);
    let ok = 0;
    let fail = 0;
    for (const file of list) {
      try {
        // Read as a data URL and strip the "data:…;base64," prefix — base64 is
        // robust over the IPC bridge and .torrent files are small.
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(file);
        });
        await invoke("putio:uploadTorrent", { dataBase64, filename: file.name, saveParentId: dest.id });
        ok++;
      } catch {
        fail++;
      }
    }
    setUploading(false);
    if (ok) toast.success(`Uploaded ${ok} torrent${ok > 1 ? "s" : ""} to put.io`);
    if (fail) toast.error(`${fail} file${fail > 1 ? "s" : ""} couldn't be uploaded`);
    if (ok) refreshFiles();
  };

  const addLinks = async () => {
    const urls = links
      .split(/[\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    setAdding(true);
    let ok = 0;
    let fail = 0;
    for (const url of urls) {
      try {
        await invoke("putio:addTransfer", { url, saveParentId: dest.id });
        ok++;
      } catch {
        fail++;
      }
    }
    setAdding(false);
    if (ok) toast.success(`Added ${ok} transfer${ok > 1 ? "s" : ""} to put.io`);
    if (fail) toast.error(`${fail} link${fail > 1 ? "s" : ""} couldn't be added`);
    if (ok) {
      setLinks("");
      refreshFiles();
    }
  };

  // Active torrent search source + its connection status.
  const sourcesQ = useQuery<SourceInfo[]>({
    queryKey: ["sources", "list"],
    queryFn: () => invoke<SourceInfo[]>("sources:list"),
  });
  const activeSource = sourcesQ.data?.find((s) => s.active) ?? sourcesQ.data?.[0];
  const statusQ = useQuery<SourceStatus>({
    queryKey: ["sources", "status", activeSource?.id],
    queryFn: () => invoke<SourceStatus>("sources:status", { id: activeSource!.id }),
    enabled: !!activeSource,
  });
  const connected = statusQ.data?.connected === true;

  return (
    <ScrollArea title="New transfer" scrollbars="vertical">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
        {activeSource && connected ? (
          <SourceSearch source={activeSource} destId={dest.id} onAdded={refreshFiles} />
        ) : (
          <NoSourcePrompt />
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-bodyEmphasized">Save to</h2>
          {pickPath === null ? (
            <div className="text-callout text-gray-a10">Loading…</div>
          ) : !pickerOpen ? (
            <div className="flex items-center gap-2 rounded-lg border border-gray-a4 px-3 py-2">
              <FolderOpen className="size-4 shrink-0 text-blue-11" />
              <span className="min-w-0 flex-1 truncate text-body">{dest.name}</span>
              <button
                onClick={() => {
                  setPickPath([]); // start browsing from root ("Your Files")
                  setPickerOpen(true);
                }}
                className="shrink-0 text-footnote text-blue-11 hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <FolderPicker value={path} onChange={setPickPath} />
              <div className="flex justify-end">
                <button
                  onClick={() => setPickerOpen(false)}
                  className="text-footnote text-blue-11 hover:underline"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-bodyEmphasized">Add links</h2>
          <textarea
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            rows={4}
            placeholder="Paste magnet links or URLs, one per line"
            className="w-full resize-y rounded-md border border-gray-a6 bg-card p-2.5 text-[0.8125rem] shadow-sm outline-none transition-colors placeholder:text-gray-a10 focus-visible:border-blue-8 focus-visible:ring-2 focus-visible:ring-blue-a6 dark:shadow-none"
          />
          <div className="flex justify-end">
            <Button onClick={addLinks} disabled={adding || !links.trim()}>
              {adding ? "Adding…" : "Add to put.io"}
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-bodyEmphasized">Upload .torrent file</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept=".torrent,application/x-bittorrent"
            multiple
            className="hidden"
            onChange={(e) => {
              void uploadTorrents(e.target.files);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <div className="flex items-center gap-2 rounded-lg border border-gray-a4 px-3 py-2">
            <FileUp className="size-4 shrink-0 text-blue-11" />
            <span className="min-w-0 flex-1 truncate text-callout text-gray-a11">
              Add a .torrent file from your computer to put.io
            </span>
            <Button
              variant="outline"
              disabled={uploading || pickPath === null}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Browse…"}
            </Button>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
