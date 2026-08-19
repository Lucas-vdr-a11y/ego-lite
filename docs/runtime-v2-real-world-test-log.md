# Runtime v2 真实网站测试记录

这份文档记录使用项目内最新版 Skill 和本地编译 Runtime 进行真实网站测试时的
结果。这里只记录能够复现、值得后续处理的问题，不把网站本身的限制直接算作
Runtime 缺陷。

问题分为两类：

- **A：工具缺陷**——实际行为错误、数据丢失或与方法承诺不一致。
- **B：API 与使用体验**——行为可能有合理解释，但不符合常见预期、缺少说明，
  或使用起来容易踩坑。

## 测试环境

- 日期：2026-08-19
- 分支：`2.0.0-beta-dev`
- Commit：`220c2a4`
- Runtime：`package/ego-browser/dist/out/index.js`
- Skill：`skills/ego-browser/SKILL.md`
- 加载方式：`ego-browser nodejs --sdk-path <local-runtime>`

## 已完成测试

| 编号  | 网站           | 主要覆盖                                                                              | 结果                           |
| ----- | -------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| T-001 | Google Docs    | Page 跨轮恢复、页面激活、snapshot、截图、标题与正文输入、快捷键、云端保存             | 完成，发现 A-001、A-005、B-001 |
| T-002 | Google Sheets  | canvas 坐标操作、单元格编辑、数字与公式输入、拖拽选区、工具栏操作、跨轮恢复、云端保存 | 完成，再次复现 A-001           |
| T-003 | NASA Worldview | 重型地图渲染、地点搜索、日期输入、canvas 缩放与拖拽、视觉验证、跨轮恢复               | 完成，发现 A-006               |
| T-004 | BBC News       | 长页面 snapshot、生成 locator、文章导航、浮层、滚动、截图、跨轮恢复                   | 完成，发现 A-002、A-003、A-004 |
| T-005 | Excalidraw     | 多 canvas、工具栏操作、鼠标绘制、文本输入、撤销/重做、重新加载、跨轮恢复              | 通过，未发现新问题             |
| T-006 | 2048           | canvas 游戏、高频方向键、动画状态、DOM 分数、跨轮续玩                                 | 通过，未发现新问题             |

## A：工具缺陷

### A-001 `Page.keyboard.type()` 在 Google Web 应用中丢失数字并错放符号

**重要程度：高**

**状态：已修复并验证（2026-08-19）**

在已聚焦的 Google Docs 标题输入框和正文编辑区中，英文与空格可以正常输入，
但数字会丢失，连字符可能出现在错误位置。

复现代码：

```js
await page.click('input[aria-label="重命名"]');
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("Ego Runtime v2 Google Docs Test 2026-08-19", {
  delay: 5,
});
await page.keyboard.press("Enter");
```

预期标题：

```text
Ego Runtime v2 Google Docs Test 2026-08-19
```

实际标题：

```text
-Ego Runtime v Google Docs Test 0-09
```

正文中的 `v2` 同样变成了 `v`。作为对照，在相同 Page 和焦点条件下使用：

```js
await page.keyboard.insertText("Ego Runtime v2 Google Docs Test 2026-08-19");
```

数字和连字符可以完整保存。因此问题更可能位于 `keyboard.type()` 的物理按键映射
或事件序列，而不是 Page 路由、页面激活、焦点或 Google Docs 保存。

Google Sheets 中也能稳定复现。向 A1 输入：

```js
await page.keyboard.type("SKU-2026", { delay: 10 });
```

单元格实际只得到 `SKU-`。同一张表中，先双击进入单元格编辑态，再使用
`keyboard.insertText()`，`2`、`4`、`12.50`、`3.25` 和公式均可完整保存。这说明
问题不是 Google Docs 特例。

根因不在 Google：普通 `<input>` 和 `contenteditable` 也能稳定复现。数字字符被
错误映射成了 `Numpad0` 至 `Numpad9`；部分小键盘事件没有产生 `beforeinput`，所以
字符丢失。`NumpadDecimal` 还会覆盖主键盘的 `.`。

