# Bundled CLI Binaries

This directory holds bundled CLI binaries used by the Electron app at runtime.

## Directory layout

```
resources/bin/<platform>-<arch>/putio
```

Example: `resources/bin/darwin-arm64/putio`

## Binaries

| Binary  | Source repo              | How to build                  |
|---------|--------------------------|-------------------------------|
| `putio` | putio-cli (TypeScript)   | `bun build --compile`         |

## Resolution logic

`resolveCli()` in `main/services/cli-paths.ts` resolves binaries as follows:

1. In a packaged app (`app.isPackaged`): looks in `process.resourcesPath/bin/<platform>-<arch>/`.
2. In development: looks in `<appPath>/resources/bin/<platform>-<arch>/` (this directory).
3. If the bundled binary is absent, falls back to the name as-is so the OS resolves it from `PATH` — useful for dev machines with `brew install`ed CLIs.

Binaries in this directory are **not committed to git** (they are large platform-specific executables). They are produced as part of the release build pipeline and placed here before `electron-builder` packages the app.
