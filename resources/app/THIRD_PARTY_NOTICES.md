# 第三方组件与许可核对

核对日期：2026-10-28。本文按本次便携包的实际文件编写。根目录 LICENSE 仅用于 Bear Box 桌面端中有权按 MIT 授权的代码，不能替代下列组件的许可。许可证原文位于 [licenses](licenses/)。本文件不是“所有授权已齐全”的证明。

| 组件/文件 | 实际版本或来源 | 许可与证据 |
| --- | --- | --- |
| Bear Box 桌面代码 | 0.3.0-preview.2，本地修订 | [MIT](LICENSE)，保留原作者与 Bear Box contributors 署名；不覆盖第三方素材 |
| JiajiaBox 衍生代码、地球渲染来源 | 包内历史来源记录；未核实完整对应提交 | [原始 MIT 文本](licenses/JiajiaBox-MIT.txt)，Copyright (c) 2026 weilai090624-code |
| Electron | 根目录 version 文件：33.2.0 | [Electron MIT](licenses/Electron-MIT.txt)；Chromium 及其依赖另见便携包根目录 LICENSES.chromium.html，必须随分发保留 |
| js-yaml | node_modules/package.json：4.3.2 | [MIT](licenses/js-yaml-MIT.txt)，Copyright (C) 2011-2015 Vitaly Puzrin |
| argparse | node_modules/package.json：2.0.1 | [Python-2.0 及历史条款](licenses/argparse-Python-2.0.txt)，保留包内原文 |
| sing-box 自定义内核 | 1.14.3-Jiajia-7，revision 4067f53d0881437092454817ebfd2c448f8b1d97 | 上游 GPL-3.0-or-later；[GPL 原文](licenses/GPL-3.0.txt)、[上游声明](licenses/sing-box-NOTICE.txt)。对应 fork 源码、构建依赖与额外条款仍需核对 |
| wintun.dll | 官方 0.14.1 amd64 预编译 DLL，已与官方 ZIP 比较为逐字节一致 | [官方二进制专用许可](licenses/Wintun-0.14.1.txt)，不是 MIT；Wintun 源码的 GPL-2.0 不可直接当成此 DLL 的分发许可 |
| 地球昼/夜/云纹理 | Solar System Scope / INOVE，包内转换为 WebP、缩放 | [CC BY 4.0](licenses/CC-BY-4.0.txt)，来源 https://www.solarsystemscope.com/textures/ ，保留署名和修改说明 |
| geo/world.geo.json | 原记录：Natural Earth / johan/world.geo.json | Natural Earth 公有领域：https://www.naturalearthdata.com/about/terms-of-use/ 。尚未逐字节对应上游 GeoJSON 提交，不将历史记录当作完整溯源证据 |
| ruleset/geosite-cn.srs、geoip-cn.srs | 原记录：SagerNet sing-geosite / sing-geoip | 精确数据提交、生成依赖、完整许可待核实；发布前补齐，不能笼统套用应用 MIT |
| src/renderer/assets/forest/characters.png、应用图标等美术 | 随原包提供 | 未找到完整作者授权和可再分发凭证；熊出没角色、名称与图案不因本应用 LICENSE 自动获得授权。公开发布前取得授权或替换 |

## 网络服务

IP.SB 是在线查询服务，不是内置地理数据库；查询会把目标公网 IP 发给服务端。接口说明：https://ip.sb/api/ ，条款：https://ip.sb/terms-of-use/ 。支持 IPv4/IPv6，结果仅供近似定位。IP 纯净度工具可能调用 ip.net.coffee；其结果与可用性由服务提供方决定。客户端未把这些在线数据声明为 MIT。

## 发布前必须核实的事项

1. 内核是定制二进制，不得用官方 sing-box 源码或不完整桌面源码包充当其完整对应源码。需提供与该二进制对应的源代码、修改、构建脚本及适用 GPL 分发方式；目前未验证到可用的完整来源。内核静态 Go 依赖清单也未随包提供，第三方清单仍待补齐。
2. 规则集与美术素材的授权/来源缺口仍存在；本文明确记录缺口，未宣称已经解决。
3. 不能仅凭“独立进程”认定 GPL 与桌面代码的法律关系。各文件以实际权利和许可为准。
4. Electron 自带许可证、Chromium 声明、依赖包 LICENSE 与本目录原文均需保留。开发依赖不在当前运行包中，不表示今后源码构建分发可以忽略其许可。

## 可核对的二进制标识

sing-box SHA-256：`125dee025b187660f431f766d854efb88c927fa300e398a3e2e480eaa564c5dc`

wintun.dll SHA-256：`e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce`

官方 Wintun 0.14.1 ZIP：https://www.wintun.net/builds/wintun-0.14.1.zip

该 ZIP SHA-256：`07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51`
