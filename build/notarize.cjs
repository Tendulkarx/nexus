/**
 * electron-builder `afterSign` hook — notarizes the signed .app with Apple.
 *
 * This genuinely cannot run without your own paid Apple Developer Program
 * membership and a Developer ID Application certificate installed in your
 * keychain (electron-builder auto-detects and uses it during the `sign`
 * step; this hook only handles the separate *notarization* step that comes
 * after signing). Until you have that, this hook no-ops so local/dev builds
 * (`npm run build:mac`) still work — they just won't be notarized, and macOS
 * Gatekeeper will show an "unidentified developer" warning on other Macs.
 *
 * To enable notarization once you have a Developer ID:
 *   1. Enroll in the Apple Developer Program (developer.apple.com, $99/yr)
 *      and create a "Developer ID Application" certificate in Xcode or the
 *      developer portal; make sure it's installed in your login keychain.
 *   2. Generate an app-specific password at appleid.apple.com for notarization
 *      (Sign-In and Security -> App-Specific Passwords).
 *   3. Set these three environment variables before running `npm run build:mac`:
 *        APPLE_ID=you@example.com
 *        APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
 *        APPLE_TEAM_ID=YOUR10CHARTEAMID
 */
const { notarize } = require("@electron/notarize");

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      "[notarize] Skipping notarization — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set. " +
        "The build will be signed (if you have a Developer ID cert) but not notarized. See build/notarize.js for setup.",
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  console.log(`[notarize] Submitting ${appName} to Apple for notarization — this can take several minutes...`);

  await notarize({
    appBundleId: "com.oneilblake.nexus",
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log(`[notarize] Done.`);
};
