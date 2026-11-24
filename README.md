# 火花实验室 · Spark Lab

一本可以看原理动图、运行代码的桌面实验手册。首页从朋友聚餐结账开始，14 章按照“看懂数据怎样变化 → 运行代码 → 只改一个条件 → 对照结果”连接模型调用、模型内部机制与助手工程。

## 安装与启动

首次使用请看[完整安装启动教程](./INSTALL.md)。它包含 Windows、macOS 和 Linux 的安装步骤、第一次运行实验、可选的真实 API 配置，以及端口占用和 Python 加载问题的排查方法。

```sh
git clone https://github.com/SweetDianDian/spark-lab.git
cd spark-lab
npm ci
npm run dev
```

使用 Node.js 24 和 npm。服务启动后打开[本地实验室](http://127.0.0.1:5190/)，保留终端窗口。教学模式可以直接运行，Python 运行资源会从已安装的 Pyodide 复制到项目目录。

macOS 也可以双击项目目录里的 `启动实验室.command`。这是本地服务，需要保留运行它的终端窗口；停止进程或重启电脑后，需重新启动。`dev` 和 `preview` 固定使用 5190，端口占用时明确报错，不会悄悄换到其他地址。

```sh
npm run build
npm run preview
npm test
```

## 本版内容

- 首页可设置聚餐人数，每人 23 元，沿“准备问题 → 提出算式 → 计算器执行 → 展示金额”检查本次运行。带着人数进入代码，可以修改同一段程序；首页试跑不冒充课程实操记录。
- 完整目录按同一份课程顺序展示全部 14 章，每章都有“看动图”和“练代码”入口。`/learn/:lessonId` 与 `/lab/:lessonId` 是同一章的两个视图，保留章节位置、前后章及返回目录的位置。先修关系可单独展开。
- 第 1–4 章：LLM 调用、上下文、工具调用、Agent 循环。第 5–7 章：Token 与采样、Transformer、训练与适配。第 8–13 章：向量检索、RAG、状态恢复、MCP、评测、多角色工作流。第 14 章用带引用的活动费用报告收束。
- 每章动图按具名步骤展示输入、处理与结果。点击某一步即可对照示例语句，再带着该步进入编辑器。实操先运行、定位要改的变量、再次运行，然后对照两份真实输出与输入变化；按实际显示的帧保存浏览记录。跳到最后不会补齐中间帧，切到后台暂停。动图是教学样本，不会伪装成真实模型请求或内部推理。
- 14 章均提供 TypeScript、JavaScript、Python 实操。前四章通过 `lab.model` 和 `lab.tool` 学习调用；后十章执行本地机制实验，包括小词表采样、单头 Attention、单参数训练、词频检索、引用组装、状态序列化和结构化交接。
- 后十章的范围明确：向量来自手写词频特征；RAG 用原文摘录代替模型生成；记忆在一次运行内模拟恢复；MCP 是本地消息子集；多 Agent 是两个角色函数；综合报告使用固定资料。它们不自动连接嵌入模型、数据库、远端 MCP 服务或自主 Agent。
- 保留五个扩展 A/B 对照：显示/隐藏响应、带入/移除背景、请求/执行工具、循环轮数、温度与固定随机落点。只为确实注册的五个场景提供入口；深度对照浏览、章内动图浏览、代码实操分别记录。
- Monaco 编辑器中的代码在可终止的浏览器 Worker 内执行；TS 经编译，Python 使用本地 Pyodide。代码与执行步骤并排，点击步骤检查实际输入和结果，定位对应代码。
- 两次运行对照保留最近两次实际执行的输入、输出、代码、语言和模式，失败与停止也如实展示；历史回放不会产生新的执行证据。运行快照保存在当前浏览器 localStorage，最多保留最近 15 条。
- 教学模型采用确定性规则，工具计算与代码控制流真实执行。内置 search 使用教学资料，非互联网搜索。动图浏览不代表掌握；代码“跑通”依据实际记录，旧手动完成标记不会被显示成一次真实运行。
- 代码修改后需要重新运行验证；历史跑通与最近失败分别可见。理解题用于解释结果时自查，保存通过记录仍要求当前代码存在有效执行证据。
- 本地学习笔记、历史回放、桌面固定布局与独立滚动区域。

## 界面组件

<details>
<summary>首页插画与生成提示词</summary>

聚餐插画使用内置 ImageGen 生成，交付文件为 `public/art/dinner-print.webp`。账单数字、算式与金额由页面根据实际输入和执行事件绘制。

Illustration-story. A horizontal, hand-pulled 3-colour risograph illustration for a Chinese independent creative coding zine. At a busy Chinese neighborhood noodle shop after a meal, two young adult friends humorously settle the bill: one in a striped shirt leans across the little round dining table holding out a long curling paper receipt, the other dramatically presses a button on an oversized old pocket calculator. Awkward affectionate gestures and crooked smiles, lived-in chopsticks, a couple of bowls and steam, two wonky stools. Cocked perspective, loose vigorous black brush contours and dry ink hatching, broad solid ultramarine shapes, little vermilion marks, a little butter yellow, lots of the warm off-white paper showing. Expressive handmade editorial spot drawing, like an artist's observation from life; witty, not cute 3D mascots. Strong clear silhouette, entire figures and most of table within a wide 3:2 composition, floating spot on unmarked pale warm cream paper, no enclosing frame, no shadows beyond pen hatching. No letters, words, numbers, speech bubbles, logos or signage. Make a single finished artwork, not a website mockup.

</details>

- Ant Design 6.7.2：全站按钮、选择器、数字输入、开关、滑块、卡片、标签页、折叠面板、步骤、提示与弹窗。`src/ui-theme.ts` 统一颜色、字号、间距及圆角，`ConfigProvider` 提供中文与主题上下文。
- 全部课程按七条学习线路呈现，箭头和「另需」标出 14 章的直接先修关系。选择一章可单独查看它的前后章。原理流程图使用 React Flow，工作区的可选执行步骤使用 Ant Design Steps。
- Monaco：继续作为 TS/JS/Python 代码编辑器，支持执行节点定位。
- 页面 CSS 只保留布局、内容排版和代码高亮。业务组件中不再直接写原生 button/select/input/textarea/dialog/details/summary/progress/table 控件；组件库内部生成的语义 HTML 正常保留。
- 桌面导航固定。原理目录和正文分别滚动，标题和播放条固定。实验的代码编辑器与右侧执行观察区也可以独立滚动，滚到边缘时保留另一侧的阅读位置。

## 接入真实模型

将 `.env.example` 复制为未跟踪的 `.env`，填写 `AI_API_KEY`、`AI_MODEL`、`AI_BASE_URL`，重启服务。支持 OpenAI、DeepSeek、通义千问固定兼容端点。浏览器通过同源 `/api/model` 请求网关，密钥只在服务端使用。`/api/status` 只表示配置是否齐全，不保证凭证或模型可用；首次实际请求才验证连接。

前四章可调用真实模型，返回完整响应，不提供真实 token 流。工具循环用明确标记的数据消息携带结果；这是一层教学适配，不等价于所有提供商的原生 tool-role 会话协议。后十章运行本地机制算法，不因切换模式而变成远端模型实验。没有真实 API 凭证时，所有实验仍可运行。

## 执行与使用边界

这是个人学习版本：Worker 隔离 UI 线程并允许中止执行，**不是对不可信代码的安全沙箱**。请仅运行自己理解或信任的代码。不得将此实现直接当成公共任意代码执行服务；公开多用户版本需要独立安全执行环境、身份授权和持久化预算。

每次运行最多 8 次模型调用、8 次工具调用、1,000 条事件、40 秒。主线程中止会同时取消网关请求；无法保证已经被提供商处理的请求不计费。网关限制是进程/Worker 实例内的原型保护，重启和多实例会重置或分散计数，不代表账户级硬费用上限。

JS/TS 当前不支持静态 import/export；Python 不提供完整系统包与任意服务端环境。教学代码通过 `lab.model`、`lab.tool`、`lab.step`、`lab.output` 产生语义事件。任意用户代码不会被自动理解成架构图。注意力和内部模型计算不从闭源 API 臆造。

## 目录

```text
src/App.tsx                 路由、统一外壳、学习记录与API连接
src/learning-theme.css      全站统一视觉变量与公共界面
src/components/Landing.tsx  项目学习入口与真实教学试运行
src/components/KnowledgeMap.tsx 14章目录、先修关系与独立学习记录
src/components/CourseRail.tsx 首页四站入门与完整课程入口
src/components/ChapterReader.tsx 章内动图、代码切换与前后章
src/components/ChapterFilm.tsx 原理数据变化与逐帧展示
src/components/PrincipleTheater.tsx 条件对照、逐步解释与浏览进度
src/components/Workspace.tsx 两次真实运行对照、执行检查与回放
src/data/journey.ts         四节课的问题、改动任务与项目贡献
src/data/lessons.ts         14章概念、预测题与三语言实操入口
src/data/advanced-labs.ts   后十章可执行的本地机制实验
src/data/chapter-films.ts   14章教学动图、证据与范围说明
src/data/theater.ts         教学分镜、参数校验和机制计算
src/data/learning-path.ts   统一课程顺序、分组、学习目标与先修
src/lib/learning-state.ts   旧深度A/B浏览与实操证据
src/lib/chapter-reading.ts  章内动图逐帧浏览记录
src/lib/chapter-navigation.ts 章内导航与返回位置
src/runtime/               Worker、Python桥、工具与模拟模型
src/lib/                   本地存储与学习验收
server/                    模型网关、Vite适配、Worker部署入口
tests/                     工具、模型网关与学习验收测试
```

## 验证与后续

构建与自动测试见 `npm run build`、`npm test`。测试覆盖课程运行证据、工具与网关边界、动图机制与浏览记录；修改实验算法后应同时检查三语言结果和失败分支。网关使用受控上游响应验证，尚未使用真实付费凭证完成提供商端到端验收。

后续可接入真实嵌入与检索服务、持久状态、完整 MCP 传输、原生工具会话、真实流式事件和独立执行服务。当前没有用户账户、云同步、自动视频导出或生产级沙箱。

- 新章节先在 `src/data/learning-path.ts` 登记稳定的 `lessonId`、顺序与先修关系；目录和前后章复用 `LEARNING_PATH` / `chapterPath`，不要另写页码或导航链接清单。
- 以同一 `lessonId` 添加 `chapter-films.ts` 动图、`lessons.ts` / `advanced-labs.ts` 三语代码与边界说明，在 `practice-guides.ts` 将每个分镜绑定到各语言的代表语句、单变量改法与观察点，并在 `progress.ts` 校验本章实际步骤、数据传递与最终输出；自定义步骤记录 `{ input, result }`。
- 提交前运行 `npm test` 与 `npm run build`；`chapter-reader` / `chapter-films` 测试检查全章覆盖和衔接，`advanced-labs` 测试实际执行 TS、JS、Pyodide 的基线及改参，新增章应同步加入这些覆盖检查。
