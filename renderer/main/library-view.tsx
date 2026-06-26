import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  ScrollArea,
  Slider,
  SplitView,
  Toolbar,
  ToolbarRow,
  toast,
} from "@ui";
import { cn } from "@ui";
import {
  AudioLines,
  Captions,
  ChevronLeft,
  ChevronRight,
  File as FileIcon,
  FileArchive,
  FileText,
  Film,
  Image as ImageIcon,
  Maximize2,
  Music,
  Pause,
  Play,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PaneEmptyState, ScrollEmptyState } from "./pane-empty-state";
import { useHlsSource } from "./use-hls-source";
import { NavPane, useKeyboardNav, useKeyboardNavOverride } from "./keyboard-nav";

const invoke = window.glazeAPI.glaze.ipc.invoke;

// ── Types (mirror main/services/putio.ts) ─────────────────────────────
interface PutioFile {
  id: number;
  name: string;
  parentId: number;
  fileType: string;
  size: number;
  isFolder: boolean;
  isVideo: boolean;
  thumbnail?: string;
  screenshot?: string;
}

interface PutioListing {
  files: PutioFile[];
  parent: { id: number; name: string; parentId: number };
}

type PathItem = { id: number; name: string };

// ── File-type classification (drives icons + which preview pane to show) ──
type FileKind = "folder" | "video" | "audio" | "pdf" | "image" | "text" | "archive" | "other";

