# Third-Party Notices

This file lists all third-party components actually bundled or used by Bear Box.
Last reviewed: 2026-10-26. Maintained by tools/license-check.js (semi-automated; human review required).

## Bundled runtime dependencies

| Component | Version | License | Authors / Maintainers | Source | Usage |
|---|---|---|---|---|---|
| sing-box (JiajiaBox fork) | 1.14.3-Jiajia-7 | GPL-3.0 | SagerNet / nekohasekai; JiajiaBox fork by weilai090624-code | https://github.com/SagerNet/sing-box | Proxy kernel binary (core/sing-box-windows-amd64.exe). Process-isolated, communicates via Clash API. |
| wintun | 0.14.1 | MIT | WireGuard project (Jason A. Donenfeld) | https://www.wintun.net/ | TUN virtual network adapter driver DLL. Loaded by the kernel for TUN mode. |
| Electron | ^33.2.0 | MIT | Electron contributors | https://www.electronjs.org/ | Desktop application framework (Chromium + Node.js runtime). |
| js-yaml | ^4.1.0 | MIT | Vladimir Zapparov | https://github.com/nodeca/js-yaml | Clash YAML subscription parsing. |

## Ported / embedded assets

| Component | License | Authors | Source | Usage |
|---|---|---|---|---|
| 3D WebGL globe renderer | MIT | weilai090624-code (JiajiaBox project) | https://github.com/weilai090624-code/JiajiaBox (assets/globe/) | Ported from Android WebView to desktop; modified for factory pattern and texture path resolution. |
| Earth textures (day/night/clouds) | CC BY 4.0 | Solar System Scope / INOVE | https://www.solarsystemscope.com/textures/ | Bundled as WebP for the 3D globe. |
| World map GeoJSON (110m) | Public domain (Natural Earth) | Natural Earth / johan | https://github.com/johan/world.geo.json | Country outlines for the flat map view. |

## Build-time dependencies (not bundled in the release)

| Component | Version | License | Source | Usage |
|---|---|---|---|---|
| @electron/packager | ^18.3.6 | MIT | Electron contributors | https://github.com/electron/packager | Packaging the Windows build. |

## Upstream projects

| Project | License | Relationship |
|---|---|---|
| JiajiaBox (Android) | MIT | Original project this desktop port is based on. Node names, config builder field mapping, and globe renderer are ported from it. |
| SagerNet / NekoBox | GPL-3.0 | Upstream of both JiajiaBox and the sing-box kernel. |
| sing-box | GPL-3.0 | Proxy kernel upstream. The JiajiaBox fork adds custom features (Jiajia Clash API, CN rule-sets). |

## Kernel GPL-3.0 compliance note

The sing-box kernel binary is statically linked (Go) and licensed under GPL-3.0.
It runs as a SEPARATE PROCESS and communicates with this application via HTTP
(Clash API on 127.0.0.1). This process isolation means the kernel's GPL-3.0
does not automatically apply to the Bear Box application code (which is MIT).

However, DISTRIBUTING the kernel binary together with this application means:
- The kernel's complete corresponding source code MUST be available.
- The JiajiaBox fork's source is available at
  https://github.com/weilai090624-code/JiajiaBox (native-src/sing-box/).
- The upstream sing-box source is available at https://github.com/SagerNet/sing-box.

If you modify the kernel source and distribute the modified binary, you MUST
make the modified source available under GPL-3.0.
