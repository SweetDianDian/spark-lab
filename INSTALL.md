# 安装与启动

火花实验室在本机启动一个网页服务。教学模拟、原理演示和本地代码实验都不需要 API 密钥；接入真实模型是可选步骤。

## 1. 准备环境

- **Node.js：推荐 24.x LTS 的最新补丁版本**，安装时一并安装 npm。也可使用仍受支持的 22.x LTS；新安装请优先选 24.x。版本状态见 [Node.js 官方发布表](https://nodejs.org/en/about/previous-releases)。
- **Git**：用于下载源码；也可以下载仓库 ZIP 并解压。
- **桌面浏览器**：建议使用近期版本的 Chrome、Edge 或 Firefox。界面按桌面窗口设计。

无需另外安装 Python、数据库、Docker 或 GPU 驱动。课程里的 Python 使用浏览器内的 Pyodide，和系统 Python 相互独立。

| 系统 | 安装方式与终端 |
| --- | --- |
| macOS | 从 [Node.js 官网](https://nodejs.org/en/download)安装对应架构的版本；使用“终端”。Git 可通过系统开发工具安装。 |
| Windows | 安装 Node.js 的 Windows 版本并保留加入 PATH 的选项；安装 [Git for Windows](https://git-scm.com/downloads/win)。使用 PowerShell 或命令提示符。 |
| Linux | 按 Node.js 官网对应发行版的安装说明操作；使用系统终端。发行版自带的软件源可能提供较旧版本，安装后核对版本。 |

安装后重新打开终端，检查：

```sh
node --version
npm --version
git --version
```

克隆后，在包含 `package.json` 的项目根目录执行 npm 命令。本版已在 macOS 的干净目录使用 Node.js 24.19.0、npm 11.17.0 完成安装、测试和构建。

## 2. 下载并启动

以下以 `SweetDianDian/spark-lab` 为例；如果使用自己的 fork，请替换仓库地址。

```sh
git clone https://github.com/SweetDianDian/spark-lab.git
cd spark-lab
npm ci
npm run dev
```

`npm ci` 按 `package-lock.json` 安装锁定版本，首次安装需要联网。下载 ZIP 的用户解压后进入项目目录，从 `npm ci` 开始即可。

看到 Vite 启动成功后，在浏览器打开：

**http://127.0.0.1:5190/**

保留运行服务的终端窗口，按 `Ctrl+C` 停止服务。下次使用时进入同一目录，重新运行 `npm run dev`；没有变更依赖时，无需重复安装。

启动前的 `predev` 脚本会把 Pyodide 文件从 `node_modules` 复制到 `public/pyodide/`。Python 资源由本机服务提供，不从第三方 CDN 下载；第一次运行 Python 仍需等待浏览器加载 WebAssembly。

### macOS 快捷启动

完成一次 `npm ci` 后，也可以双击项目内的 `启动实验室.command`。它会进入正确目录并运行 `npm run dev`，不会代替首次安装依赖。

若双击未执行，可在终端运行：

```sh
zsh ./启动实验室.command
```

Windows 和 Linux 直接使用 `npm run dev`。

### 首次体验

1. 在首页把人数设为 17，运行聚餐结账示例。每人 23 元，应得到 391 元；改成 19 人再运行，应得到 437 元。
2. 打开“课程路径”，进入第一章的“练代码”。保留“教学模拟”，先运行当前代码，再按提示改一个值。
3. 切换 TypeScript、JavaScript 或 Python，检查实际输出与执行步骤。

前四章的“教学模拟”使用确定性规则模拟模型，代码控制流与工具计算会实际执行。后十章默认运行本地机制算法，页面会显示“本地计算 · 无需密钥”。这些实验不需要下载大语言模型。

## 3. 可选：接入真实 API

浏览器通过同源 `/api/model` 请求本地网关，由网关携带密钥访问模型服务。密钥应保存在项目根目录的 `.env`，不要写进课程代码、前端源码或 `VITE_*` 变量。

### 创建配置文件

macOS / Linux：

```sh
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

Windows 命令提示符：

```bat
copy .env.example .env
```

用文本编辑器打开 `.env`，填写自己的凭证。例如，沿用仓库中的 DeepSeek 示例：

```dotenv
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_API_KEY=替换为你自己的密钥
```

不要在已有配置上反复复制示例；直接编辑 `.env` 即可。Windows 下确认文件名是 `.env`，不是 `.env.txt`。此文件已加入 Git 忽略规则。

当前网关只接受以下三个固定地址：

| 服务 | `AI_BASE_URL` |
| --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

`AI_MODEL` 填该服务中你的账号有权调用的模型标识。网关使用 Chat Completions 兼容接口；工具调用和 Agent 章节还要求模型支持 function calling。不要在地址后追加 `/chat/completions`，网关会自行拼接；其他地区端点、自建代理和本地模型地址目前不在允许列表内。

### 启用并验证

1. 保存 `.env`，在服务终端按 `Ctrl+C`，再运行 `npm run dev`。
2. 点击页面右上角“API 连接”，检查显示的服务和模型。
3. 进入前四章之一的“练代码”，切换到“真实 API”，运行一次短问题。

也可以在浏览器打开 `http://127.0.0.1:5190/api/status` 检查配置状态。`configured: true` 只表示配置字段满足网关要求，**不代表密钥、余额、模型权限或网络已验证成功**；实际运行成功后才完成连接验证。

真实请求由模型服务商计费。一次 Agent 实验可能请求模型多次；停止本地等待不能保证已提交的请求不计费。内置 `calculator` 仍在本地计算，`search` 仍检索课程资料，不会变成互联网搜索。后十章的本地机制实验也不会因配置密钥而自动变成远程模型实验。

## 4. 构建、预览与部署边界

在项目目录执行：

```sh
npm run build
npm run preview
```

如果 `npm run dev` 仍占用 5190，请先停止它。预览地址同样是 **http://127.0.0.1:5190/**。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务，修改源码后热更新，包含本地 API 网关。 |
| `npm run build` | 准备 Python 资源、运行 TypeScript 检查、构建前端和 Worker 入口，不启动服务。 |
| `npm run preview` | 在本机检查已构建的前端，也接入本地 API 网关；源码修改后需重新构建。 |

构建产物：

```text
dist/client/          前端静态文件，包含 Python 运行资源
dist/server/index.js  服务端 Worker 入口，导出 fetch(request, env)
```

`preview` 默认使用 `production` 模式：会读取 `.env`，也可能被 `.env.production`、`.env.production.local` 或终端中的 `AI_*` 环境变量覆盖。修改 API 配置后需要重启预览服务。

`vite preview` 是本地验收工具，不是生产部署方案。`dist/server/index.js` 也不是可通过 `node dist/server/index.js` 启动的 Node HTTP 服务；它需要支持该 Worker 接口的宿主，提供 `ASSETS.fetch` 静态资源绑定和服务端环境变量。

纯静态托管 `dist/client/` 可以提供教学模式，但不会自动部署真实 API 网关。静态服务器须为 `/learn/...`、`/lab/...` 等页面路由回退到 `index.html`，并正常提供 `/pyodide/` 等静态资源。当前代码使用根路径资源，直接挂在 `/spark-lab/` 等子目录下还需修改路径配置。

如需公开提供真实 API，应另行完成服务器适配、身份授权和持久化用量限制。当前网关的限流只在进程或 Worker 实例内计数，浏览器 Worker 也不是面向不可信代码的安全沙箱。仓库目前没有一条可直接完成通用生产部署的命令。

## 5. 运行测试

```sh
npm test
npm run build
```

测试覆盖课程数据、三语言本地实验、运行证据、教学机制与模型网关。Python 测试从已安装的 `pyodide` 包加载运行时；网关测试使用受控响应，不需要真实密钥，也不验证你的供应商凭证。

发布前再手动检查：三种语言各运行一次、前四章的教学工具循环、Python 首次加载，以及 `/learn/...` 和 `/lab/...` 页面刷新是否正常。如果启用真实 API，还需单独验证实际调用与工具调用权限。

## 6. 常见问题

### 提示找不到 `node`、`npm` 或 `git`

重新打开终端并检查版本。确保安装目录已加入 PATH；macOS 的 `.command` 使用登录式 zsh，若版本管理器只在其他 shell 中初始化，可先在能识别 npm 的终端运行 `npm run dev`。

Windows PowerShell 若提示不允许运行 `npm.ps1`，可使用命令提示符，或将教程中的 `npm` 换成 `npm.cmd`，无需为此关闭整个系统的脚本保护。

### `npm ci` 失败

先确认当前目录有 `package.json` 和 `package-lock.json`，再检查 Node 版本、网络及报错中的依赖名称。Windows 出现文件占用或 `EPERM` 时，先停止正在运行的项目服务，再重试。

如果提示 lockfile 与 `package.json` 不一致，应检查是否混用了不同提交的文件；普通安装不需要删除锁文件或改用随机版本。不要把密钥或整份 `.env` 附在报错反馈里。

### 5190 端口已被占用

`dev` 和 `preview` 都使用 `--strictPort`，不会自动换端口。先打开 `http://127.0.0.1:5190/`，确认是否已有自己的实验室服务；需要重启时，在原终端按 `Ctrl+C`。

查看监听进程，避免误停其他应用：

macOS / Linux（已安装 `lsof`）：

```sh
lsof -nP -iTCP:5190 -sTCP:LISTEN
```

Windows PowerShell：

```powershell
Get-NetTCPConnection -LocalPort 5190 -State Listen | Select-Object OwningProcess
```

也可为这次运行明确指定另一个端口：

```sh
npm run dev -- --port 5191
```

随后访问 `http://127.0.0.1:5191/`。端口变化会改变浏览器存储来源，旧地址的学习记录不会自动出现在新地址。

### Python 首次加载很慢，或提示找不到 `/pyodide/` 文件

首次加载需要读取 WebAssembly 和标准库。确认 `npm ci` 已完成，并通过 `npm run dev` 或 `npm run build` 运行了资源准备脚本；不要只运行裸 `vite` 命令跳过前置步骤。

若资源目录被删除，可重新准备：

```sh
node scripts/prepare-runtime.mjs
```

预览构建产物时需要再执行 `npm run build`。直接双击 `dist/client/index.html`，或使用 `file://` 打开页面，不能替代 HTTP 服务。

### API 仍显示未配置，或请求失败

| 现象 / 错误码 | 检查方向 |
| --- | --- |
| `not_configured` / `configured: false` | `.env` 是否位于项目根目录；三项配置是否完整；地址是否在允许列表；修改后是否重启。 |
| `provider_auth` | 密钥是否属于所选服务，账号是否拥有模型权限。 |
| `provider_request` | 模型标识、Chat Completions 参数与工具调用能力是否兼容。 |
| `provider_rate_limited` | 供应商额度、余额或并发限制。 |
| `rate_limited` | 本地实验额度或并发限制；等待额度恢复，减少同时运行。 |
| `timeout` / `network_error` | 运行 Node 服务的机器能否访问供应商；浏览器能打开官网不等于服务端请求可达。 |
| `origin_rejected` / `host_rejected` | 从同一个本机实验页面运行；本地网关只接受本机 Host 和同源请求。 |

本地网关每个会话每小时最多 30 次模型请求，单进程合计 120 次；模型单次等待上限 25 秒、输出上限 1,024 tokens。完整实验另有运行限制，因此长任务可能先停止。网络失败时可以切回教学模拟继续学习。

### 在其他电脑打不开，或进度不见了

默认服务只监听 `127.0.0.1`，用于当前电脑；本地 API 适配也限制本机 Host，不能只改 `--host` 就当作共享部署。

学习记录保存在当前浏览器，不会云同步。`localhost` 与 `127.0.0.1`、不同端口、不同浏览器和隐私窗口拥有不同存储；清理站点数据也会删除本地记录。建议固定使用同一地址和浏览器。