我们的键盘布局构造漏掉了 Playwright 的一项规则：带非零 `location` 的数字小键盘
定义只能通过 `NumpadX` 这类物理键名访问，不能参与字符到物理键的反向映射。修复后
数字使用 `Digit0` 至 `Digit9`，句点使用 `Period`。

验证结果：

- 新增单元回归，固定数字与句点的 `code` 和 `location`，并验证组合键失败后会释放
  modifier；完整测试 184/184 通过。
- 真实 Chromium 中，普通输入框完整得到 `SKU-2026 = 12.50`。
- Google Docs 标题完整保存为 `Ego keyboard regression 2026-08-19`。
- 95 个可打印 ASCII 字符逐一输入，实际值与预期值完全一致。
- 新增 `Page keyboard interface` 真实浏览器 E2E，覆盖 `down()`、`up()`、`press()`、
  `type()`、`insertText()`、可信事件、按键重复、编辑键、显式小键盘和错误后的状态
  恢复；全量真实 E2E 29/29、600 项断言通过。

### A-002 `Page.click()` 会点击被浮层遮挡的目标坐标

**重要程度：高**

**状态：已修复并验证（2026-08-20）**

BBC 文章页同时显示了底部 cookie 提示和位于上层的登录弹窗。snapshot 中
`@12521` 是底部的 “Reject additional cookies”。调用：

```js
await page.click("@12521");
```

没有报错，但 cookie 提示仍在，上层 “Maybe later” 弹窗反而消失。弹窗消失后再次
点击当前 snapshot 中同一个 `@12521`，cookie 提示才正常关闭。

这说明元素解析正确，但实际指针事件被覆盖在目标上方的浮层接收了。高层
`click()` 应在点击前确认目标中心的 hit target，遇到遮挡时重试或稳定报错，不能
静默触发另一个控件。低层 `mouse.click()` 不需要提供这项保证。

根因是 `resolveElementPoint()` 只检查目标尺寸、坐标和 viewport，没有检查该坐标
实际会命中哪个元素。修复参考 Playwright 的 hit-target 判断：命中元素必须是目标
本身或它在 composed tree 中的后代，因而也能正确处理普通子元素、slot 和 shadow
root。高层点击在计算坐标时检查一次，移动鼠标后、每次按下前再检查一次；遮挡时
抛出 `intercepts pointer events`，不派发按下或点击事件。

这项修复没有增加自动等待。临时浮层仍存在时，调用方会立即得到稳定错误；移除或
等待浮层消失后可以再次调用。`page.mouse.click(x, y)` 是低层坐标接口，仍会点击该
坐标上最上层的元素。

验证结果：

- 新增单元回归，确保被遮挡的高层点击不会派发鼠标输入。
- 新增独立 `Page click hit target` 真实浏览器 E2E，覆盖静态遮挡、鼠标移动后才出现
  的遮挡、合法子元素命中、移除浮层后恢复，以及低层坐标点击的原有语义。
- 完整测试 185/185 通过；全量真实 E2E 30/30、611 项断言通过。

### A-003 页面滚动后，默认 `Page.screenshot()` 返回白图

**重要程度：高**

**状态：已修复并验证（2026-08-20）**

BBC 文章页在顶部截图正常。执行：

```js
await page.scrollBy(1800, { behavior: "instant" });
await page.screenshot({ path: "/tmp/default.png" });
```

得到整张白图。此时页面事实仍正常：`scrollY === 1800`、`scrollHeight === 6402`，
DOM 中也有文章内容。等待三秒后重试仍为白图；滚回顶部后截图立即恢复。

对照调用可以正确截到滚动位置：

```js
await page.screenshot({ path: "/tmp/raw.png", raw: true });
```

根因是默认实现构造 clip 时固定使用 `x: 0, y: 0`，没有包含
`scrollX/scrollY`；同时非 full screenshot 又关闭了 `captureBeyondViewport`。
CDP 把 clip 解释为文档坐标，所以页面滚动后实际截取的仍是文档顶部。

