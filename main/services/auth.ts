/**
 * Auth / onboarding service
 *
 * The `putio` CLI authenticates against put.io via a device-code flow
 * (https://app.put.io/link?code=XXXX). This service starts the flow when
 * needed, surfaces the URL/code to the UI, keeps the CLI process alive until
 * the browser approval completes, and reports auth status so the app can gate
 * behind a single onboarding.
 */

import { execFile, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";

import { logger } from "../platform/backend.js";
import { resolveCli } from "./cli-paths.js";

const execFileAsync = promisify(execFile);

import { putioService } from "./putio.js";

const ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` };

export interface AuthStatus {
  putio: boolean;
}

export interface LinkInfo {
  /** put.io device-code (only present when the put.io flow is running). */
  code?: string;
  /** URL to open in the browser to approve put.io access. */
  putioUrl?: string;
}

interface Flow {
  proc: ChildProcess;
  url?: string;
  code?: string;
}

let putioFlow: Flow | null = null;

function killFlow(flow: Flow | null) {
  if (flow) {
    try {
      flow.proc.kill();
    } catch {
      // already gone
    }
  }
}

/**
 * Spawn a CLI login command and resolve once the auth URL is printed.
 * The process is kept alive (the caller stores it) so the browser callback can
 * complete; it exits on its own once the user approves.
 */
function startFlow(
  command: string,
  args: string[],
  urlPattern: RegExp,
  codePattern: RegExp | null,
  label: string,
): Promise<Flow> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { env: ENV });
    const flow: Flow = { proc };
    let buffer = "";
    let settled = false;

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const urlMatch = buffer.match(urlPattern);
      if (urlMatch && !flow.url) {
        flow.url = urlMatch[0];
        if (codePattern) {
          const codeMatch = buffer.match(codePattern);
          if (codeMatch) flow.code = codeMatch[1];
        }
        if (!settled) {
          settled = true;
          logger.info("auth", `${label} login URL captured`, { code: flow.code });
          resolve(flow);
        }
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", (err) => {
      logger.error("auth", `${label} login failed to start`, err);
      if (!settled) {
        settled = true;
        reject(new Error(`Could not start ${label} login: ${err.message}`));
      }
    });
    proc.on("close", (exitCode) => {
      logger.info("auth", `${label} login process exited`, { exitCode });
      if (!settled) {
        settled = true;
        reject(new Error(`${label} login ended before producing a link`));
      }
    });
  });
}

export const authService = {
  /** put.io auth status. */
  async status(): Promise<AuthStatus> {
    const putio = await putioService
      .authStatus()
      .then((s) => s.authenticated)
      .catch(() => false);
    return { putio };
  },

  /**
   * Begin linking put.io if it isn't authenticated, returning the URL/code to
   * present. The process stays alive until the browser approval completes.
   */
  async beginLink(): Promise<LinkInfo> {
    const status = await authService.status();
    const info: LinkInfo = {};

    if (!status.putio) {
      killFlow(putioFlow);
      putioFlow = await startFlow(
        resolveCli("putio"),
        ["auth", "login", "--timeout-seconds", "600", "--output", "json"],
        /https:\/\/app\.put\.io\/link\?code=[A-Z0-9]+/i,
        /code:\s*([A-Z0-9]+)/i,
        "put.io",
      );
      info.putioUrl = putioFlow.url;
      info.code = putioFlow.code;
    }

    return info;
  },

  /** Stop any in-flight login process (e.g. user navigated away). */
  cancelLink(): void {
    killFlow(putioFlow);
    putioFlow = null;
  },

  /** Sign out of put.io. */
  async logout(): Promise<void> {
    authService.cancelLink();
    await Promise.allSettled([
      execFileAsync(resolveCli("putio"), ["auth", "logout", "--output", "json"], { env: ENV }),
    ]);
    logger.info("auth", "logged out of put.io");
  },
};
