# Source Origins

This document maps every source file in the Bear Box desktop project to its origin.

| Path | Origin | License | Notes |
|---|---|---|---|
| `app/src/backend/config.js` | Original Bear Box code, with field mapping referenced from JiajiaBox smali/addon-src | MIT | sing-box 1.14 config builder; tag names follow JiajiaBox's ConfigBuilderKt |
| `app/src/backend/core.js` | Original Bear Box code | MIT | Kernel process management + Clash API polling |
| `app/src/backend/links.js` | Original Bear Box code, field mapping cross-checked against JiajiaBox | MIT | Share-link parsers (vmess/vless/trojan/etc.) |
| `app/src/backend/subscription.js` | Original Bear Box code | MIT | Subscription format parsers |
| `app/src/backend/service.js` | Original Bear Box code | MIT | All app logic |
| `app/src/backend/store.js` | Original Bear Box code | MIT | JSON persistence |
| `app/src/backend/sysproxy.js` | Original Bear Box code | MIT | Windows registry system proxy |
| `app/src/backend/geo.js` | Original Bear Box code; DoH fallback logic | MIT | ip.sb / ip.net.coffee geo queries |
| `app/src/main.js` | Original Bear Box code | MIT | Electron main process |
| `app/src/preload.js` | Original Bear Box code | MIT | IPC bridge |
| `app/src/renderer/app.js` | Original Bear Box code | MIT | App shell, navigation, theme |
| `app/src/renderer/app.css` | Original Bear Box code | MIT | Design system |
| `app/src/renderer/charts.js` | Original Bear Box code | MIT | Canvas charts |
| `app/src/renderer/pages.js` | Original Bear Box code | MIT | All page layouts |
| `app/src/renderer/util.js` | Original Bear Box code | MIT | DOM helpers, formatters |
| `app/src/renderer/globe/globe.js` | **Ported from JiajiaBox Android** (assets/globe/index.html) | MIT (original by weilai090624-code) | Modified: factory pattern, texture path resolution, destroy() |
| `app/src/renderer/globe/*.webp` | **From JiajiaBox Android** (assets/globe/) | CC BY 4.0 (textures) | Earth day/night/clouds textures |
| `app/src/renderer/globe/NOTICE.txt` | **From JiajiaBox Android** | — | Globe attribution notice |
| `app/core/sing-box-windows-amd64.exe` | Compiled from JiajiaBox fork of sing-box | GPL-3.0 | Proxy kernel binary |
| `app/core/wintun.dll` | From WireGuard project | MIT | TUN driver |
| `app/geo/world.geo.json` | From johan/world.geo.json (Natural Earth data) | Public domain | Country outlines |

## Summary

- **Original Bear Box code**: ~95% of the codebase (all Electron/Node.js/HTML/CSS)
- **Ported from JiajiaBox**: globe renderer + textures (~3%)
- **Compiled binaries**: sing-box kernel + wintun driver (~2% by file count, 45MB by size)
