# Bear Box desktop maintenance

Windows Electron app, no bundler. Backend: src/backend; IPC: src/main.js and preload.js; UI: src/renderer. Runtime YAML dependency: js-yaml 4.3.2 and argparse 2.0.1. Read THIRD_PARTY_NOTICES.md before redistributing.

Keep the user's custom sing-box 1.14.3-Jiajia-7 binary. Do not substitute upstream releases. Do not edit unrelated original source trees or user credentials. Render untrusted text through textContent/h(). No invented IPs, countries, counters or test results. Simplified Chinese UI. Use existing components and CSS theme variables; avoid unrelated restructuring.

For backend changes add meaningful tests. Run npm test from this directory with the original core binary available. Renderer probe scripts are executed with the Electron test hooks; an injected composition-event probe does not prove behavior of every installed native IME. Never claim native TUN, interactive dragging or public Internet endpoints were verified if only configuration/mocks were tested.

Current choices: TUN defaults off with a one-time legacy migration; forest colors are fixed; simple theme colors are customizable; brightness veil and standalone window blur are removed. Fully quitting disables the current user's Windows manual proxy even if the client did not enable it. Close-to-tray is not full quit.

Portable user data contains secrets. Do not publish trial-data or run cleanup scripts against arbitrary paths. Keep necessary Electron/Chromium licenses and dependency notices. Kernel corresponding source, ruleset provenance and artwork rights remain unresolved until evidence is supplied; do not convert these statements into compliance claims.
