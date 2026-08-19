# ego-browser Runtime v2

状态：实施中

分支：`2.0.0-beta-dev`

兼容基线：ego-browser 1.2.3

这份文档只说明 v2 要提供的行为、当前实现和剩余工作。设计讨论过程不放在
这里；旧脚本兼容规则见 `docs/legacy-api-compatibility.md`，原生接口见
`docs/native-bindings-api.md`。

## 1. 为什么要改

1.2.3 主要使用全局 helper 和隐式当前 tab。Agent 能很容易打开页面，却很难
在后续轮次里稳定找回并复用它，长任务因此容易堆积大量 tab。

v2 用 `TaskSpace` 和 `Page` 表达空间与页面。页面得到跨轮稳定的标签，例如
`p1`、`p2`。Agent 可以在下一轮取回同一页面，也可以用 `goto()` 原地复用，
不必为每个 URL 新开 tab。

核心目标是：

- 页面可以跨轮找回。
- 默认复用页面，新开页面是明确动作。
- 页面数量有预算上限，达到上限时给出可执行的处理建议。
- 用户页面不会被自动关闭。
- 不依赖 Agent 自己保存 targetId 或手工记账。
- 1.2.3 的旧脚本继续运行。

## 2. 运行环境带来的约束

- 一次 heredoc 通常对应一个短生命周期 Node.js 进程；task space 和 tab 会在
  进程退出后继续存在。
- 跨轮状态只能存放在浏览器和本地状态文件中。
- Ego Lite 的 task-scoped 原生接口依赖 `ego.useTaskSpace(id)` 选择的当前
  space。
- 关闭 space 中最后一个 tab 会关闭整个 space，因此关闭页面时必须保留一个
  `about:blank` anchor。
- 用户接管 space 后，原生层会阻止 Agent 的浏览器操作。
- CLI 和 SDK 是两条启动路径。页面状态必须逐操作持久化，不能依赖轮末异步
  清理。
- 多个进程操作不同 space 是支持场景；多个进程同时写同一 space 不受支持。

当前实现完全基于 v1 原生接口，不要求 Ego Lite 增加 C++ API。

## 3. 运行时路由

### 3.1 Native operation gate

所有新版 TaskSpace 和 Page 操作都经过一个进程级 FIFO：

1. 选择操作所属的 space。
2. 为 Page 取得对应 target 的 CDP session。
3. 执行完整操作并等待响应。
4. 才允许下一个操作选择其他 space。

因此跨 space 的 `Promise.all` 会按提交顺序串行执行。这是 v1 原生“当前
space”模型下的正确性约束，不承诺真正并行。

### 3.2 Per-target browser state

CDP session、事件缓冲、dialog 状态和 Network domain 状态都按 target 保存。
页面关闭或 session 丢失后，只清理对应 target，不影响其他页面。

每页事件缓冲有上限。没有 page 归属的 Target/Browser 事件进入 browser 级
缓冲，不能被 `page.events()` 取走。

### 3.3 Page-scoped refs

原生 snapshot 返回的 ref 仍使用 `@N` 形式。运行时按 targetId 保存 ref map：

- `page.click('@21')` 只在该 Page 的 map 中解析。
- 新进程第一次使用 ref 时，如果该 Page 没有 map，运行时会先对该 Page 重拍
  snapshot。
- ref 不存在时直接报错，不会切到其他页面寻找同号 ref。

裸字符串 `@21` 不包含来源信息。调用方必须把它交给产生该 snapshot 的 Page。

## 4. 页面账本

### 4.1 保存位置和结构

账本位于 `~/.ego-browser/state/`，每个 space 一个 `space-<id>.json`：

```json
{
  "spaceId": 7,
  "nextLabel": 3,
  "usedLabels": ["p1", "p2"],
  "releasedLabels": [],
  "initialized": true,
  "userControlPending": false,
  "unmanagedTargets": {
    "USER_TARGET": "unknown"
  },
  "pages": {
    "p1": {
      "targetId": "TARGET_A",
      "openedBy": "agent"
    },
    "p2": {
      "targetId": "TARGET_B",
      "openedBy": "agent"
    }
  }
}
```

