# 第三方组件与许可说明

核对日期：2026-10-28。本文依据当前便携版目录、包内元数据和已有来源记录整理；它不是完整的法律审查，也不证明所有组件均已取得再分发授权。发现来源或授权缺口时，本文明确标为“待核实”。

## 许可范围

仓库根目录的 [LICENSE](LICENSE) 是 Bear Box 自有桌面代码的 MIT 许可声明。它不替 Electron/Chromium、内核、依赖、规则数据或美术素材授予许可。分发时应同时保留本文件、[Chromium 声明](LICENSES.chromium.html)、应用目录内的原始许可文本和适用的版权声明；不得用应用的 MIT 许可替换第三方许可。

## 随包组件

| 组件 | 包内版本或来源记录 | 许可与随包材料 | 核对状态 |
| --- | --- | --- | --- |
| Bear Box 桌面代码 | `resources/app/package.json`：0.3.0-preview.2 | 根目录 [MIT 许可](LICENSE)；保留其中列出的版权声明 | 按包内声明整理 |
| JiajiaBox 衍生代码与地球渲染来源 | 包内历史来源记录；未确认对应的完整上游提交 | [原始 MIT 文本](resources/app/licenses/JiajiaBox-MIT.txt) | 来源记录不完整，尚未核实提交对应关系 |
| Electron | 包内 `version` 文件记录为 33.2.0 | [Electron MIT 文本](resources/app/licenses/Electron-MIT.txt)；Chromium 及其依赖见根目录 [LICENSES.chromium.html](LICENSES.chromium.html) | 保留两处声明；Chromium 声明不可省略 |
| js-yaml | 4.3.2 | [MIT 文本](resources/app/licenses/js-yaml-MIT.txt) | 版本来自随包依赖元数据 |
| argparse | 2.0.1 | [随包许可证文本](resources/app/licenses/argparse-Python-2.0.txt) | 按原文保留，不以摘要取代 |
| 定制 sing-box 内核 | 1.14.3-Jiajia-7；revision `4067f53d0881437092454817ebfd2c448f8b1d97` | [GPL-3.0 文本](resources/app/licenses/GPL-3.0.txt)和[上游声明](resources/app/licenses/sing-box-NOTICE.txt) | 定制版本对应源码、修改、构建材料和适用分发方式尚未核实；发行方应确认并履行适用的 GPL 对应源码义务 |
| wintun.dll | 0.14.1 amd64；包内记录称与官方 ZIP 逐字节一致 | [Wintun 专用许可文本](resources/app/licenses/Wintun-0.14.1.txt) | 该二进制的许可应以随包专用文本为准，不应用 Wintun 源码许可推定二进制许可 |
| 地球昼夜和云层纹理 | Solar System Scope / INOVE；包内素材已缩放并转换为 WebP | [CC BY 4.0 文本](resources/app/licenses/CC-BY-4.0.txt)；来源：[Solar System Scope textures](https://www.solarsystemscope.com/textures/) | 按包内记录注明来源及修改；分发时保留署名信息 |
| `geo/world.geo.json` | 历史记录指向 Natural Earth / `johan/world.geo.json` | Natural Earth：[使用条款](https://www.naturalearthdata.com/about/terms-of-use/) | 尚未将当前文件对应到确切上游提交，来源记录不足以证明完整溯源 |
| `geosite-cn.srs`、`geoip-cn.srs` | 历史记录指向 SagerNet sing-geosite / sing-geoip | 当前包未提供足以确认数据提交和生成链的完整材料 | 精确提交、生成依赖和适用许可待核实；不得仅凭应用 MIT 许可推定 |
| 森林角色图、图标及其他美术 | 随包文件 | 未找到完整作者授权和可再分发凭证 | 再分发权待核实；应用许可不授予第三方角色、名称或图案的权利 |

## 在线服务

客户端使用 IP.SB 进行在线 IP 查询，而非仅依赖本地数据库。查询会将目标公网 IP 发送给服务提供方：[API 说明](https://ip.sb/api/)和[使用条款](https://ip.sb/terms-of-use/)。纯净度工具可能使用 ip.net.coffee；服务可用性和结果由服务提供方决定。在线服务和返回数据不因应用的 MIT 许可而获得授权。

## 发布前待办

1. 核实定制 sing-box 二进制对应的源码、修改和构建材料，并确认适用的 GPL 分发与对应源码义务；当前包内材料不足以完成该核对。
2. 为规则集、地图数据及美术素材补齐可追溯的来源、版本和再分发许可；无法核实的素材应在取得授权或替换前保持未发布状态。
3. 继续随发行包保留 Electron、Chromium、依赖及应用目录内的原始许可和通知文件。
4. 不要把独立进程、历史来源记录或文件哈希当作许可结论或完整来源证明。

## 二进制完整性记录

以下 SHA-256 值用于识别包内文件，不证明权属或许可状态：

- sing-box：`125dee025b187660f431f766d854efb88c927fa300e398a3e2e480eaa564c5dc`
- wintun.dll：`e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce`
- 官方 Wintun 0.14.1 ZIP：[下载地址](https://www.wintun.net/builds/wintun-0.14.1.zip)，SHA-256：`07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51`
