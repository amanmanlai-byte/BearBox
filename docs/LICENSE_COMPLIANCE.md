# License Compliance Report

**Review date:** 2026-10-26
**Reviewer:** Automated scan + human review
**Scope:** Bear Box desktop application (all source code, bundled binaries, assets, and dependencies)

## Executive summary

| Layer | License | Status |
|---|---|---|
| Bear Box desktop app (Electron + Node.js) | MIT | Clean. Original code + MIT-licensed port from JiajiaBox. |
| sing-box kernel binary | GPL-3.0 | Separate process. Source available. Distribution requires source availability (satisfied). |
| js-yaml (npm dependency) | MIT | Clean. |
| Electron (npm dependency) | MIT | Clean. |
| 3D globe renderer (ported) | MIT | Clean. Copyright and license preserved in globe/NOTICE.txt and source header. |
| Earth textures (WebP) | CC BY 4.0 | Attribution required. Present in globe/NOTICE.txt and About page. |
| World map GeoJSON | Public domain | Clean. |

**No GPL-3.0 compliance violations found** in the current codebase. The GPL-3.0 kernel is process-isolated and its source is publicly available through the JiajiaBox fork and upstream sing-box repositories.

## Evidence

### Original JiajiaBox project license

- File: `LICENSE` in the JiajiaBox repository → **MIT License**
- Copyright: `Copyright (c) 2026 weilai090624-code`
- Evidence: LICENSE file text, README.md (no GPL mention), source file headers (MIT-style)

### sing-box kernel license

- File: `native-src/sing-box/LICENSE` in the JiajiaBox repository → **GPL-3.0**
- Copyright: `Copyright (C) 2022 by nekohasekai <contact-sagernet@sekai.icu>`
- Evidence: LICENSE file text (GPL-3.0 full text), go.mod module path `github.com/sagernet/sing-box`

### libcore license

- File: `native-src/libcore/LICENSE` → **GPL-3.0**
- Copyright: `Copyright (C) 2021 by nekohasekai`

### Process isolation

The kernel runs as a separate process (`sing-box-windows-amd64.exe`) and communicates
with the Bear Box application exclusively via HTTP (Clash API on 127.0.0.1).
There is no static or dynamic linking between the kernel and the Electron app.

This means the kernel's GPL-3.0 **does not automatically extend** to the MIT-licensed
Bear Box application code. However, **distributing the kernel binary alongside the app**
requires that the kernel's corresponding source code be available (GPL-3.0 §3),
which is satisfied by the public JiajiaBox fork and upstream sing-box repositories.

## Issues found and fixed

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | LICENSE file was missing from the desktop project root | Medium | ✅ Fixed: created LICENSE with MIT + kernel GPL-3.0 note |
| 2 | NOTICE file was missing | Low | ✅ Fixed: created NOTICE with all required attributions |
| 3 | THIRD_PARTY_NOTICES.md was missing | Medium | ✅ Fixed: created with all bundled components |
| 4 | Original project's MIT license was not mentioned anywhere in the desktop app | Low | ✅ Fixed: About page credits the original project |
| 5 | Globe renderer copyright notice was only in globe/NOTICE.txt (easy to miss) | Low | ✅ Already present; About page now credits it too |

## Remaining risks and pending items

| # | Risk | Severity | Action needed |
|---|---|---|---|
| 1 | The desktop project's GitHub repository URL is not yet determined | Low | User must create a repo and fill in the URL (About page shows 待填写) |
| 2 | No code signing certificate (SmartScreen will warn) | Low | User must purchase a certificate or accept the warning |
| 3 | wintun.dll license text is not bundled | Low | Add wintun's MIT license text to THIRD_PARTY_NOTICES or distribution |
| 4 | Chromium licensing (inside Electron) is complex; the full Chromium LICENSES.chromium.html is not included in the zip | Low | Electron's packager should include it; verify in the release zip |

## What would trigger GPL-3.0 obligations

If you modify the **sing-box kernel source code** and distribute the modified binary,
you MUST make your modified source code available under GPL-3.0. This does not apply
to the Bear Box application code (which is MIT and process-isolated from the kernel).

## What is NOT required

- You are NOT required to release Bear Box application source under GPL-3.0.
- You are NOT required to open-source your project (MIT allows private use and distribution).
- You are NOT required to obtain permission from the original authors (MIT and GPL-3.0 grant these rights).

## Legal disclaimer

This review is based on automated scanning and manual code inspection. It is not legal advice.
For formal distribution or commercial use, consult a qualified legal professional.
