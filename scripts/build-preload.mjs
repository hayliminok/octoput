import { build } from "esbuild";
await build({
  entryPoints: ["renderer/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // .cjs (not .js) so Electron's CommonJS preload loader can require() it even
  // though package.json sets "type": "module" (which would treat .js as ESM).
  outfile: "build/preload.cjs",
  external: ["electron"],
  // No sourcemap in the packaged build (avoids embedding absolute source paths).
  sourcemap: false,
});
console.log("built build/preload.cjs");
