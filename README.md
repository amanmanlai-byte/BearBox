# Bear Box

Bear Box 是一款面向 Windows x64 的桌面代理客户端，提供节点与订阅管理、连接状态查看、规则分流和网络设置界面。当前仓库包含 0.3.0-preview.2 本地修订版的便携程序及其应用文件，内置定制 sing-box 1.14.3-Jiajia-7 内核。

## 主要功能

- 导入和管理节点、订阅，搜索节点并查看连接状态与延迟。
- 查看流量和活动连接，管理规则分流，并使用快捷分流功能。
- 配置 FakeIP、DNS 缓存、反向映射以及 IPv4/IPv6 网络策略。
- 查看基于公网 IP 的地理信息；地图结果用于近似定位，不是 GPS 定位。
- 使用 Windows 系统代理、托盘和可选 TUN 模式。TUN 默认关闭，启用时可能需要管理员权限。
- 自定义主题、字号、界面密度、侧边栏和壁纸；支持配置备份与恢复。

## 下载与运行

仓库中的 `.exe` 文件由 Git LFS 管理。克隆时请先安装 Git LFS：

```powershell
git lfs install
git clone https://github.com/amanmanlai-byte/BearBox.git
cd BearBox
git lfs pull
```

下载完成后，在完整目录中运行 `BearBox.exe`。不要在压缩软件的预览窗口里直接启动；运行文件需要与 `resources`、`locales` 等随包文件放在一起。

## 数据与系统行为

便携运行数据保存在程序目录的 `trial-data/` 中，包括节点、订阅凭据、设置、缓存和使用数据。仓库已排除这个目录；请勿把实际运行数据、订阅链接、节点密码或含凭据的备份公开上传。分享备份前先检查其中的内容。

启用 TUN 可能弹出管理员权限请求。关闭主窗口可将程序收进托盘；要彻底退出，请从托盘菜单选择“退出”。正常退出时，程序会关闭当前 Windows 用户的手动系统代理设置；如果你依赖该设置，请留意这一行为。强制结束进程或系统断电时，退出清理不一定能执行。

IP 地理信息和部分网络检测会访问外部服务，详情见[第三方组件与许可说明](THIRD_PARTY_NOTICES.md)。FakeIP 只影响经过内核 DNS 的请求；浏览器自带的 DNS over HTTPS 可能绕过该设置。私网地址、合成地址或没有真实目标 IP 的连接无法可靠定位。

## 开发与测试

应用代码位于 `resources/app/`。在该目录安装开发依赖后，可以运行：

```powershell
npm install
npm start
npm test
```

Windows 便携包构建脚本为 `npm run pack:win`。内核相关测试需要随包提供的定制内核与 Wintun 文件；项目不会自动下载或替换它们。最近一次测试结果和未覆盖范围见[测试报告](TEST_REPORT.md)。

## 许可与来源

根目录 [LICENSE](LICENSE) 中的 MIT 许可适用于 Bear Box 自有桌面代码，不代表内置内核、Electron/Chromium、依赖、规则数据或美术素材都采用 MIT 许可。组件明细、原始许可文本和待核实事项见[第三方组件与许可说明](THIRD_PARTY_NOTICES.md)。定制内核对应源码、规则集来源和部分美术素材授权仍有待核实；请在再分发前检查相关说明。

## 文档

- [使用说明](使用说明.txt)
- [快捷分流说明](快捷分流说明.md)
- [更新记录](CHANGELOG.md)
- [测试报告](TEST_REPORT.md)
- [源码与来源记录](SOURCE.txt)
- [GitHub 发布说明](GITHUB_RELEASE.md)
