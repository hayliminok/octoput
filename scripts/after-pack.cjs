/**
 * electron-builder skips macOS signing (mac.identity: null), which leaves the
 * app bundle with Electron's stale ad-hoc signature — its CodeResources seal no
 * longer matches the modified bundle. On another Mac the quarantine flag makes
 * Gatekeeper validate it, the seal fails, and macOS reports the app as
 * "damaged". Re-signing the wrapper with a valid deep ad-hoc signature fixes the
 * seal so the app runs (after the usual one-time quarantine clear — it's still
 * not Apple-notarized).
 */
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`[after-pack] ad-hoc re-signing ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    stdio: "inherit",
  });
  console.log("[after-pack] signature verified");
};
