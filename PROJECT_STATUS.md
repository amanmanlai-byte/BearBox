# PROJECT_STATUS.md — JiajiaBox Windows 桌面客户端

更新时间：2026-10-25（自主开发轮次开始时基线）

## 一句话状态

可运行、可构建、可打包的 Windows 10/11 桌面代理客户端（Electron + 用户自编译内核 sing-box 1.14.3-Jiajia-7），
57/57 自动化测试通过，9 个页面全部接入真实数据，发布包位于 D:\BearBox-win32-x64.zip。

## 架构与技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 界面 | Electron 33.2（Chromium 渲染，无打包器、无前端框架） | 纯 JS + 手写 DOM 助手 h()；CSP default-src 'self'（img 允许 file: 供壁纸） |
| 后端 | Node 24，src/backend/*.js，零 Electron 依赖（可独立测试） | service.js 全部业务；core.js 内核进程 + Clash API 轮询；geo.js ip.sb/DoH |
| 内核 | sing-box 1.14.3-Jiajia-7（用户自己的源码编译，45MB，app/core/） | 绝不替换为官方发布版；wintun.dll 同目录 |
| 数据 | %APPDATA%\JiajiaBox\data.json（原子写） | 设置/订阅/节点/规则/每日流量(90天)/密钥 |
| 打包 | @electron/packager → dist/JiajiaBox-win32-x64（便携目录） | 图标 assets/icon.ico（tools/make-icons.js 零依赖生成） |

## 功能清单（当前实态）

**已实现且经自动化或实测验证**
- 订阅：URL 订阅（base64/明文链接/Clash YAML/sing-box JSON/SIP008/JSON 数组）+ 分享链接导入
  （vmess/vless 含 reality/trojan/trojan-go/ss 含 obfs/hysteria2/tuic/socks/http）+ 本地订阅文件导入 + 自动更新间隔
- 节点：URL Test 测速（内核未运行时自动临时启动内核，测完关闭；TCP 仅降级并明示）、
  并发数可配、搜索/按订阅筛选/排序、节点切换（运行中切换会断开旧连接并验证内核实际选中）
- 代理：混合端口 HTTP/SOCKS、规则模式（内置 geosite-cn/geoip-cn 本地规则集，离线可启动）/全局模式、
  自定义规则（域名/IP/端口/进程/网络/协议，含规则文件导入：Clash 规则行 + JSON）、
  生效规则链可视化（来自真实生成的配置）、Windows 系统代理设置与精确还原、TUN 预检+UAC 提权
- 可视化：实时速度曲线（悬停十字线）、近 7/30 天流量、节点延迟排行与状态分布环形图、
  连接数/内存趋势、上下行占比、连接表（搜索/筛选/按进程流量排行）、运行日志（级别/搜索/自动滚动）
- 地图页：彩色世界地图（内置 180 国边界 GeoJSON）、真实时间昼夜明暗线、滚轮缩放(0.55x~64x)/拖拽、
  自身出口/直连/节点/连接目标定位（ip.sb，内核运行时经代理 CONNECT 隧道，DoH 解析回退，30 天本地缓存）
- 界面：浅色/深色主题（即时切换）、自定义壁纸（不透明度/亮度遮罩/模糊）、毛玻璃（独立不透明度）、
  托盘（关闭到托盘、气泡提示）、防闪屏（挂载同帧绘制 + 局部更新）、表格滚动位置保留
- 稳定性：崩溃后系统代理恢复、端口占用明确报错、内核启动失败带出内核日志原因、单实例锁

**已实现但尚未充分验证（诚实清单）**
- TUN 实际创建虚拟网卡：预检（wintun.dll/管理员）与 UAC 提权流程已实现并有单测，
  但本环境未以管理员运行做过端到端建网卡验证
- 订阅自动更新定时器：单测覆盖（注入定时器），真实 24h 长跑未做
- 地图 ip.sb 查询在「内核运行 + 出口节点自身断网」下的降级路径仅单测覆盖

**明确未实现（需要原始 Android 项目 smali 参考，交接包未包含）**
- SSH、WireGuard、AnyTLS、ShadowTLS、Naive、Hysteria v1、Mieru 协议解析
- 链式代理、自定义 JSON 配置节点、GeoIP/GeoSite 资产管理界面、STUN 工具、globe 视图
- Android 版「订阅分组管理」的完整形态（当前以按订阅筛选/分组表头近似）

**本轮新增（见 CHANGELOG）**：工具箱页（配置备份导出/导入、内核配置导出、打开数据目录）、
订阅重命名、节点页按订阅分组表头、文件导入重复入库修复。

## 已知问题与风险

| 编号 | 问题 | 严重度 | 状态 |
|---|---|---|---|
| B-01 | data.json/内核 config.json 含节点凭据（明文），位于用户目录，无加密 | 中 | 设计使然（与 Android 版一致），文档明示；未做加密 |
| B-02 | TUN 端到端未在管理员环境验证 | 中 | 待用户实机验证 |
| B-03 | 无代码签名，SmartScreen 会告警 | 低 | 需购买证书，超出权限 |
| B-04 | 无安装器（便携目录形态） | 低 | 明确决策：暂不引入 |
| B-05 | 规则模式远程规则集回退路径（本地 ruleset 目录被删时）依赖网络 | 低 | 已有明确警告日志 |

## 构建与运行

```
cd app && npm install && npm test        # 57 项测试
npm start                                # 开发运行
npm run pack:win                         # 打包 → ../dist/JiajiaBox-win32-x64
# 发布包：压缩 dist/JiajiaBox-win32-x64 → D:\JiajiaBox-win32-x64-0.4.0.zip（含 使用说明.txt）
```