修复后，普通 viewport 截图以当前 `scrollX/scrollY` 作为 clip 起点；完整页面截图
仍从 `(0, 0)` 开始，显式 clip 和 raw 模式保持原样。

验证结果：

- 新增单元回归，固定横向和纵向滚动、viewport 尺寸及 DPR，检查最终发送给 CDP
  的 clip 坐标和 scale。
- 新增 `Page scrolled screenshot` 真实浏览器 E2E。测试页面在文档顶部放白色区域，
  滚动后的 viewport 放高对比度图案，并直接解码 PNG 取样；默认截图与 raw 截图的
  25 个取样点都正确落在彩色区域。
- 完整测试 186/186 通过；全量真实 E2E 31/31、624 项断言通过。

### A-004 snapshot 生成的 `loc=href:` 可能立即不可用

BBC 首页 snapshot 为一篇文章给出了：

```text
loc=href:/news/articles/c235dmndylzo
```

直接调用 `page.click()` 时，Runtime 报该 locator 命中 5 个元素。改用包含完整文章
标题的 role locator 后导航正常。页面为了响应式布局重复同一链接很常见；如果
snapshot 将 `loc=` 作为可复用 locator 输出，生成阶段应验证它在当前页面唯一，
否则应标为 `loc=ambiguous` 或只给 ref。

### A-005 Ego Lite 启动器没有转发 Runtime 配置环境变量

以下调用在 SDK Node 进程中读到的值是 `undefined`：

```bash
EGO_BROWSER_AGENT_WORKSPACE=/path/to/skill \
  ego-browser nodejs --sdk-path <local-runtime> <<'EOF'
console.log(process.env.EGO_BROWSER_AGENT_WORKSPACE)
EOF
```

这不是 Runtime 主动删除变量。真实浏览器 E2E 已明确注明 Ego Lite launcher 不会
向 SDK Node 进程转发任意环境变量，并通过在 heredoc 内修改 `process.env` 绕过。
但 Runtime README 同时要求用户从 shell 设置 `EGO_BROWSER_AGENT_WORKSPACE`，两者
互相矛盾。

启动器至少应转发受支持的 `EGO_BROWSER_*` 白名单，或者提供明确的启动参数和配置
对象。否则 Runtime 已公开的 workspace、状态目录、页面预算等配置无法按文档使用。

### A-006 `Page.waitForLoadState()` 缺少 `domcontentloaded`

下面的常见调用会直接抛错：

```js
await page.waitForLoadState("domcontentloaded", { timeout: 45_000 });
```

当前类型、实现和测试都只接受 `load` 与 `networkidle`。这是此前主动缩小的实现
范围，不是底层无法支持；可以通过 `document.readyState !== 'loading'` 或 CDP 的
DOMContentLoaded 事件实现。

既然 API 使用了 Playwright 同名方法和参数形状，应补齐 `domcontentloaded`，而不
只是依赖文档提醒用户这是一个子集。

## B：API 与使用体验

### B-001 snapshot 展示的是语义角色，不是 HTML 标签名

Google Docs 的 snapshot 显示了保存状态按钮，例如：

```text
button "文档状态：已保存到云端硬盘。"
```

使用者很容易把这里的 `button` 理解为 HTML `<button>`，进而写出：

```js
await page.waitForSelector('button[aria-label*="已保存"]', {
  state: "visible",
});
```

实际元素是带有 `role="button"` 的 `<div>`。下面两种等待均已在同一文档中验证
通过：

```js
await page.waitForSelector('[role="button"][aria-label*="已保存"]');
await page.waitForSelector(
  'loc=role:button[name="文档状态：已保存到云端硬盘。"]',
);
```

这不是 selector 实现错误，但 snapshot 的树形表示容易让人混淆语义角色与 DOM
标签。Skill 应明确这一点，并优先建议直接使用 snapshot 给出的 `@N` 或
`loc=role:`，不要根据显示的角色名称自行拼接 CSS 标签选择器。

