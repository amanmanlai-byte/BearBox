# 本次改动文件

以下路径相对 resources/app：

- src/backend/config.js：FakeIP、DNS 缓存/反向映射、IPv6 默认域名策略，移除亮度遮罩默认值。
- src/backend/geo.js：IPv6 检测和解析、响应校验、无坐标国家保留、缓存去重、调度限速、HTTPS 字节解码。
- src/backend/service.js：DNS 设置校验、过期遮罩配置清理、正常退出无条件关闭 Windows 手动代理。
- src/main.js：隐藏窗口测试的动画/截图收尾，保留原生产窗口行为。
- src/renderer/app.js：组合输入期间避免重建页面、通用展开/收起动画、移除遮罩样式写入。
- src/renderer/app.css、index.html：删除遮罩元素与样式。
- src/renderer/pages.js：中文搜索输入事件、默认展开状态分布、DNS 设置控件、地图统计与地址过滤、关于页许可纠正。
- src/renderer/appearance.js：移除亮度遮罩控件与恢复默认项，纠正壁纸保存说明。
- src/renderer/globe/NOTICE.txt：更新地图来源、功能边界和许可索引。
- package.json：实际依赖版本、有效测试命令、构建时携带许可证与保留语言列表。
- test/network-v6.test.js、renderer-network-v6-probe.js：新增内核、DNS、地图和退出验证。
- test/renderer-node-probe.js、renderer-forest-probe.js：中文组词、状态分布和旧配置夹具更新。
- LICENSE、NOTICE、THIRD_PARTY_NOTICES.md、AGENTS.md、licenses/*、.gitignore：许可核对、维护说明及源码上传排除项。

便携包根目录更新/新增：LICENSE、SOURCE.txt、THIRD_PARTY_NOTICES.md、README.md、使用说明.txt、快捷分流说明.md、验证记录.md、GITHUB_RELEASE.md、CHANGELOG.md、本清单。

旧的 UI-TUN-CHANGELOG.md、UI-VISUAL-CHANGELOG.md、APPEARANCE-CHANGELOG.md 合并为 CHANGELOG.md。瘦身移除闲置 Electron 语言资源、遗留开发 CLI/半安装 Electron、未引用临时模块及可重建图形/代码缓存。非缓存用户数据、核心二进制、DLL、规则集和 Chromium 许可保持字节一致。

逐条 ZIP 增删及哈希详见交付目录的 cleanup-package-verification.json。没有向 GitHub 上传内容。