`openPage()`、`adopt()`、`release()` 和 `close()` 在 await 返回前完成写入。写入
使用临时文件和 atomic rename，避免留下半个 JSON 文件。

旧开发版本写入的 `version`、`writerRound`、`handoffBaseline`、`openedAt`、
`lastUsedAt` 和 `touchedAt` 会被读取兼容，并在下一次写入时删除。

### 4.2 标签

- 自动标签依次为 `p1`、`p2`……
- `openPage(url, { as })` 和 `adopt(page, { as })` 可以指定标签。
- 标签在一个 space 的生命周期内永不复用。
- 已关闭标签报 `page pN was closed`。
- 已 release 标签报 `page pN was released`。
- 标签只用于定位 Page，不描述页面业务含义。

### 4.3 浏览器事实与账本事实

浏览器决定一个 tab 是否仍存在；账本决定它是否受 Page 模型管理。
`listPages()`、`openPage()` 等盘点入口会用 `listTabs()` 对账：

- 浏览器中已经消失的受管页面从账本移除，但标签仍保持已使用状态。
- 第一次观察一个 space 时，已有 tab 记为 `unknown`，不会猜测它们由谁创建。
- 在 Agent 持续控制该 space 时，后来出现的新 tab 会自动加入账本。
- 用户控制期间不做自动收编。
- `handOff()` 在交出控制前记录一个待处理的用户控制边界。claim/takeover 后
  第一次盘点把尚未登记的 tab 记为 `unknown`，然后恢复 Agent 新 tab 的自动
  收编。

不同 space 使用不同文件。多个进程同时写同一 space 不受支持，可能
last-writer-wins。如果未来需要支持，必须使用文件锁或 CAS；不维护只能发现
部分竞态的版本号协议。

## 5. 页面生命周期

### 5.1 创建与复用

```js
const task = await taskSpace("research");
const page = await task.openPage("https://example.com");

// 下一轮
const samePage = (await taskSpace("research")).page(page.label);
await samePage.goto("https://example.org");
```

`openPage()` 在返回前确认请求的页面文档已经创建，避免把 Ego Lite 暂时复用的
placeholder 文档当成新页面。创建成功但文档仍未稳定时，标签仍然保留，错误
会提示调用方下一轮如何取回页面。

### 5.2 预算

每个 space 默认最多管理 8 个页面，可用 `EGO_BROWSER_PAGE_BUDGET` 调整。
达到上限时，`openPage()` 和 `adopt()` 在改变浏览器前抛出
`EGO_PAGE_BUDGET_REACHED`，错误中列出已有标签，并给出 `close()` 和
`goto()` 示例。

预算只负责拒绝继续增长，不会自动关闭已有页面。

### 5.3 Adopt 和 release

`task.listPages()` 同时返回受管 Page 和只读 `UnmanagedPage`：

```js
const pages = await task.listPages();
const unknown = pages.find((item) => !item.label);
const adopted = await task.adopt(unknown.page, { as: "reference" });
```

`UnmanagedPage` 只有身份信息，不能直接导航、点击或关闭。调用 `adopt()` 后才
获得完整 Page。

`release(label)` 只允许归还来源为 `unknown` 的页面，并保持浏览器 tab 打开。
Agent 创建的页面不能 release，必须显式 close，避免制造无人管理的 tab。

### 5.4 Popup

高层页面动作会在动作前后比较 tab 列表。立即出现的新 tab 会自动获得标签，
并进入动作回执。传播较慢的 popup 会在下一次 `listPages()`、`openPage()` 或
下一轮盘点时收编。

当 space 从未交给用户控制时，新出现的 tab 可以归因于 Agent 或 Agent 触发的
网页行为。首次接管前已存在和用户控制期间出现的 tab 保守标记为 unknown。

### 5.5 关闭

`page.close()` 的顺序是：

1. 如为最后一个 tab，先创建不受管理的 `about:blank` anchor。
2. 发送 `Target.closeTarget`。
3. 重复 `listTabs()`，确认目标 tab 已消失。
4. 清理 session/ref，并从账本移除页面。

