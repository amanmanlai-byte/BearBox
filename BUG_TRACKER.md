# BUG_TRACKER.md

记录格式：编号 | 问题 | 复现条件 | 严重度 | 根因 | 修复 | 验证
历史已修复项见 CHANGELOG.md；本表只保留本轮新发现与本轮修复明细 + 遗留问题。

## 本轮发现并修复

### J-01 订阅文件重复导入导致节点翻倍
- 复现：订阅页「导入订阅文件」选同一文件两次 → 第二次把已有节点与新节点拼接，
  dedupeTags 给同名节点加 " #2" 后缀，节点数翻倍
- 严重度：中（数据污染）
- 根因：importSubFile 用 `[...existing, ...parsed.nodes]` 追加合并（照抄 importLinks 语义），
  而文件导入与 URL 订阅更新同语义，应整体替换该订阅的节点
- 修复：importSubFile 改为 `this._ingest(sub, parsed)`（替换语义，保留选中节点尽量不变）
- 验证：新增测试「re-importing the same subscription file replaces instead of duplicating」

### J-02 规则文件重复导入导致规则翻倍
- 复现：代理规则页「导入规则文件」同一文件导两次 → 规则条目×2
- 严重度：低（可用但脏）
- 根因：parseRuleFile 只做文件内去重，不与已存规则比对
- 修复：importRuleFile 按条件签名（domain/ip/port/processName/outbound）跳过已存在规则，
  返回 skipped 数并在提示中说明
- 验证：扩展测试「importRuleFile skips already-existing rules」

### J-03（审查发现，隐性）工具箱缺失导致「配置导入导出」能力缺位
- 非崩溃类问题，属功能缺口 → 已实现工具箱页（备份导出/导入、内核配置导出、打开数据目录）

### J-04 背景遮罩 0% 被当作未设置
- 复现：壁纸设置里把「亮度遮罩」拉到 0% → 松手后遮罩跳回 55%
- 根因：applySkin 中 `Number(s.wallpaperVeil) || 0.55` 把合法值 0 当 falsy 回退
- 修复：统一 num(v, d) 助手，仅缺失/非数值才回退（不透明度/模糊/毛玻璃同查同修）
- 验证：探针 setSettings({wallpaperVeil:0}) → 计算值 `--wp-veil` 恰为 `0` ✓

### J-05 壁纸不透明度滑杆无效
- 复现：任意拖动「壁纸不透明度」→ 视觉无变化（遮罩滑杆同病）
- 根因：滑杆内部刻度 10-100，实时预览与持久化都把原始刻度（如 55）直接写入透明度，
  数值恒 ≥1 被浏览器钳成 1，表现为"完全无效"
- 修复：live()/持久化统一按刻度/100 换算；初始值反向换算；setSettings 对 >1 的存量脏值自动 /100 修复
- 验证：探针拖到 40 → 实时变量与存储值均为 0.4，标签 40% ✓

### J-06 3D 地球俯仰受限 / 高分屏发虚
- 修复：clampPitch 改为全角度环绕（360° 自由翻转，矩阵为正交欧拉组合，数学安全）；
  渲染像素预算 768k（移动端值）→ 2.30M，150% 缩放屏恢复原生采样
- 验证：探针画布 backing store = CSS × dpr（原生采样）；拖动无钳制路径

### J-07 浅色主题毛玻璃扎眼
- 修复：浅色下玻璃表面由纯白改为 向画布灰调(color-2)混合，边框减淡；深色保持透明混合不变

### J-08 3D 地球无法手动转动（移植缺陷，两层根因）
- 第一层：原版 CSS `#labels{pointer-events:none}` 在移植时丢失，覆盖层画布吞掉了全部指针事件
- 第二层：`setPointerCapture` 在某些时序下抛异常导致 pointerdown 中断（已加 try/catch 保护）
- 验证：终极验证使用 Electron `webContents.sendInputEvent` 发送操作系统级真实鼠标事件（非合成），
  实测 yaw 从 -1.730 到 0.076（旋转约 103°），moved=true
