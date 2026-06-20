import { build } from "esbuild";
await build({
  entryPoints: ["main/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "build/main/index.js",
  external: ["electron", "@ffmpeg-installer/*", "@ffprobe-installer/*"],
  // Provide a CJS `require` shim for ESM-on-node. Alias the import so it can't
  // collide with source files that also `import { createRequire } from "module"`
  // (e.g. transcode.ts), which would be a duplicate-declaration SyntaxError.
  banner: { js: "import{createRequire as __cjsRequire}from'module';const require=__cjsRequire(import.meta.url);" },
  // No sourcemap in the packaged build: esbuild sourcemaps embed absolute
  // source paths (/Users/<name>/…), which would leak into the distributed app.
  sourcemap: false,
});
console.log("built build/main/index.js");