如果目标没有在超时内消失，标签仍保留，调用方可以安全重试。

## 6. TaskSpace 和 Page API

下面是当前已实现的 v2 表面。新版参数中的时间统一使用毫秒。

### 6.1 TaskSpace

```js
const task = await taskSpace(nameOrId);

task.spaceId;
task.name;
task.ownership;
task.page(label);
task.userPage();

await task.listPages();
await task.openPage(url, { as, timeout });
await task.adopt(unmanagedPage, { as });
await task.release(label);
await task.waitForControl({ interval, timeout });
await task.handOff();
await task.finish();
await task.close();
await task.cdp(method, params, { timeout });
```

`spaceId` 是新版名称。`id` 仅作为已有脚本的兼容别名保留，不进入新版 Skill。
`userPage()` 返回 claim/takeover 完成时用户正在看的 tab；它是边界快照，不是
实时 active-page 查询。用户页仍未受管时，必须先 `adopt()` 才能操作。
`finish()` 保留浏览器空间给用户，`close()` 关闭空间；两者成功后都会删除该
space 的 Page 标签状态。

`task.cdp()` 只接受 Target 和 Browser domain 命令。Page domain 命令应通过
具体 Page 发送。

### 6.2 Page

```js
page.targetId
page.spaceId
page.label
page.openedBy

await page.goto(url, { timeout })
await page.snapshot(options)
await page.screenshot({ path, fullPage, clip, raw })
await page.url()
await page.title()
await page.info()
await page.evaluate(fnOrString, arg?)
await page.fetch(url, options)
await page.cdp(method, params, { timeout })
await page.waitForSelector(selector, { timeout, state })
await page.waitForLoadState('domcontentloaded' | 'load' | 'networkidle', { timeout, idleMs })
await page.events()

await page.click(selector, options)
await page.dblclick(selector, options)
await page.hover(selector, options)
await page.dragAndDrop(source, target, options)
await page.fill(selector, value, options)
await page.setInputFiles(selector, path)
const chooserPromise = page.waitForFileChooser({ timeout })
await page.click(selector)
const chooser = await chooserPromise
await chooser.setFiles(path)
await page.scrollBy(deltaY, { deltaX, behavior })
await page.close()
```

`screenshot()` 和 `waitForSelector()` 使用 Playwright 风格的参数。截图路径放在
options 中；`fullPage` 表示捕获完整页面。`waitForSelector()` 的 `state` 支持
`attached`、`detached`、`visible` 和 `hidden`，默认是 `visible`。

文件上传不操作系统文件选择器。已有 file input 时，`setInputFiles()` 直接设置
文件；网站点击后才创建 input 时，先建立 `waitForFileChooser()`，再点击并通过
返回的 chooser 设置文件。普通输入动作意外打开 chooser 时，runtime 会在系统
弹窗出现前取消，并提示改用这两个接口。

`page.fetch()` 是 Ego 提供的便利扩展，不是 Playwright 方法。它在目标页面内
执行 `window.fetch()`，因此使用该页面的相对 URL、Cookie、CORS 和 service
worker。返回值为：

```js
{
  ok,
  status,
  statusText,
  url,
  headers,
  body,
}
```

后台 Node 请求直接使用标准 `fetch()`；旧 `serverFetch()` 只为 v1 脚本保留。

### 6.3 Mouse 和 keyboard

```js
await page.mouse.click(x, y, options);
await page.mouse.move(x, y, { steps });
await page.mouse.down(options);
await page.mouse.up(options);
await page.mouse.wheel(deltaX, deltaY);

await page.keyboard.down(key);
await page.keyboard.up(key);
await page.keyboard.press(chord, { delay });
await page.keyboard.type(text, { delay });
await page.keyboard.insertText(text);
```

键盘和鼠标状态保存在 Page 对象中。`ControlOrMeta` 会按当前平台映射；macOS
编辑快捷键通过 CDP editing commands 发送。

