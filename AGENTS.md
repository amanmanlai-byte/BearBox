# JiajiaBox Windows desktop client: handoff for coding agents

## Goal
Windows 10/11 desktop proxy client built from the user's JiajiaBox Android project (apktool decompile + Go sources in native-src/).
Keep the original project's capabilities, redesign the UI, show real data only. Never fake numbers; if data is unavailable, say so in the UI.
The kernel MUST be the one compiled from the user's own source: native-src/sing-box (version 1.14.3-Jiajia-7). Never swap in an official sing-box release.
Never overwrite the original sources. Work only under windows/ on branch windows-port.

## Layout
- windows/app/            Electron app (JavaScript, no bundler). Run: npm install, npm start. Test: npm test (36 tests, needs core/sing-box-windows-amd64.exe on Windows)
- windows/app/src/backend Node backend with no Electron imports: links.js (share links), subscription.js (base64/clash yaml/sing-box json), config.js (sing-box 1.14 config builder + describeRule for the rules UI), core.js (process + Clash API polling, mapConnection), sysproxy.js (Windows registry + WinINet refresh), store.js, service.js (all app logic + subscription auto-update)
- windows/app/src/main.js, preload.js   thin IPC wiring (single channel 'jj', handlers map in main.js); tray icon, close-to-tray, UAC elevation for TUN
- windows/app/src/renderer  8 pages in pages.js, hand drawn canvas charts in charts.js (SpeedChart/DailyBars with hover tooltips, drawDonut, drawSpark), design system in app.css (light + dark via [data-theme]), CSP is default-src 'self' (no inline styles; use element.style assignment)
- windows/app/tools/make-icons.js  zero-dep icon generator (writes assets/icon.ico + icon.png + tray.png)
- windows/kernel-build/   scripts and notes used to compile the kernel (needs Go, see README there)
- Kernel binaries are not in git: put sing-box-windows-amd64.exe in windows/app/core/

## Done and verified on a real Windows 10/11 machine (v0.2.2, Oct 2026)
41 automated tests pass: share link parsing (vmess, vless incl. reality, trojan, ss incl. obfs, hysteria2, tuic, socks, http), subscription formats,
config generation accepted by `sing-box check` (all protocols, rule/global mode, custom rules incl. per-process rules, TUN inbound, bundled local
rule-sets), real traffic through a selected node, node switching, speed/connection/memory/daily traffic stats, URL delay test on Windows incl. the
temp-start path (core auto-starts for testing when stopped, no system proxy touched, stops afterwards), rule edit restarts core, port conflict error,
Windows system proxy set/restore + crash recovery, subscription auto-update timer, UI-only settings never restart the core, legacy test-URL migration.
UI verified with DOM probes (0 JS errors on all 8 pages) and screenshots in both themes, plus a live run with real traffic (speed curve 6.39MB/s peak,
connections table with real flows, per-process ranking identifying curl.exe). Packaged exe smoke tested (boots, renders, exits cleanly).

## NOT verified on real Windows yet
1. TUN mode end to end: preflight (wintun.dll present, admin check) and UAC elevation flow are implemented and unit tested; actually creating the
   adapter needs a run as administrator on the target machine.
2. Installer (only a portable folder exists), code signing, start with Windows.

## Not implemented compared with the Android app (check the smali/addon-src for exact behavior; NOT included in this handoff zip)
SSH, WireGuard, AnyTLS, ShadowTLS, Naive, Hysteria v1, Mieru, chain proxy, custom JSON config nodes, GeoIP/GeoSite asset management, STUN tool,
DNS settings beyond remote/direct (fakeip, DNS rules), globe/geo view. Per-app proxy is covered on Windows by process_name rules (rule editor field).
Node edit/create forms and node sorting beyond the three orders are not implemented (sorting: default/latency/name).

## Gotchas learned (all verified on real Windows)
- CONFIRMED v0.2.2: in rule mode the kernel BLOCKS startup until remote rule-sets download; when GitHub is
  unreachable (typical CN network) the core FATALs and never starts. Fixed by bundling local rule-set files
  in app/ruleset (geosite-cn.srs, geoip-cn.srs, downloaded once via a working proxy); buildConfig prefers
  local rule-sets and falls back to remote with a warning when the files are missing.
- The Jiajia Clash API ignores http:// test URLs in /proxies/{tag}/delay; enforced in service.setSettings.
- URL tests: service.testNodes temp-starts the core (start({forTest:true}), no system proxy) when it is
  stopped and stops it afterwards; TCP connect timing is only a fallback with an explicit notice.
- The kernel's URLTest client does NOT read SSL_CERT_FILE on Windows (uses the OS cert store). The e2e test installs the
  self-signed fixture CA into CurrentUser\Root via certutil for the run and removes it after. Plan around this if you change delay tests.
- e2e curl children need a stripped proxy env: the dev shell exports NO_PROXY=127.0.0.1 which silently bypasses the explicit -x proxy,
  and native curl cannot write /dev/null (use a temp file).
- MSYS/Git Bash converts /CN=... to a path for openssl (use MSYS_NO_PATHCONV=1); a bash pipe like `| tail` hides output until exit.
- node_modules/electron/path.txt is lost when node_modules is copied: write "electron.exe" into it (no trailing newline).
- Fresh core counters start at 0; Core.start sets the poll baseline to zero (otherwise early traffic is lost).
- Subscription node names are untrusted: render with textContent only (util.js h()).
- Building the kernel in a restricted network: kernel-build/mkmod.py writes an overlay go.mod (via -modfile) with GitHub mirror replaces.
- Do not report anything as working unless it was run. Keep the verified/unverified lists above up to date.

## Conventions
Simplified Chinese UI text. No em dashes in user facing text. Keep backend free of Electron imports so it stays testable.
Add a test for every backend change. Renderer is verified by screenshots + DOM probes (JIAJIA_SHOT_DIR / JIAJIA_SHOT_PAGES env hooks in main.js).

## Rebuild / package
cd windows/app && npm install && npm test && npm run pack:win   (icon: npm run icons; output: windows/dist/JiajiaBox-win32-x64)
Release zip convention: JiajiaBox-win32-x64-<version>.zip with 使用说明.txt inside the folder.
