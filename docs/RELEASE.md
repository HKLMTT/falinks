# 发布指南(npm + GitHub Actions 自动发布)

本项目通过 GitHub Actions 自动发布到 npm:**打一个 `v*` tag 推上去,就完成发布**。
认证用 npm **Trusted Publishing**(OIDC 可信发布者):不在任何地方保存 npm 密钥,
发布产物自动附带 provenance(供应链溯源签名)。

## 日常发布流程(每次发版就这 4 步)

```bash
# 1. 改版本号(package.json 的 version)+ 在 CHANGELOG.md 顶部写本版条目
# 2. 提交
git add package.json CHANGELOG.md
git commit -m "chore(release): x.y.z"

# 3. 打 tag(必须是 v + 版本号,和 package.json 完全一致)
git tag vx.y.z

# 4. 推送(commit 和 tag 一起推)
git push && git push --tags
```

推送 tag 后,GitHub Actions 的 **Release** 工作流自动执行:
校验 tag 与 package.json 版本一致 → `tsc` → 全量测试 → `npm publish`(带 provenance)。
进度看仓库的 **Actions** 标签页;失败会标红,点进去看日志。

> 版本不一致、测试不过,都会拒绝发布——发出去的一定是绿的。

## 工作流说明

| 文件 | 触发 | 干什么 |
|---|---|---|
| `.github/workflows/ci.yml` | push 到 main / 任何 PR | ubuntu+macos × node 20/24 矩阵:tsc + build + 全量测试 |
| `.github/workflows/release.yml` | 推送 `v*` tag | 版本校验 → 测试 → `npm publish`(OIDC,免密钥) |

## 首次配置清单(一次性,已完成的打勾)

> ⚠️ 顺序很重要:npm 的 Trusted Publishing 配置页要求**包已存在**,所以"第一次发布"
> 必须手动发一次,之后才能配置可信发布者、把后续发布交给 CI。

### 1. GitHub 仓库

- [x] `gh auth login` 登录 GitHub(浏览器授权)
- [x] 创建公开仓库并推送

### 2. 首次手动发布(仅第一次,把包在 npm 上建出来)

本地 npm 缓存若有权限问题,用 `--cache` 指向临时目录绕过(无需 sudo)。首次发布关掉
provenance(provenance 只能在 CI 的 OIDC 环境生成):

```bash
npm whoami   # 确认已登录(应为 hklmtt);没登录则 npm login
npm publish --access public --provenance=false --cache /tmp/npm-falinks-cache
# 若账号开了 2FA,加 --otp=<6位验证码>
```

### 3. npm 可信发布者(包发出来后,在 npmjs.com 网页上配,一次即可)

1. 打开包设置页:`https://www.npmjs.com/package/@hklmtt/falinks/access`
2. 找到 **Trusted Publisher** → 选 **GitHub Actions**,填:
   - **Organization or user**:`HKLMTT`
   - **Repository**:`falinks`
   - **Workflow filename**:`release.yml`(只填文件名,不带路径)
   - **Environment name**:留空
3. (推荐)同页 **Publishing access** 选 "require 2FA and disallow tokens":
   CI 走 OIDC 不受影响,但任何被盗 token 都发不了这个包。
4. 保存。

配置完成后,只有"这个仓库的这个工作流"能自动发这个包;以后发版只需打 tag(见上文流程)。
本地手动 `npm publish` 仍可用(需登录 + 2FA),但日常都走 tag。


> 注意:Trusted Publishing 要求 npm CLI ≥ 11.5.1,工作流里已处理(`npm i -g npm@latest`)。

## 常见问题

- **发布失败:`Unable to authenticate`/OIDC 报错** —— npmjs.com 上的可信发布者还没配,
  或 owner/repo/workflow 文件名填错(workflow 填 `release.yml`,不是 `.github/workflows/release.yml`)。
- **发布失败:版本不一致** —— tag 是 `v0.5.0` 但 package.json 还是 `0.4.0`。改一致后
  删掉旧 tag 重打:`git tag -d v0.5.0 && git push origin :refs/tags/v0.5.0`,再走流程。
- **同版本号发过了** —— npm 不允许重发同版本。bump 一个新版本号重走流程。
- **想手动发** —— 本地 `npm publish` 依然可用(需 `npm login`),但建议都走 tag,
  保证发出去的版本一定过了全量测试。