建议在 Skill 中同时说明三种定位方式的适用范围：

- 当前 snapshot 后立即操作时，使用 `@N`。
- 需要语义稳定性时，优先使用 snapshot 给出的 `loc=role:`。
- 只有确认了真实 DOM 结构后才使用 CSS；不要把 snapshot 中显示的语义角色直接
  当作 HTML 标签名。

可以使用下面这段简短说明：

```md
Snapshot node names such as `button` and `textbox` are accessibility roles,
not necessarily HTML tag names. Use `@ref` for immediate actions, prefer the
generated `loc=role:` for semantic reuse, and use CSS only when the actual DOM
structure is known.
```

这项说明不能代替 A-004 的修复。Runtime 仍应保证生成的 `loc=` 在当前页面可用，
不能只依靠 Skill 让 Agent 避开不唯一的 locator。

### B-002 输入动作没有同步移动可见 Agent 光标

**状态：已修复（2026-08-20）**

此前可见 Agent 光标只跟随 `mouseMoved`。`page.fill(selector, value)` 会直接聚焦
输入元素并输入内容，因此旁观者能看到文字出现，却看不到 Agent 当前在操作哪个
输入框。

现在 `fill()` 聚焦成功后会取目标元素当前可见部分的中心，并非阻塞地更新 Ego Lite
光标。这个提示不会向网页额外发送 `mousemove`，也不会改变输入事件序列；光标动画
失败或目标没有可见区域时，填入本身仍正常完成。

纯 `page.keyboard` 调用没有 selector，也无法可靠知道调用方想表达哪个视觉目标，
所以不会自行移动光标。需要明确视觉上下文时，应先 `click()` 或 `fill()` 一个具体
元素。单元回归已确认 `fill()` 会更新可见光标，同时不会增加网页鼠标事件。

## 已确认不是问题的现象

- Google Docs 正文主要由 canvas 和隐藏输入入口实现，snapshot 没有完整返回
  正文，但截图可以正确观察。这符合 Skill 对富文本和 canvas 页面优先使用视觉
  路径的说明。
- 通过 `spaceId + Page label` 在多个 heredoc 中找回同一 Google Docs Page 正常。
- `keyboard.insertText()`、一级标题快捷键、项目符号、粗体、截图和云端保存正常。
- Google Sheets 中通过双击进入编辑态后，逐格输入、公式计算、拖拽选择、工具栏
  加粗和跨轮 Page 恢复均正常；`SUMPRODUCT(B4:B5,C4:C5)` 正确得到 `38`。
- NASA Worldview 的 WebGL/canvas 卫星图能正常截图；地点搜索、日期表单、按钮缩放、
  低层鼠标拖拽和跨轮恢复均正常。拖拽后 URL 中的视野坐标与截图同步变化。
- BBC News 的约 59 KB 首页 snapshot 和约 39 KB 文章 snapshot 均完整可读；使用
  唯一 role locator 导航、长文滚动、`raw` 截图和跨轮恢复正常。
- Excalidraw 中的矩形、椭圆、箭头和文本均可正常创建；文本中的 `v2`、日期和
  连字符由 `insertText()` 完整保留。撤销、重做、同 Page 重新加载后的浏览器存储
  恢复，以及跨轮 Page 恢复均正常。canvas 内容不进入语义 snapshot，使用截图
  验证，符合 Skill 指引。
- 2048 中连续 24 次方向键操作后分数从 0 增至 144；换一个 heredoc 找回同一
  Page 后继续 16 次操作，分数增至 272。键盘事件、canvas 动画、DOM 分数与视觉
  状态一致。

## 后续记录格式

新增问题时至少写明：网站与任务、调用方式、预期结果、实际结果、对照实验、证据
以及当前判断。尚未稳定复现的问题应明确标记，避免把一次网站波动写成确定缺陷。
