# ego-browser v1 脚本兼容说明

ego-browser 2.x 会为 Agent 提供新的 `TaskSpace` / `Page` API，但不会因此让
线上已有的 1.2.3 自动脚本失效。

## 两套接口

- **新版 Agent API**：进入 API schema、`help()` 和 SKILL，供新任务使用。
- **旧脚本接口**：继续注入脚本作用域，供已有自动脚本使用，但不出现在新版
  默认 `help()` 清单和 SKILL 中。

因此，“旧接口不可见”只针对 Agent 文档和发现机制，不表示运行时删除。

## 兼容承诺

1. 1.2.3 已有 helper 保持原来的参数、错误语义和副作用。
2. 旧接口继续使用原单位约定，包括以秒为单位的 `wait` 和旧 timeout。
3. 兼容 helper 不改变已有浏览器操作；新功能通过返回的 `TaskSpace` / `Page`
   使用。
4. 不对旧脚本逐次打印弃用警告，避免污染机器读取的输出。
5. 2.x 不单独移除兼容层。将来若要删除，必须通过新的大版本、迁移说明和提
   前通知。
6. 显式 `help('legacyName')` 继续返回旧说明，但默认帮助不会推荐这些名字。

`claimTaskSpace(id)` 的原有描述字段保持不变，同时返回值增加 TaskSpace 方法；
`takeOverTaskSpace(id)` 成功后也会返回 TaskSpace。已有脚本忽略返回值或读取原
字段时行为不变，新脚本可以直接继续调用对象接口。

兼容范围以 1.2.3 的 `helperContext()` 全局表面为准，包括原 task space、导
航、观察、鼠标键盘、文件、等待、请求、CDP、site skills 和输出 helper。
实现时用冻结清单和回归测试锁定准确名称，不靠新版 SKILL 维护这份清单。

## 实现边界

脚本执行上下文由两部分合并：

```text
agentApiContext + legacyApiContext
```

新版默认帮助清单只读取 `agentApiContext`；另保留一份冻结的旧版帮助清单，
处理显式名称查询。旧 helper 可以复用新版底层 driver，但外部行为不能随内
部重构改变。新脚本不要在同一轮混用新旧 API；两套接口依赖的页面身份和时
间单位不同，混用不属于兼容承诺。

## 验证

- 保存一组来自 1.2.3 的真实 heredoc，升级后原样执行。
- 覆盖 task space、导航、snapshot、输入、请求、handoff 和输出。
- 验证旧 helper 与显式 help 查询仍可调用，同时新版默认 `help()` 与 SKILL
  不展示它们。
- 任何兼容行为变化都必须作为显式 API 变更评审，不能由底层重构顺带发生。
