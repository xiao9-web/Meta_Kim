# Meta_Kim 新手完全指南

> 你不需要有任何基础。读完这篇，你就能明白这个项目是什么、为什么要这样设计、它具体怎么运转。

---

## 第一部分：先搞清楚"它在解决什么问题"

### 用 Claude Code 写代码时，你遇到过这些吗？

你让 Claude 帮你开发一个功能，Claude 直接开始写代码。写完了你一看，跑不起来，或者和其他模块冲突了。你问它为什么，它说"我以为你的意思是……"

或者你让它做一个复杂任务，它改了七八个文件，改完你不知道它改了什么、对不对、有没有漏掉什么。

**核心问题：Claude 太急着"动手"，没有先"想清楚"。**

---

### 现实工程是怎么工作的？

一个成熟的工程团队接到需求，不会让一个工程师独自扑上去写。流程大概是：

```
产品经理澄清需求
    ↓
架构师评估可行性、拆解任务
    ↓
各专业工程师分别执行
    ↓
代码审查（Review）
    ↓
测试验证
    ↓
总结经验，下次更好
```

**Meta_Kim 就是把这套流程装进 Claude Code。**

它不是让 Claude 更聪明，而是给 Claude 加了一套**工作规范**：先想清楚、再分工、再执行、再审查、最后沉淀经验。

---

## 第二部分：Meta_Kim 是什么（用最简单的比喻）

想象你开了一家软件公司，员工全是 AI：

```
公司名：Meta_Kim

总经理（meta-warden）     ← 负责拍板、质量把关、最终决策
  │
  ├── 流程主管（meta-conductor）   ← 负责"接单→拆任务→分配→收活"的全流程
  ├── 角色设计师（meta-genesis）   ← 负责设计每个员工的职责边界
  ├── 工具专家（meta-artisan）     ← 负责给每个员工配备合适的工具
  ├── 安全官（meta-sentinel）      ← 负责拦截危险操作、管理权限
  ├── 档案员（meta-librarian）     ← 负责记录信息、管理"公司记忆"
  ├── 质检员（meta-prism）         ← 负责审查每次工作的质量
  └── 外采专员（meta-scout）       ← 负责发现外部新工具和新能力
```

你（用户）是**客户**，把需求交给这家公司，公司内部自己协作完成，交付结果给你。

---

## 第三部分：一次任务是怎么流转的（8 个步骤）

假设你说了一句话：**"帮我给这个项目加一个用户登录功能。"**

Meta_Kim 不会立刻开始写代码。它会走以下 8 步：

---

### 步骤 1 — Critical（搞清楚你真正要什么）

> **比喻：需求澄清会**

如果需求不清楚，流程主管会先问：

- 用邮箱登录还是手机号？
- 需要第三方登录（微信/Google）吗？
- 是否已有数据库？

如果需求很清楚，跳过这步，但**必须写下跳过的原因**（不能偷偷跳过）。

产出：`intentPacket`（一张锁定了"你真正要什么"的确认单）

---

### 步骤 2 — Fetch（先找现有能力，别重复发明）

> **比喻：先查仓库，再采购**

流程主管搜索：
- 项目里有没有已有的认证模块？
- 有没有合适的工具或 agent 可以直接用？
- 能力索引里有没有人声明"我负责认证功能"？

搜索顺序是固定的（从近到远）：
```
项目内能力索引 → 运行时镜像 → 本地全局库存 → 最后才考虑"从零开始"
```

---

### 步骤 3 — Thinking（拆任务、指定负责人）

> **比喻：项目启动会，定好谁干什么**

产出一张**分派看板（dispatchBoard）**，明确写：

| 子任务 | 负责人 | 依赖关系 | 可否并行 |
|--------|--------|----------|----------|
| 设计数据库 schema | 后端 agent | 无 | 可并行 |
| 写登录 API | 后端 agent | 依赖 schema | 串行 |
| 写前端登录页 | 前端 agent | 依赖 API | 串行 |

**关键规则：** 没有依赖关系的任务必须并行跑，不能傻乎乎地一个一个来。

---

### 步骤 4 — Execution（真正开始干活）

> **比喻：各部门分头执行**

流程主管通过 Claude Code 的 `Agent` 工具，把任务打包发给对应的专业 agent。

**重要**：`meta-theory` 这个技能本身**不写代码**。它只负责调度，实际写代码的是它派出去的子 agent。

就像项目经理不写代码，程序员才写。

---

### 步骤 5 — Review（检查工作质量）

> **比喻：代码审查**

质检员（meta-prism）检查：
- 代码质量
- 安全漏洞
- 有没有越界（干了不该干的事）

