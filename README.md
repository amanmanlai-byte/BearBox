# Bear Box

简约易用的 Windows 桌面代理客户端。基于 [JiajiaBox](https://github.com/weilai090624-code/JiajiaBox)（Android）项目二次开发，默认内置 CNIP + CN 域名分流，开袋即食。

## 功能

- 多协议代理：VMess、VLESS（含 Reality）、Trojan、Shadowsocks、Hysteria2、TUIC、SOCKS、HTTP
- 订阅管理：Clash YAML / base64 / 明文链接 / sing-box JSON / SIP008
- 节点测速：URL Test（可自定义测速地址与并发数）
- 系统代理 / TUN 模式
- 流量统计与实时可视化
- 3D 地球 + 平面地图（出口/节点/目标定位）
- 按进程分流（分应用代理的 Windows 等效）
- 深色 / 浅色主题 + 自定义壁纸 + 毛玻璃效果
- 系统托盘 + 关闭到托盘

## 下载

从 [Releases](https://github.com/amanmanlai-byte/BearBox/releases) 页面下载最新版本，解压后运行 `BearBox.exe`。

## 构建

```bash
cd app
npm install
npm test
npm run pack:win
```

内核 sing-box（1.14.3-Jiajia-7）由 [JiajiaBox](https://github.com/weilai090624-code/JiajiaBox) 项目源码编译，Windows x64。构建前需将内核二进制放入 `app/core/` 目录。

## 许可证

MIT License。详见 [LICENSE](LICENSE)。

代理内核 sing-box 采用 GPL-3.0 许可证，以独立进程运行。
