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

## 遗留（未修复，附原因）

| 编号 | 问题 | 原因/建议 |
|---|---|---|
| L-01 | TUN 建网卡端到端未验证 | 需管理员实机操作；预检+UAC 已实现且有单测 |
| L-02 | data.json 含明文凭据 | 与原设计一致；如需加密属破坏性数据格式变更，需单独一轮设计迁移 |
| L-03 | 无安装器/签名 | 需外部付费资源；SmartScreen 提示为预期行为 |
| L-04 | 极端情况：内核运行中订阅自动更新后若上游改名，内核内 selector 标签滞后到下次重启 | 影响小；重启即恢复；可后续做「更新后热同步标签」 |