产出 `reviewPacket`，里面列出所有问题（finding），每个问题都标了严重等级（CRITICAL / HIGH / MEDIUM / LOW）。

---

### 步骤 6 — Meta-Review（检查"检查本身"是否靠谱）

> **比喻：让总经理审查质检员的标准**

如果质检员每次都说"通过"，那标准是不是太松了？
如果质检员每次都挑一堆毛病，那标准是不是太严了？

这一步专门检查**审查标准本身**，防止"假通过"。

```
如果通过率 > 90% 且结果明显有问题 → 标准太松，强制重审
如果通过率 < 30% 且结果看起来合理 → 标准太严，需要校准
```

---

### 步骤 7 — Verification（确认问题真的被修了）

> **比喻：测试验收**

Review 发现了问题，agent 说"修好了"。

但"说修好了"≠"真的修好了"。

Verification 要看：
- `fixEvidence`：有没有具体证明修了？（不是口说，要有文件/代码为证）
- `closeFindings`：每个问题都关闭了吗？

**没有全部关闭，不能进下一步。**

---

### 步骤 8 — Evolution（沉淀经验）

> **比喻：项目复盘，写进公司知识库**

这次任务学到了什么？记录下来：
- 可复用的模式 → 写入 `memory/patterns/`
- 踩过的坑 → 写入 `memory/scars/`（伤疤记录）
- 发现了能力缺口 → 记入 `memory/capability-gaps.md`，通知外采专员去找

**不沉淀经验的任务等于白做。**

---

## 第四部分：Hook 系统（自动执法）

Meta_Kim 最神奇的地方是：很多规则**不需要你记住**，系统自动触发。

这是通过 Claude Code 的 **Hook 系统**实现的。Hook 就是"当某件事发生时，自动运行某个脚本"。

```
你做了什么         系统自动做什么
─────────────────────────────────────────────────────
要执行 Bash 命令  → 先检查命令是否危险（rm -rf /、git reset --hard 等一律拦截）
要执行 git push   → 先弹出确认提示，防止误推
编辑/写入了文件   → 自动格式化代码
编辑/写入了文件   → 自动做类型检查
编辑/写入了文件   → 如果有 console.log 给你看到警告
启动子 agent      → 自动注入 Meta_Kim 规则（让子 agent 也懂规矩）
会话结束          → 自动把本次对话摘要保存到记忆服务
会话结束          → 自动写"断点续传包"（下次会话能知道上次干到哪）
会话结束          → 自动审查 console.log 使用是否规范
```

你什么都不用做，这些都在后台自动运行。

---

## 第五部分：三层文件结构（为什么文件这么复杂）

很多人看到这个项目一堆目录就晕了。其实只有三层：

### 第一层：你手动维护的（真相之源）

```
canonical/agents/       ← 8 个 meta agent 的完整定义
canonical/skills/       ← meta-theory 技能的完整定义
canonical/runtime-assets/ ← 各平台的模板（hooks、settings 等）
config/contracts/       ← 工作流合同（规定每步要交什么）
config/capability-index/ ← 能力索引（谁能做什么）
```

**这是你唯一应该手动修改的地方。**

### 第二层：自动生成的（不要手改）

```
.claude/agents/         ← 从 canonical/ 同步来的 Claude Code 版本
.claude/hooks/          ← 从 canonical/ 同步来的
.claude/settings.json   ← 从 canonical/ 同步来的
.codex/                 ← 给 Codex 的版本
.cursor/                ← 给 Cursor 的版本
openclaw/               ← 给 OpenClaw 的版本
```

**这些文件手改没用，下次 sync 会覆盖。**

### 第三层：运行时状态（自动产生）

```
.meta-kim/state/        ← 本地状态（能力索引快照、compaction 包等）
memory/                 ← 沉淀的经验（patterns、scars、capability-gaps）
graphify-out/           ← 代码知识图谱（压缩版代码地图）
```

---

## 第六部分：同步机制（改了 canonical 怎么让它生效）

改了 `canonical/` 里的文件后，需要运行：

```bash
npm run meta:sync       # 把改动同步到所有平台的运行时目录
npm run meta:validate   # 验证同步结果是否合法
```

这两步做的事：
1. 把 `canonical/agents/*.md` 复制并投影到 `.claude/agents/`、`.codex/agents/`、`.cursor/agents/`
2. 把 `canonical/skills/meta-theory/` 复制到各平台的 skills 目录
3. 把 `canonical/runtime-assets/claude/hooks/` 复制到 `.claude/hooks/`
4. 用模板生成 `.claude/settings.json`（里面注册了所有 Hook）
5. 验证所有文件结构是否符合规范

