# Bundled Jackett

octoput runs a bundled [Jackett](https://github.com/Jackett/Jackett) server as a
local Torznab provider for the "Jackett" search source.

Drop the platform-specific Jackett build here, in a `<platform>-<arch>` folder, so
the executable lands at:

```
resources/jackett/darwin-arm64/jackett        # macOS Apple Silicon
resources/jackett/darwin-x64/jackett           # macOS Intel
resources/jackett/win32-x64/jackett.exe        # Windows
```

Get the self-contained build from Jackett's GitHub releases
(`Jackett.Binaries.macOSARM64.tar.gz` for darwin-arm64) and extract it so the
`jackett` executable (plus its DLLs) sit directly in the arch folder.

These builds are large (~100 MB, bundles the .NET runtime) so they're gitignored
and treated as build-time artifacts — place them before `npm run package`.

Notes:
- Jackett is GPLv2. Redistribution is fine; source is at the link above.
- On first run octoput auto-configures a curated set of public, no-auth indexers
  and points `--DataFolder` at the app's userData dir.
- It's spawned on demand (when you connect/search the Jackett source) and killed
  on quit.
