# JiajiaBox Windows desktop client: handoff for coding agents

## Goal
Windows 10/11 desktop proxy client built from the user's JiajiaBox Android project (apktool decompile + Go sources in native-src/).
Keep the original project's capabilities, redesign the UI, show real data only. Never fake numbers; if data is unavailable, say so in the UI.
The kernel MUST be the one compiled from the user's own source: native-src/sing-box (version 1.14.3-Jiajia-7). Never swap in an official sing-box release.
Never overwrite the original sources. Work only under windows/ on branch windows-port.

## Layout
- windows/app/            Electron app (JavaScript, no bundler). Run: npm install, npm start. Test: npm test (26 tests, needs core/sing-box-linux-amd64 on Linux or sing-box-windows-amd64.exe on Windows)
- windows/app/src/backend Node backend with no Electron imports: links.js (share links), subscription.js (base64/clash yaml/sing-box json), config.js (sing-box 1.14 config builder), core.js (process + Clash API polling), sysproxy.js (Windows registry + WinINet refresh), store.js, service.js (all app logic)
- windows/app/src/main.js, preload.js   thin IPC wiring (single channel 'jj', handlers map in main.js)
- windows/app/src/renderer              8 pages in pages.js, hand drawn canvas charts in charts.js, CSP is default-src 'self' (no inline styles; use element.style assignment)
- windows/kernel-build/   scripts and notes used to compile the kernel (needs Go, see README there)
- Kernel binaries are not in git: put sing-box-windows-amd64.exe in windows/app/core/

## Reference material inside the original project (read these before implementing missing features)
- smali*/io/nekohasekai/sagernet/fmt/*   per-protocol beans and ConfigBuilderKt (Android config builder, legacy format)
- addon-src/io/nekohasekai/sagernet/ui/NativeCoreConfig.java   legacy config to 1.14 migration, best field reference
- addon-src/.../DnsIpRouting, RoutingFallback, AiRoutingDomains, TelegramRouting, SubscriptionDownload, SubscriptionInfo, ConnectionInspector, AppTrafficRanking, LifetimeTraffic   Jiajia specific logic in readable Java
- res/xml/global_preferences.xml, route_preferences.xml, group_preferences.xml and res/values-zh-rCN/strings.xml   full settings inventory with defaults
- native-src/libcore (Go bridge, config_compat.go), native-src/sing-box/experimental/clashapi (API used for live data)

## Done and verified (Linux sandbox, real kernel built from the user's source)
Share link parsing (vmess, vless incl. reality, trojan, ss incl. obfs plugin, hysteria2, tuic, socks, http), subscription formats, config generation accepted by `sing-box check`
(all protocols, rule/global mode, custom rules, TUN inbound), real traffic through a selected node, node switching, speed/connection/memory/daily traffic stats,
per node HTTPS delay test, rule edit restarts core, port conflict error, UI render of all 8 pages (screenshots under Electron + xvfb).

## NOT verified on real Windows (top priority for you, you can run Windows)
1. Windows system proxy: sysproxy.js writes HKCU Internet Settings and calls InternetSetOption via PowerShell. Only tested with a fake exec. Verify enable, disable, restore of previous values, and crash recovery (service.init).
2. TUN mode: config passes `check`, but running needs admin rights and wintun.dll next to the exe. golang.zx2c4.com/wintun was replaced by github.com/MetaCubeX/wintun-go (see kernel-build/WINTUN_COMMIT.txt). Verify it really creates the adapter; add an admin elevation flow and a clear error when not elevated.
3. Core process stop on Windows (Core.stop uses p.kill()), no orphan sing-box.exe after the app exits or crashes.
4. Rule mode downloads remote rule sets (SagerNet sing-geosite/sing-geoip) through the 'proxy' outbound at startup. If the node is dead or GitHub is blocked, startup may fail. Needs a better strategy (cache, fallback, local files; the original project ships geoip/geosite assets, check how Jiajia's custom core consumes them).
5. Packaging: only a portable folder exists (electron-packager). Add a real installer, icon, app signing notes, tray icon, close-to-tray, start with Windows, single instance behavior check.

## Not implemented compared with the Android app (do these after the above, check the smali/addon-src for exact behavior)
SSH, WireGuard, AnyTLS, ShadowTLS, Naive, Hysteria v1, Mieru, chain proxy, custom JSON config nodes, per-app proxy (Windows equivalent: process_name rules), GeoIP/GeoSite asset management,
subscription auto update and subscription group settings (group_preferences.xml), STUN tool, DNS settings beyond remote/direct (fakeip, DNS rules), route rule fields from route_preferences.xml,
node edit/create forms, node sorting, traffic ranking per app/process (see AppTrafficRanking.java), lifetime traffic, globe/geo view (Jiajia clashapi has globe.go).

## Gotchas learned
- The Jiajia Clash API ignores http:// test URLs in /proxies/{tag}/delay (clashapi/proxies.go). Test URL must be https://, enforced in service.setSettings.
- Fresh core counters start at 0; Core.start sets the poll baseline to zero (otherwise early traffic is lost).
- Subscription node names are untrusted: render with textContent only (util.js h()).
- Building the kernel in a restricted network: golang.org and proxy.golang.org may be unreachable. kernel-build/mkmod.py writes an overlay go.mod (via -modfile) with GitHub mirror replaces. On a normal network you can build directly: see native-src/build.sh for tags (with_conntrack,with_gvisor,with_quic,with_wireguard,with_utls,with_clash_api), GOOS=windows GOARCH=amd64 CGO_ENABLED=0.
- Do not report anything as working unless it was run. Keep the verified/unverified lists above up to date.

## Conventions
Simplified Chinese UI text. No em dashes in user facing text. Keep backend free of Electron imports so it stays testable. Add a test for every backend change.
