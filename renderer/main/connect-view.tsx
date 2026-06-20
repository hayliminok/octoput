import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@ui";
import { Cloud, ExternalLink, Loader2 } from "lucide-react";

const invoke = window.glazeAPI.glaze.ipc.invoke;
const openExternal = window.glazeAPI.shell.openExternal;

interface AuthStatus {
  putio: boolean;
}

interface LinkInfo {
  code?: string;
  putioUrl?: string;
}

export function ConnectView() {
  const [linking, setLinking] = React.useState(false);
  const [info, setInfo] = React.useState<LinkInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Shares the ["auth","status"] cache with the root gate; polling here lets the
  // gate release automatically once the browser approval completes.
  useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => invoke<AuthStatus>("auth:status"),
    refetchInterval: linking ? 2500 : false,
  });

  // Stop any in-flight CLI login processes if the user leaves this screen.
  React.useEffect(() => {
    return () => {
      invoke("auth:cancelLink").catch(() => {});
    };
  }, []);

  const openLinks = async (result: LinkInfo) => {
    if (result.putioUrl) await openExternal(result.putioUrl);
  };

  const connect = async () => {
    setError(null);
    setLinking(true);
    try {
      console.log("[ConnectView:beginLink]");
      const result = await invoke<LinkInfo>("auth:beginLink");
      setInfo(result);
      await openLinks(result);
    } catch (e) {
      console.log("[ConnectView:beginLink] error", { message: (e as Error).message });
      setError((e as Error).message);
      setLinking(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-blue-9 shadow-lg">
          <Cloud className="size-8 text-white" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-title1">Connect your put.io account</h1>
          <p className="text-body text-gray-a11">
            Sign in once with put.io to search for torrents and stream your library.
          </p>
        </div>

        {error && <p className="text-callout text-red-11">{error}</p>}

        {!linking ? (
          <Button variant="accent" size="large" onClick={connect}>
            <Cloud className="size-4.5" />
            Connect put.io
          </Button>
        ) : (
          <div className="flex w-full flex-col items-center gap-5">
            {info?.code && (
              <div className="flex flex-col items-center gap-2">
                <span className="text-footnote text-gray-a10">Enter this code at put.io</span>
                <div className="rounded-xl bg-gray-2 px-6 py-3 text-title2 font-semibold tracking-[0.3em] tabular-nums">
                  {info.code}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-callout text-gray-a11">
              <Loader2 className="size-4 animate-spin text-gray-9" />
              Waiting for you to approve in your browser…
            </div>

            {info?.putioUrl && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="filled" onClick={() => openExternal(info.putioUrl!)}>
                  <ExternalLink className="size-4" />
                  Open put.io
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