Page 对象只在当前脚本轮次内存在，因此鼠标位置不会跨轮保留。新一轮取得 Page
后，`page.mouse` 从 `(0, 0)` 开始；调用 `wheel()` 前应先用 `move()` 把鼠标移到
实际要滚动的区域。`ControlOrMeta` 用于选择、复制、粘贴和撤销等跨平台编辑
快捷键。文档首尾按平台使用原生组合：macOS 使用
`Meta+ArrowUp` / `Meta+ArrowDown`，Windows 使用
`Control+Home` / `Control+End`。单元测试固定覆盖 `darwin` 和 `win32` 两套映射，
真实浏览器 E2E 则验证当前宿主平台。

新版没有 `page.keyboard.dispatch()`。它只能在页面中合成
`KeyboardEvent`，`isTrusted=false`，也不能可靠触发剪贴板和浏览器默认行为。
确实需要合成事件时，调用方可以显式使用 `page.evaluate()`。

每次成功的 `mouseMoved`，以及有明确目标元素的 `fill()`，都会非阻塞地通知
Ego Lite 更新 Agent 光标。`fill()` 只更新可见光标，不会额外向网页发送鼠标事件。
光标动画失败不会让已经完成的网页动作失败。`page.keyboard` 没有目标元素信息，
因此不会自行移动光标。

## 7. Page 操作语义

### 7.1 激活规则

下面的操作会先激活目标 Page：

- snapshot、screenshot
- goto、evaluate、fetch、page.cdp
- selector action 和 wait
- mouse、keyboard、scrollBy

`url()`、`title()`、`info()` 和 `events()` 是纯读取，不改变当前激活页。

激活目标页是有意行为。真实 Ego Lite 测试中，后台页输入曾出现 CDP 超时并
退化为 `isTrusted=false` 的合成事件；激活后可保持正常 CDP Input 路径。

### 7.2 高层动作回执

`goto()`、selector action、`mouse.click()` 和 `keyboard.press()` 返回轻量
popup 回执：

```js
{
  popups?: [{ label, targetId }]
}
```

高层动作只比较动作前后的 tab 列表，不向页面安装观察脚本。导航、表单和 DOM
结果应通过 `url()`、`waitForSelector()`、`snapshot()` 或读取页面状态确认。

底层原语不安装动作探针，也不等待 50ms 反馈窗口：

- mouse.move/down/up/wheel
- keyboard.down/up/type/insertText
- scrollBy

这些方法在输入完成后 resolve `undefined`。它们产生的延迟 popup 仍可由统一
盘点收编。

### 7.3 Snapshot

原生 snapshot 只能观察当前激活页，因此 `page.snapshot()` 在 gate 内先激活
目标 Page，再调用原生 snapshot。返回文本前带一行简短来源信息，包括 Page
标签、space、受管页面数量、账外页面数量和接近预算时的提示。

snapshot 每次返回全量内容。当前不提供 `diff`：一轮一个短进程时内存基线
无法帮助跨轮任务，简单行 diff 在页面变化较大时还可能比全量更大。

### 7.4 Evaluate

`page.evaluate()` 接受字符串表达式，或者函数和一个可选 JSON 参数：

```js
await page.evaluate(
  ({ selector, value }) => {
    document.querySelector(selector).textContent = value;
    return document.title;
  },
  { selector: "#status", value: "done" },
);
```

函数参数和返回值限定为 JSON 可序列化子集。函数通过
`Runtime.callFunctionOn` 执行，不使用字符串插值拼接参数。

## 8. 用户控制

用户接管后，Ego Lite 原生层会返回 `EGO_TASK_SPACE_USER_IN_CONTROL`。新版
运行时保持以下边界：

- 不在用户控制期间自动盘点或收编 tab。
- 不把 unknown 页面推断成 Agent 页面。
- 错误由统一 hard-stop 输出处理，避免循环脚本反复打印同一接管提示。

TaskSpace 提供 `handOff()` 和毫秒制 `waitForControl()`。用户明确要求恢复后，
`takeOverTaskSpace(spaceId)` 直接返回新的 TaskSpace；接管 user-owned 或
inactive space 时，`claimTaskSpace(spaceId)` 也直接返回 TaskSpace。
claim 以及确实从用户控制返回 Agent 的 takeover，会捕获用户当时激活的 tab，
并完成一次边界盘点。对已由 Agent 控制的 space 重复 takeover，不会重新归类
现有 tab。

