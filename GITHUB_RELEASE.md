# GitHub 源码与二进制发布

根目录 LICENSE 已设置为桌面端 MIT 许可证，保留原作者署名；Electron 的原根许可已移至 resources/app/licenses/Electron-MIT.txt。GitHub 对根 LICENSE 的识别不代表所有打包组件都采用 MIT。

若仅上传桌面源码，可将 resources/app 作为项目根目录，保留 src、assets、geo、规则集来源说明、package.json、测试、LICENSE、NOTICE、THIRD_PARTY_NOTICES.md 与 licenses。提交前按第三方声明确认素材与数据可公开，不能把未核实的资产默认当成自由素材。

不要提交 trial-data、core-run、缓存、订阅链接、节点密码、截图中的凭据、node_modules、测试输出和便携运行库。建议 .gitignore 覆盖这些路径。core 二进制不应放入源码 Git 历史，需要时使用 Release 附件，并同时履行其许可义务。

依赖安装与验证：在 resources/app 中运行 npm install，然后 npm test。内核测试需要原 sing-box-windows-amd64.exe 与 wintun.dll；不会自动下载或替换内核。开发依赖仍需联网安装。Electron 安装包构建脚本依赖开发环境，当前未重新构建安装器。

公开发布前按 THIRD_PARTY_NOTICES.md 补齐自定义内核完整对应源码/构建信息、静态依赖声明、规则集来源和美术授权。本次未创建或上传 GitHub 仓库，也未修改远程仓库 LICENSE。