---

## 第七部分：能力优先（最重要的设计哲学）

这是 Meta_Kim 和"普通让 Claude 做事"最大的区别。

### 普通方式
```
用户：帮我审查代码质量
Claude：好，我来审查……（自己动手）
```

### Meta_Kim 方式
```
用户：帮我审查代码质量
meta-theory：
  1. 需要的能力是："code quality review"
  2. 搜索能力索引——找到 meta-prism 声明了这个能力
  3. 派任务给 meta-prism
  meta-prism：（执行审查）
```

**为什么要多此一举？**

因为能力索引是可以扩展的。今天审查代码用 meta-prism，将来你装了更强的第三方 agent，只需要在能力索引里更新一下，系统自动用更强的。代码完全不用改。

---

## 第八部分：记忆系统（让 Claude 记住上次干了什么）

Claude Code 默认是"失忆"的——每次会话结束，什么都不记得。

Meta_Kim 用三层方式解决这个问题：

### 第一层：MCP Memory Service（跨会话记忆）

会话结束时，`stop-memory-save.mjs` 自动运行，把本次会话摘要 POST 到本地运行的 MCP Memory 服务。下次打开会话，这些记忆可以被检索到。

### 第二层：graphify 代码知识图谱

```bash
npm run meta:graphify:install  # 安装
```

安装后，graphify 会分析你的代码库，生成一个压缩版的"代码地图"（`graphify-out/graph.json`）。

体积是原始代码的 **1/71**。Agent 读这个图就能快速理解代码结构，不用把所有文件都读一遍。

### 第三层：文件记忆（memory/ 目录）

```
memory/
├── patterns/     ← 可复用的解决方案模板
├── scars/        ← 踩过的坑（"上次这么做翻车了"）
└── capability-gaps.md ← 发现了什么能力还没有
```

---

## 第九部分：常见问题

**Q：我必须用所有 8 个 meta agent 吗？**

A：不是。简单任务系统会自动跳过不需要的步骤，但必须说明为什么跳过，不能悄悄跳过。

---

**Q：meta-theory 和 meta-warden 有什么区别？**

A：

- `meta-theory` 是一个**技能（skill）**，是整个治理流程的入口，负责分类任务（是 A/B/C/D/E 哪种类型）然后派出去。
- `meta-warden` 是一个**agent**，负责最终的质量把关和仲裁。

用公司比喻：meta-theory 是"接单系统"，meta-warden 是"总经理"。

---

**Q：我能只用 Claude Code，不用其他平台吗？**

A：完全可以。Codex / OpenClaw / Cursor 是可选的。如果只用 Claude Code，安装时选 `claude` 即可。

---

**Q：graphify 是必须安装的吗？**

A：不是必须的。但如果你的项目文件超过 20 个，强烈建议安装。它让 agent 能更快、更准确地理解你的代码库。

---

**Q：改了 canonical/ 里的文件，但没有运行 meta:sync，会怎样？**

A：Claude Code 运行时读的是 `.claude/` 目录，不是 `canonical/`。所以你改了 canonical 但没同步，Claude Code 看到的还是旧版本，改动完全不生效。

---

## 第十部分：快速上手路径

如果你是第一次用，按这个顺序走：

```
第一步：安装
node setup.mjs

第二步：验证安装
npm run meta:status

第三步：试一个简单任务
在 Claude Code 里说：/meta-theory 帮我分析一下这个项目的结构

第四步：看看它做了什么
它会一步步走 Critical → Fetch → Thinking，把过程展示出来

第五步：改规则（可选）
编辑 canonical/agents/meta-warden.md
然后运行 npm run meta:sync
```

---

## 总结：一句话记住每个东西

| 名称 | 一句话 |
|------|--------|
| **Meta_Kim** | 给 AI 编码助手装上"公司治理"大脑 |
| **8 阶段脊柱** | 先想→找→规划→分工→干→审→验→总结 |
| **meta-warden** | 公司总经理，拍板和把关 |
| **meta-conductor** | 流程主管，负责分派任务和掌控节奏 |
| **meta-theory（skill）** | 接单系统，判断任务类型然后调度 |
| **canonical/** | 唯一真相，只改这里 |
| **meta:sync** | 把 canonical/ 的改动同步到所有平台 |
| **Hooks** | 后台自动执法员，不需要你操心 |
| **能力优先** | 先定义需要什么能力，再找谁来做 |
| **graphify** | 代码库的压缩地图，让 agent 不用读所有文件 |
| **memory/** | 公司知识库，沉淀经验教训 |