结束时调用 `task.finish()` 保留浏览器空间，或调用 `task.close()` 关闭空间。
`claimTaskSpace()` 和 `takeOverTaskSpace()` 是取得对象前的入口。旧的
`handOffTaskSpace()`、`completeTaskSpace()` 和 `waitForAgentControl()` 只为兼容
保留，不进入新版 Skill。

## 9. 输出

新版脚本使用 `console.log/info/warn/error`。这些输出先写入当前轮的内存 sink：

- 普通完成或普通异常时按原顺序 flush。
- 用户接管等 hard stop 时丢弃业务输出，只保留一条统一指引。

SDK 路径不经过 CLI 的 execute 包装，因此在进程生命周期事件中同步 flush。
长脚本的日志要等整轮结束后才能显示，这是当前 hard-stop 丢弃语义的代价。

旧 `cliLog()` 保持运行时兼容，但不会进入新版默认文档。

## 10. v1 兼容

2.x 继续注入 1.2.3 的旧全局 helper。已有用户脚本不需要改写，参数、错误、
副作用和秒制时间语义保持不变。claim/takeover 的成功返回值只增加 TaskSpace
能力，原有描述字段仍保留。

新版 SKILL 和默认 `help()` 展示 TaskSpace/Page API，以及取得 TaskSpace 所需的
claim/takeover 入口；其余旧名称只对已有脚本和显式 legacy 查询可见。不要为了
复用新版实现而悄悄改变旧 helper 行为。

V2 API 的签名、options 校验、默认 help manifest 和
`skills/ego-browser/references/api.md` 来自同一份
`package/ego-browser/src/public-api-schema.ts`。旧 helper 继续注入；需要查看时用
`help("legacy")` 或 `help("legacy", "click")`。

站点 site skills 暂时继续使用 legacy surface，后续再按 Page 能力注入方式
迁移。

## 11. 实施状态

公共 API schema、默认 V2 help、显式 legacy help、生成式 API 参考和用户页面
边界已经实现。真实 Ego Lite E2E 已覆盖兼容接口、TaskSpace/Page、多 space、
popup 盘点兜底、键鼠、CDP、snapshot 和视觉链路。site skills 暂时保持 legacy
surface，不属于本阶段。

不在当前范围内：

- 常驻 daemon。
- snapshot diff 或跨轮 ref 内存缓存。
- 同一 space 的多进程写入。
- 新的 C++ 原生接口。
- 自动关闭旧页面或轮末 GC。

## 12. 验收

代码合入前至少覆盖：

- 多轮凭标签取回同一 Page，`goto()` 不增加 tab。
- 多个 Page 的 session、事件和同号 ref 不串页。
- 跨 space 操作按 gate 串行并落到正确 space。
- 页面预算在创建前拒绝，错误给出可执行的 close/goto 建议。
- 首次存在的 unknown tab 不被自动收编；Agent 控制期间的新 tab 会被收编。
- handoff 期间用户新开的 tab 在 takeover 后保持 unknown；`userPage()` 返回边界
  时激活的 tab。
- popup 可由动作回执立即收编；即使动作回执漏记，后续盘点也会补回账本。
- `Page.close()` 确认 tab 消失后才删除标签，最后 tab 有 anchor。
- screenshot、evaluate、fetch、键盘和鼠标都操作并激活指定 Page。
- 页面动作不安装观察探针；高层动作仍能返回 popup 回执。
- `keyboard.press()` 产生 native/trusted 输入；新版不暴露 synthetic dispatch。
- snapshot 始终返回全量并标明来源，不接受 `diff`。
- 旧格式账本能读取，并在下一次写入时删掉过期字段。
- 1.2.3 代表性脚本原样通过。
- 默认 help 只展示 V2；显式 legacy help 仍可查询旧 helper。
- API 参考与公共 schema 保持同步。
- `npm test` 和真实浏览器 E2E 全绿。
