import { spawn } from "node:child_process";
import { build } from "esbuild";
import waitOn from "wait-on";

await Promise.all([
  build({ entryPoints: ["main/index.ts"], bundle: true, platform: "node",
    format: "esm", target: "node20", outfile: "build/main/index.js",
    external: ["electron", "@ffmpeg-installer/*", "@ffprobe-installer/*"],
    banner: { js: "import{createRequire as __cjsRequire}from'module';const require=__cjsRequire(import.meta.url);" } }),
  build({ entryPoints: ["renderer/preload.ts"], bundle: true, platform: "node",
    format: "cjs", target: "node20", outfile: "build/preload.cjs", external: ["electron"] }),
]);

const vite = spawn("npx", ["vite", "--port", "5173", "--strictPort"], { stdio: "inherit", shell: true });

let electron;
const die = () => { vite.kill(); electron?.kill(); process.exit(); };
vite.on("exit", die);
process.on("SIGINT", die);

await waitOn({ resources: ["http-get://localhost:5173"], timeout: 30000 });

electron = spawn("npx", ["electron", "."], {
  stdio: "inherit", shell: true,
  env: { ...process.env, OCTOPUT_DEV_SERVER: "1" },
});
electron.on("exit", die);