const AUDIO_EXT = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "oga", "opus", "wma", "alac"];
const TEXT_EXT = ["txt", "md", "markdown", "log", "nfo", "srt", "vtt", "json", "yml", "yaml", "csv", "tsv", "xml", "ini", "conf", "sh", "js", "ts"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"];
const ARCHIVE_EXT = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"];

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function fileKind(f: PutioFile): FileKind {
  if (f.isFolder) return "folder";
  if (f.isVideo) return "video";
  const e = fileExt(f.name);
  if (AUDIO_EXT.includes(e)) return "audio";
  if (e === "pdf") return "pdf";
  if (IMAGE_EXT.includes(e)) return "image";
  if (TEXT_EXT.includes(e)) return "text";
  if (ARCHIVE_EXT.includes(e)) return "archive";
  return "other";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// Track push (deeper) vs pop (shallower) navigation for slide direction.
// Compute the direction only when the level actually changes and freeze it for
// that level. Otherwise an unrelated re-render (e.g. the staleTime:0 background
// refetch resolving, or the search-draft reset) would recompute it: after a pop
// the default flips back to "push", changing the div's CSS animation-name and
// restarting the slide — a visible double-load/flicker when backing out.
function useNavDirection(level: number): "push" | "pop" {
  const ref = React.useRef<{ level: number; dir: "push" | "pop" }>({ level, dir: "push" });
  if (level !== ref.current.level) {
    ref.current = { level, dir: level > ref.current.level ? "push" : "pop" };
  }
  return ref.current.dir;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// ── iOS-style nav bar (back button) ───────────────────────────────────
function NavBar({ backLabel, onBack }: { backLabel?: string; onBack?: () => void }) {
  return (
    <Toolbar>
      <ToolbarRow>
        {backLabel && onBack ? (
          <button
            onClick={onBack}
            className="-ml-1 flex items-center gap-0.5 text-body text-blue-11 transition-opacity active:opacity-50"
          >
            <ChevronLeft className="size-5" />
            <span className="max-w-44 truncate">{backLabel}</span>
          </button>
        ) : (
          <div className="h-5" />
        )}
      </ToolbarRow>
    </Toolbar>
  );
}

// ── Row leading visual ────────────────────────────────────────────────
// Crisp, solid-color type icons (not faint alpha tints). Videos keep the put.io
// thumbnail since it's a real preview frame.
function Leading({ file }: { file: PutioFile }) {
  const [failed, setFailed] = React.useState(false);
  const kind = fileKind(file);
  if (kind === "folder") return <FolderGlyph className="size-5 shrink-0 text-blue-11" />;

  // Videos: prefer the put.io thumbnail; fall back to the film icon.
  if (kind === "video" && file.thumbnail && !failed) {
    return (
      <img
        src={file.thumbnail}
        alt=""
        onError={() => setFailed(true)}
        className="h-8 w-[3.25rem] shrink-0 rounded object-cover"
      />
    );
  }

  const cls = "size-5 shrink-0";
  switch (kind) {
    case "video":
      return <Film className={cn(cls, "text-gray-11")} />;
    case "audio":
      return <Music className={cn(cls, "text-gray-11")} />;
    case "pdf":
      return <FileText className={cn(cls, "text-red-9")} />;
    case "image":
      return <ImageIcon className={cn(cls, "text-gray-11")} />;
    case "text":
      return <FileText className={cn(cls, "text-gray-11")} />;
    case "archive":
      return <FileArchive className={cn(cls, "text-gray-11")} />;
    default:
      return <FileIcon className={cn(cls, "text-gray-11")} />;
  }
}

// Filled folder glyph (Lucide's Folder is outline; fill it for the iOS look).
function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

// Grouped list of file rows (shared by folder browsing and search results).
function FileRows({
  items,
  selectedId,
  onOpen,
  onMove,
  onDelete,
}: {
  items: PutioFile[];
  selectedId?: number;
  onOpen: (item: PutioFile) => void;
  onMove: (item: PutioFile) => void;
  onDelete: (item: PutioFile) => void;
}) {
  return (
    <div className="flex flex-col gap-px px-2 pb-4">
      {items.map((file) => {
        const selected = !file.isFolder && file.id === selectedId;
        const kind = fileKind(file);
        return (
          <ContextMenu key={file.id}>
            <ContextMenuTrigger asChild>
              <button
                data-nav-item=""
                onClick={() => onOpen(file)}
                className={
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-a7 " +
                  (selected ? "bg-blue-a4 text-gray-12" : "hover:bg-gray-a3 active:bg-gray-a4")
                }
              >
                <Leading file={file} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.8125rem]">{file.name}</div>
                  {!file.isFolder && (
                    <div className="text-[0.6875rem] text-gray-a10 tabular-nums">
                      {formatBytes(file.size)}
                    </div>
                  )}
                </div>
                {file.isFolder ? (
                  <ChevronRight className="size-4 shrink-0 text-gray-a8" />
                ) : kind === "video" || kind === "audio" ? (
                  <Play className="size-3.5 shrink-0 text-gray-a8" />
                ) : null}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon="folder" onSelect={() => onMove(file)}>
                Move…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem icon="trash" color="red" onSelect={() => onDelete(file)}>
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-px px-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="size-5 shrink-0 rounded bg-gray-a3 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-gray-a3 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ── Browser pane (iPhone-style push navigation + search) ──────────────
function BrowserPane({
  path,
  files,
  loading,
  error,
  selectedId,
  onOpen,
  onOpenSearch,
  onMove,
  onDelete,
  onBack,
  onRefresh,
  refreshing,
}: {
  path: PathItem[];
  files: PutioFile[];
  loading: boolean;
  error: Error | null;
  selectedId?: number;
  onOpen: (item: PutioFile) => void;
  onOpenSearch: (item: PutioFile) => void;
  onMove: (item: PutioFile) => void;
  onDelete: (item: PutioFile) => void;
  onBack: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const segments: PathItem[] = [{ id: 0, name: "Your Files" }, ...path];
  const depth = path.length;
  const title = segments[depth]?.name ?? "Your Files";
  const backLabel = depth > 0 ? segments[depth - 1].name : undefined;
  const dir = useNavDirection(depth);

  const [draft, setDraft] = React.useState("");
  // Clear the search when navigating to a different folder.
  React.useEffect(() => setDraft(""), [depth]);
  const query = useDebounced(draft.trim(), 300);
  const searching = query.length > 0;

  const searchQ = useQuery({
    queryKey: ["putio", "search", query],
    queryFn: () => invoke<{ files: PutioFile[] }>("putio:search", { query }),
    enabled: searching,
    staleTime: 30 * 1000,
  });

  let body: React.ReactNode;
  if (searching) {
    const results = searchQ.data?.files ?? [];
    if (searchQ.isFetching && results.length === 0) {
      body = <RowsSkeleton />;
    } else if (searchQ.error) {
      body = <ScrollEmptyState title="Search failed" description={(searchQ.error as Error).message} />;
    } else if (results.length === 0) {
      body = <ScrollEmptyState title={`No results for “${query}”`} description="Try a different term." />;
    } else {
      body = (
        <FileRows
          items={results}
          selectedId={selectedId}
          onOpen={onOpenSearch}
          onMove={onMove}
          onDelete={onDelete}
        />
      );
    }
  } else if (loading) {
    body = <RowsSkeleton />;
  } else if (error) {
    body = <ScrollEmptyState title="Couldn't load files" description={error.message} />;
  } else if (files.length === 0) {
    body = <ScrollEmptyState title="Empty folder" description="Nothing here yet." />;
  } else {
    body = (
      <FileRows
        items={files}
        selectedId={selectedId}
        onOpen={onOpen}
        onMove={onMove}
        onDelete={onDelete}
      />
    );
  }

  return (
    <ScrollArea scrollbars="vertical" toolbar={<NavBar backLabel={backLabel} onBack={onBack} />}>
      <div key={`browse-${depth}`} className={dir === "push" ? "ios-push" : "ios-pop"}>
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-1">
          <h1 className="min-w-0 truncate text-[1.0625rem] font-semibold tracking-tight">{title}</h1>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
            className="shrink-0 rounded-md p-1.5 text-gray-a10 transition-colors hover:bg-gray-a3 hover:text-gray-a12 disabled:opacity-50"
          >
            <RotateCw className={cn("size-4", refreshing && "animate-spin")} />
          </button>
        </div>
        <div className="px-3 pb-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            type="search"
            placeholder="Search put.io"
            aria-label="Search put.io files"
            className="w-full"
          />
        </div>
        {body}
      </div>
    </ScrollArea>
  );
}

interface AudioTrack {
  index: number;
  language?: string;
  title?: string;
  codec?: string;
  channels?: number;
}

const LANG_NAMES: Record<string, string> = {
  eng: "English", en: "English", jpn: "Japanese", ja: "Japanese", spa: "Spanish", es: "Spanish",
  fre: "French", fra: "French", fr: "French", ger: "German", deu: "German", de: "German",
  ita: "Italian", it: "Italian", por: "Portuguese", pt: "Portuguese", rus: "Russian", ru: "Russian",
  kor: "Korean", ko: "Korean", chi: "Chinese", zho: "Chinese", zh: "Chinese", hin: "Hindi",
  ara: "Arabic", nld: "Dutch", swe: "Swedish", und: "Undetermined",
};
function channelLabel(ch?: number): string {
  if (!ch) return "";
  if (ch === 1) return "Mono";
  if (ch === 2) return "2.0";
  if (ch === 6) return "5.1";
  if (ch === 8) return "7.1";
  return `${ch}ch`;
}
function audioLabel(t: AudioTrack, i: number): string {
  const lang = t.language ? (LANG_NAMES[t.language.toLowerCase()] ?? t.language.toUpperCase()) : undefined;
  const parts = [lang ?? t.title ?? `Track ${i + 1}`, channelLabel(t.channels), t.codec?.toUpperCase()];
  return parts.filter(Boolean).join(" · ");
}

// ── Player pane (third column) ────────────────────────────────────────
function PlayerPane({ file }: { file: PutioFile }) {
  // In-app playback: transcode to HLS on the fly so any container/codec plays
  // in the window. `phase` drives the UI; the session is torn down on unmount /
  // file change.
  const [phase, setPhase] = React.useState<"preparing" | "ready" | "error" | "need-ffmpeg">(
    "preparing",
  );
  const [src, setSrc] = React.useState<string | undefined>(undefined);
  const [errMsg, setErrMsg] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [sessionId, setSessionId] = React.useState<string | undefined>(undefined);
  const [audioTracks, setAudioTracks] = React.useState<AudioTrack[]>([]);
  const [audioIndex, setAudioIndex] = React.useState(0);
  // Position to restore after an audio-track switch reloads the stream.
  const pendingSeekRef = React.useRef<{ time: number; wasPlaying: boolean } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let activeSession: string | undefined;
    setPhase("preparing");
    setSrc(undefined);
    setErrMsg("");
    setAudioTracks([]);
    setAudioIndex(0);
    pendingSeekRef.current = null;
    (async () => {
      try {
        const res = await invoke<{
          url: string;
          sessionId: string;
          audioTracks?: AudioTrack[];
          audioIndex?: number;
        }>("transcode:start", {
          fileId: file.id,
        });
        if (cancelled) {
          invoke("transcode:stop", { sessionId: res.sessionId }).catch(() => {});
          return;
        }
        activeSession = res.sessionId;
        setSrc(res.url);
        setSessionId(res.sessionId);
        setAudioTracks(res.audioTracks ?? []);
        setAudioIndex(res.audioIndex ?? 0);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        const msg = (e as Error).message || "Playback failed";
        if (/ffmpeg is not installed/i.test(msg)) {
          setPhase("need-ffmpeg");
        } else {
          setErrMsg(msg);
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (activeSession) invoke("transcode:stop", { sessionId: activeSession }).catch(() => {});
    };
  }, [file.id, retry]);

  // Switch the muxed audio track: re-encode from the current position.
  const selectAudio = async (i: number) => {
    if (i === audioIndex || !sessionId) return;
    const v = videoRef.current;
    pendingSeekRef.current = v ? { time: v.currentTime, wasPlaying: !v.paused } : null;
    try {
      await invoke("transcode:setAudioTrack", { sessionId, index: i });
      setAudioIndex(i); // bumps the cache-busted play URL → useHlsSource reloads
    } catch (e) {
      pendingSeekRef.current = null;
      toast.error(`Couldn't switch audio: ${(e as Error).message}`);
    }
  };

  const [installingFfmpeg, setInstallingFfmpeg] = React.useState(false);
  const installFfmpeg = async () => {
    setInstallingFfmpeg(true);
    try {
      await toast.promise(invoke("transcode:installFfmpeg"), {
        loading: "Installing ffmpeg (first time)…",
        success: "ffmpeg installed",
        error: (e) => `Couldn't install ffmpeg: ${(e as Error).message}`,
      });
      setRetry((r) => r + 1);
    } catch {
      // toast already surfaced the error
    } finally {
      setInstallingFfmpeg(false);
    }
  };

  // Subtitles from put.io → WebVTT blobs → <track> (native CC menu).
  const [tracks, setTracks] = React.useState<{ label: string; lang: string; url: string }[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    setTracks([]);
    (async () => {
      try {
        const { subtitles } = await invoke<{
          subtitles: { key: string; label: string; language: string }[];
        }>("putio:subtitles", { fileId: file.id });
        const loaded: { label: string; lang: string; url: string }[] = [];
        for (const sub of subtitles.slice(0, 8)) {
          try {
            const { vtt } = await invoke<{ vtt: string }>("putio:subtitleVtt", {
              fileId: file.id,
              key: sub.key,
            });
            if (cancelled) break;
            const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
            created.push(url);
            loaded.push({ label: sub.label, lang: sub.language, url });
          } catch {
            // skip a subtitle that fails to load
          }
        }
        if (!cancelled) setTracks(loaded);
      } catch {
        // no subtitles available
      }
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [file.id]);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  // Attach HLS source via hls.js (Chromium lacks native HLS; only route the
  // glaze-hls:// m3u8 URL through this — plain mp4/stream paths are not used
  // here since transcode:start always returns an HLS playlist URL).
  // Cache-bust the URL by audio index so switching tracks reloads the stream.
  const playUrl = src ? `${src}${src.includes("?") ? "&" : "?"}a=${audioIndex}` : null;
  useHlsSource(videoRef, playUrl);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const goFullscreen = () => {
    // Fullscreen the container so the custom control bar stays visible.
    const el = containerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => void })
      | null;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (el.requestFullscreen) {
      el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  };

  // ── Custom control bar state ──────────────────────────────────────────
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [subtitleIndex, setSubtitleIndex] = React.useState(-1);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  // Track fullscreen so portaled menus (subtitles) can render inside the
  // fullscreen element instead of document.body (which isn't painted then).
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  React.useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSubtitleIndex(-1);
  }, [file.id]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  };
  const changeVolume = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = val === 0;
    v.volume = val;
  };

  // When the preview pane holds focus on a video, arrows act as media controls.
  // Left at the very start (or Esc) hands focus back to the browser list.
  const { requestPane } = useKeyboardNav();
  useKeyboardNavOverride(
    "preview",
    (e) => {
      const v = videoRef.current;
      switch (e.key) {
        case "ArrowRight":
          if (v) seek(Math.min((v.currentTime || 0) + 10, duration || v.duration || 0));
          return true;
        case "ArrowLeft":
          if ((v?.currentTime ?? 0) <= 0.5) {
            requestPane("browser");
            return true;
          }
          if (v) seek(Math.max((v.currentTime || 0) - 10, 0));
          return true;
        case "ArrowUp":
          changeVolume(Math.min((v?.volume ?? 1) + 0.1, 1));
          return true;
        case "ArrowDown":
          changeVolume(Math.max((v?.volume ?? 0) - 0.1, 0));
          return true;
        case " ":
        case "Spacebar":
        case "Enter":
          togglePlay();
          return true;
        case "Escape":
          requestPane("browser");
          return true;
        default:
          return false;
      }
    },
    [duration, requestPane],
  );

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  };
  const applySubtitle = (idx: number) => {
    const v = videoRef.current;
    if (v) {
      const tt = v.textTracks;
      for (let i = 0; i < tt.length; i++) tt[i].mode = i === idx ? "showing" : "disabled";
    }
    setSubtitleIndex(idx);
  };

  if (phase === "preparing") {
    return (
      <ScrollArea title={file.name} scrollbars="vertical">
        <div className="p-4">
          <div
            className={cn(
              "relative aspect-video w-full overflow-hidden rounded-xl bg-gray-a3 shadow-lg dark:shadow-none",
              !file.screenshot && "animate-pulse",
            )}
          >
            {file.screenshot && (
              <img
                src={file.screenshot}
                alt=""
                aria-hidden
                className="absolute inset-0 size-full object-cover"
              />
            )}
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center text-callout",
                file.screenshot ? "bg-black/40 text-white" : "text-gray-a10",
              )}
            >
              Preparing video…
            </span>
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (phase !== "ready") {
    return (
      <ScrollArea title={file.name} scrollbars="vertical">
        <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6">
          {phase === "need-ffmpeg" ? (
            <EmptyState
              placement="inline"
              title="One-time setup"
              description="In-app playback transcodes with ffmpeg so any format plays here. Install it to continue."
              actions={
                <Button onClick={installFfmpeg} disabled={installingFfmpeg}>
                  {installingFfmpeg ? "Installing…" : "Install ffmpeg"}
                </Button>
              }
            />
          ) : (
            <EmptyState
              placement="inline"
              title="Couldn't play this file"
              description={errMsg}
              actions={<Button onClick={() => setRetry((r) => r + 1)}>Try again</Button>}
            />
          )}
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea title={file.name} scrollbars="vertical">
      <div className="p-4">
        <div
          ref={containerRef}
          className="group relative w-full overflow-hidden rounded-xl bg-black shadow-lg dark:shadow-none"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
        <video
          ref={videoRef}
          key={file.id}
          preload="metadata"
          onClick={togglePlay}
          onDoubleClick={goFullscreen}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            applySubtitle(subtitleIndex);
            // After an audio-track switch reloaded the stream, restore position.
            const pending = pendingSeekRef.current;
            if (pending) {
              pendingSeekRef.current = null;
              e.currentTarget.currentTime = pending.time;
              if (pending.wasPlaying) e.currentTarget.play().catch(() => {});
            }
          }}
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume);
            setMuted(e.currentTarget.muted);
          }}
          className={cn("block", isFullscreen ? "h-full w-full object-contain" : "w-full")}
        >
          {tracks.map((t) => (
            <track key={t.url} kind="subtitles" src={t.url} label={t.label} srcLang={t.lang} />
          ))}
        </video>

        {/* Bigger put.io thumbnail while idle (before first play); clicks fall
            through to the video to start playback. Gone once playing. */}
        {file.screenshot && !isPlaying && currentTime === 0 && (
          <img
            src={file.screenshot}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
        )}

        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2.5 pt-10 text-white transition-opacity",
            isPlaying && !hovered ? "opacity-0" : "opacity-100",
          )}
        >
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="shrink-0 transition-opacity hover:opacity-80"
              >
                {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
              </button>
              <span className="shrink-0 text-footnote tabular-nums">{formatTime(currentTime)}</span>
              <Slider
                className="flex-1"
                value={[Math.min(currentTime, duration || 0)]}
                min={0}
                max={duration > 0 ? duration : 1}
                step={1}
                onValueChange={([v]) => seek(v)}
              />
              <span className="shrink-0 text-footnote tabular-nums">{formatTime(duration)}</span>
              <button
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className="shrink-0 transition-opacity hover:opacity-80"
              >
                {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>
              <Slider
                className="w-20 shrink-0"
                value={[muted ? 0 : volume]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([v]) => changeVolume(v)}
              />
              {audioTracks.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Audio track"
                      className="shrink-0 transition-opacity hover:opacity-80"
                    >
                      <AudioLines className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="end"
                    portalContainer={isFullscreen ? containerRef.current : undefined}
                  >
                    {audioTracks.map((t, i) => (
                      <DropdownMenuCheckboxItem
                        key={i}
                        checked={audioIndex === i}
                        onCheckedChange={() => selectAudio(i)}
                      >
                        {audioLabel(t, i)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {tracks.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Subtitles"
                      className="shrink-0 transition-opacity hover:opacity-80"
                    >
                      <Captions className={cn("size-5", subtitleIndex >= 0 && "text-blue-9")} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="end"
                    portalContainer={isFullscreen ? containerRef.current : undefined}
                  >
                    <DropdownMenuCheckboxItem
                      checked={subtitleIndex === -1}
                      onCheckedChange={() => applySubtitle(-1)}
                    >
                      Off
                    </DropdownMenuCheckboxItem>
                    {tracks.map((t, i) => (
                      <DropdownMenuCheckboxItem
                        key={t.url}
                        checked={subtitleIndex === i}
                        onCheckedChange={() => applySubtitle(i)}
                      >
                        {t.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <button
                onClick={goFullscreen}
                aria-label="Full screen"
                className="shrink-0 transition-opacity hover:opacity-80"
              >
                <Maximize2 className="size-5" />
              </button>
            </div>
          </div>
        </div>
    </ScrollArea>
  );
}

// ── Non-video previews (audio / image / pdf / text) ───────────────────
function useStreamUrl(fileId: number) {
  return useQuery({
    queryKey: ["putio", "streamUrl", fileId],
    queryFn: () => invoke<{ hls: string; fallback: string }>("putio:streamUrl", { fileId }),
    staleTime: 60 * 1000,
  });
}

function PreviewShell({ file, children }: { file: PutioFile; children: React.ReactNode }) {
  return (
    <ScrollArea title={file.name} scrollbars="vertical">
      <div className="flex min-h-[70vh] flex-col p-4">{children}</div>
    </ScrollArea>
  );
}

function AudioPane({ file }: { file: PutioFile }) {
  const { data, isLoading, error } = useStreamUrl(file.id);
  return (
    <PreviewShell file={file}>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex size-28 items-center justify-center rounded-2xl bg-gray-3">
          <Music className="size-12 text-gray-a10" />
        </div>
        <div className="max-w-md truncate text-center text-body">{file.name}</div>
        {error ? (
          <p className="text-callout text-red-11">{(error as Error).message}</p>
        ) : isLoading || !data ? (
          <p className="text-callout text-gray-a10">Loading…</p>
        ) : (
          <audio controls autoPlay src={data.fallback} className="w-full max-w-md" />
        )}
      </div>
    </PreviewShell>
  );
}

function ImagePane({ file }: { file: PutioFile }) {
  const { data, isLoading, error } = useStreamUrl(file.id);
  return (
    <PreviewShell file={file}>
      <div className="flex flex-1 items-center justify-center">
        {error ? (
          <p className="text-callout text-red-11">{(error as Error).message}</p>
        ) : isLoading || !data ? (
          <p className="text-callout text-gray-a10">Loading…</p>
        ) : (
          <img
            src={data.fallback}
            alt={file.name}
            className="max-h-[78vh] w-auto rounded-lg object-contain shadow-lg dark:shadow-none"
          />
        )}
      </div>
    </PreviewShell>
  );
}

function PdfPane({ file }: { file: PutioFile }) {
  const { data, isLoading, error } = useStreamUrl(file.id);
  return (
    <PreviewShell file={file}>
      {error ? (
        <p className="text-callout text-red-11">{(error as Error).message}</p>
      ) : isLoading || !data ? (
        <p className="text-callout text-gray-a10">Loading…</p>
      ) : (
        <iframe
          src={data.fallback}
          title={file.name}
          className="h-[78vh] w-full rounded-lg border border-gray-a4 bg-white"
        />
      )}
    </PreviewShell>
  );
}

function TextPane({ file }: { file: PutioFile }) {
  const isMarkdown = ["md", "markdown"].includes(fileExt(file.name));
  const { data, isLoading, error } = useQuery({
    queryKey: ["putio", "fileText", file.id],
    queryFn: () => invoke<{ text: string }>("putio:fileText", { fileId: file.id }),
  });
  return (
    <PreviewShell file={file}>
      {error ? (
        <EmptyState
          placement="inline"
          title="Couldn't open this file"
          description={(error as Error).message}
        />
      ) : isLoading ? (
        <p className="text-callout text-gray-a10">Loading…</p>
      ) : isMarkdown ? (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data?.text ?? ""}</ReactMarkdown>
        </article>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-gray-2 p-4 text-footnote leading-relaxed">
          {data?.text}
        </pre>
      )}
    </PreviewShell>
  );
}

function UnsupportedPane({ file }: { file: PutioFile }) {
  return (
    <PreviewShell file={file}>
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          placement="inline"
          title="No preview available"
          description={`“${file.name}” can't be previewed in the app yet.`}
        />
      </div>
    </PreviewShell>
  );
}

// Pick the right pane for the selected file.
function PreviewPane({ file }: { file: PutioFile }) {
  switch (fileKind(file)) {
    case "video":
      return <PlayerPane file={file} />;
    case "audio":
      return <AudioPane file={file} />;
    case "image":
      return <ImagePane file={file} />;
    case "pdf":
      return <PdfPane file={file} />;
    case "text":
      return <TextPane file={file} />;
    default:
      return <UnsupportedPane file={file} />;
  }
}

// ── Main view ─────────────────────────────────────────────────────────
export function LibraryView() {
  const { path, file } = useSearch({ from: "/library" });
  const navigate = useNavigate({ from: "/library" });

  const parent = path.length ? path[path.length - 1].id : 0;

  const listing = useQuery<PutioListing>({
    queryKey: ["putio", "files", parent],
    queryFn: () => invoke<PutioListing>("putio:listFiles", { parentId: parent }),
    // Keep folder contents fresh: newly-completed transfers should show on
    // navigation/refocus without manual refreshing.
    staleTime: 0,
  });

  const files = listing.data?.files ?? [];

  // Keyboard focus: land on the first row on initial load, and after drilling
  // into a folder (when the user is navigating with the keyboard). Never steals
  // focus from another pane or an input.
  React.useEffect(() => {
    if (listing.isLoading) return;
    const active = document.activeElement;
    const inBrowser = !!active?.closest('[data-nav-pane="browser"]');
    const onBody = !active || active === document.body;
    if (!inBrowser && !onBody) return;
    const id = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-nav-pane="browser"] [data-nav-item]')
        ?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [parent, listing.isLoading]);

  // Remember the selected file object so search results (not in the current
  // folder listing) still preview.
  const [selectedFile, setSelectedFile] = React.useState<PutioFile | null>(null);
  const selected =
    selectedFile && selectedFile.id === file
      ? selectedFile
      : (files.find((f) => f.id === file && !f.isFolder) ?? null);

  const open = (item: PutioFile) => {
    if (item.isFolder) {
      // Push into the folder (clears any preview that belongs elsewhere).
      navigate({ search: { path: [...path, { id: item.id, name: item.name }], file: undefined } });
    } else {
      // Keep the browser; preview in the third pane.
      setSelectedFile(item);
      navigate({ search: (prev) => ({ ...prev, file: item.id }) });
    }
  };

  // A search result can live anywhere; jump to its folder or preview it.
  const openSearch = (item: PutioFile) => {
    if (item.isFolder) {
      navigate({ search: { path: [{ id: item.id, name: item.name }], file: undefined } });
    } else {
      setSelectedFile(item);
      navigate({ search: (prev) => ({ ...prev, file: item.id }) });
    }
  };

  // Backspace goes up one folder when not typing (Left is reserved for panes).
  useKeyboardNavOverride(
    "browser",
    (e) => {
      if (e.key === "Backspace" && path.length > 0) {
        navigate({ search: { path: path.slice(0, -1), file: undefined } });
        return true;
      }
      return false;
    },
    [path, navigate],
  );

  // Right-click actions: move (folder picker) + delete (confirm).
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["putio", "files"] });
    queryClient.invalidateQueries({ queryKey: ["putio", "search"] });
  };
  const [deleteTarget, setDeleteTarget] = React.useState<PutioFile | null>(null);
  const [moveTarget, setMoveTarget] = React.useState<PutioFile | null>(null);

  const browser = (
    <BrowserPane
      path={path}
      files={files}
      loading={listing.isLoading}
      error={listing.error as Error | null}
      selectedId={file}
      onOpen={open}
      onOpenSearch={openSearch}
      onMove={setMoveTarget}
      onDelete={setDeleteTarget}
      onBack={() => navigate({ search: { path: path.slice(0, -1), file: undefined } })}
      onRefresh={refresh}
      refreshing={listing.isFetching}
    />
  );

  return (
    <>
      <SplitView
        storageKey="library"
        listSize={{ default: 360, min: 300, max: 460 }}
        list={<NavPane id="browser">{browser}</NavPane>}
      >
        {selected ? (
          <NavPane id="preview">
            <PreviewPane key={selected.id} file={selected} />
          </NavPane>
        ) : (
          <PaneEmptyState
            title="Your put.io library"
            description="Pick a file on the left to preview it here."
          />
        )}
      </SplitView>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete “${deleteTarget.name}”?` : ""}
        description="This moves it to your put.io trash."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await invoke("putio:delete", { fileId: deleteTarget.id });
            toast.success(`Deleted “${deleteTarget.name}”`);
            refresh();
          } catch (e) {
            toast.error(`Couldn't delete: ${(e as Error).message}`);
            throw e;
          }
        }}
      />

      {moveTarget && (
        <MoveDialog
          file={moveTarget}
          onClose={() => setMoveTarget(null)}
          onConfirm={async (destId) => {
            try {
              await invoke("putio:move", { fileId: moveTarget.id, parentId: destId });
              toast.success(`Moved “${moveTarget.name}”`);
              refresh();
              setMoveTarget(null);
            } catch (e) {
              toast.error(`Couldn't move: ${(e as Error).message}`);
              throw e;
            }
          }}
        />
      )}
    </>
  );
}

// ── Move destination picker ───────────────────────────────────────────
function MoveDialog({
  file,
  onClose,
  onConfirm,
}: {
  file: PutioFile;
  onClose: () => void;
  onConfirm: (destParentId: number) => Promise<void>;
}) {
  const [pickPath, setPickPath] = React.useState<PathItem[]>([]);
  const parentId = pickPath.length ? pickPath[pickPath.length - 1].id : 0;
  const dest = pickPath.length ? pickPath[pickPath.length - 1] : { id: 0, name: "Your Files" };

  const listing = useQuery<PutioListing>({
    queryKey: ["putio", "files", parentId],
    queryFn: () => invoke<PutioListing>("putio:listFiles", { parentId }),
    staleTime: 30 * 1000,
  });
  const folders = (listing.data?.files ?? []).filter((f) => f.isFolder && f.id !== file.id);
  const segments: PathItem[] = [{ id: 0, name: "Your Files" }, ...pickPath];

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Move to…"
      description={`Moving “${file.name}”`}
      confirmLabel={`Move to ${dest.name}`}
      onConfirm={() => onConfirm(dest.id)}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-0.5 text-footnote text-gray-a10">
          {segments.map((seg, i) => (
            <React.Fragment key={`${seg.id}-${i}`}>
              {i > 0 && <ChevronRight className="size-3 shrink-0 text-gray-a7" />}
              <button
                onClick={() => setPickPath(pickPath.slice(0, i))}
                className="rounded px-1 hover:bg-gray-a3"
              >
                {seg.name}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="max-h-72 divide-y divide-gray-a3 overflow-auto rounded-lg border border-gray-a4">
          {listing.isLoading ? (
            <div className="p-3 text-callout text-gray-a10">Loading…</div>
          ) : folders.length === 0 ? (
            <div className="p-3 text-callout text-gray-a10">No subfolders here.</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setPickPath([...pickPath, { id: f.id, name: f.name }])}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-a2"
              >
                <FolderGlyph className="size-5 shrink-0 text-blue-11" />
                <span className="min-w-0 flex-1 truncate text-body">{f.name}</span>
                <ChevronRight className="size-4 shrink-0 text-gray-a8" />
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