- 附注：此前合成事件探针因 setPointerCapture 异常而误报"监听器不报错但无旋转"，
  根因是合成 PointerEvent 不带真实指针 ID，capture 调用抛 NotFoundError 中断了 pointerdown

- 根因：原版 CSS `#labels{pointer-events:none}` 在移植时丢失，覆盖层画布吞掉了全部指针事件
- 修复：补回该规则；另加「停止自转/开启自转」按钮（globe.setState({autoRotate})）
- 验证：探针确认 labels 计算样式为 none、按钮存在；合成拖拽无异常

### J-09 毛玻璃侧栏切换页面时闪动
- 根因：主内容重渲染触发侧栏 backdrop-filter 背景重采样
- 修复：body.glass .side 提升 compositing 层（will-change + translateZ(0)）

### J-10 壁纸不透明度滑杆无效（补记，J-05 详述）
- 已修；本轮顺带把 J-05/J-08/J-09/J-10 与交互优化一并交付

## 遗留（未修复，附原因）

| 编号 | 问题 | 原因/建议 |
|---|---|---|
| L-01 | TUN 建网卡端到端未验证 | 需管理员实机操作；预检+UAC 已实现且有单测 |
| L-02 | data.json 含明文凭据 | 与原设计一致；如需加密属破坏性数据格式变更，需单独一轮设计迁移 |
| L-03 | 无安装器/签名 | 需外部付费资源；SmartScreen 提示为预期行为 |
| L-04 | 极端情况：内核运行中订阅自动更新后若上游改名，内核内 selector 标签滞后到下次重启 | 影响小；重启即恢复；可后续做「更新后热同步标签」 |

## 2026-10-26 可靠性修复（本地验证）

- 系统代理恢复失败保留恢复记录；恢复成功立即落盘。
- 开启代理前持久化原始设置，覆盖注册表部分写入失败场景；串行处理快速重复切换，避免覆盖原始代理快照。
- 节点切换 API 失败时保留原选择。
- 端口必须为整数；修复小数并发数向下取整为零；拒绝非法或溢出的订阅更新间隔。
- 备份排除机器相关的系统代理恢复状态；导入时校验版本、节点结构及设置，并重建自动更新计时器。
- 新增 11 项回归测试。独立测试 56/56 通过：`node --test app/test/core.test.js app/test/geo.test.js app/test/imports.test.js app/test/service.test.js app/test/sysproxy.test.js`。
- `npm test` 已尝试，真实内核相关测试因缺少定制 sing-box 二进制失败，不能视为全套通过。Windows 注册表、TUN、真实代理流量和界面实机验证未执行。
- GitHub 连接只读；本轮代码未推送、未发布。

## 2026-10-26 UI 与交互检查

修复：重复状态推送重建页面；设置页失焦后草稿丢失；订阅名称、规则内容、节点信息变更未纳入刷新签名；已有国旗重复添加；失败测速不计入已测数量；测速重复提交及启动期间取消失效；节点页计时器未清理；地图定位未定义变量中断缓存写入；旧节点定位响应覆盖当前节点；地图刷新按钮未等待所有请求；连接轮询请求重叠；网络筛选按钮高亮不更新；节点切换失败后下拉框不回退；系统代理操作失败后开关不回退；无 preload 时提示页被提前异常阻断；导航动画延迟回调操作错误页面。

验证：`node --test app/test/renderer.test.js app/test/service.test.js app/test/core.test.js app/test/geo.test.js app/test/imports.test.js app/test/sysproxy.test.js`。新增 DOM 测试覆盖 11 个页面 × 2 个主题 × 2 种数据状态，另有交互回归断言。DOM 测试使用 jsdom、模拟 IPC 和 canvas，仅用于逻辑验证，不代表真实图形渲染或网络功能通过。

限制：浏览器二进制下载失败，未能生成真实浏览器截图；未验证 Windows Electron、3D 图形、TUN 或真实代理流量。本轮没有推送到 GitHub。修改包包含上一轮修复。
