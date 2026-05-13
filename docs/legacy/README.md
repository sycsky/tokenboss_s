# `docs/legacy/` — 历史归档（只读）

这里放 **pre-2026-05-13** 的 spec / plan / design 文档，是切换到 `openspec/` 工作流之前的产物。

| 子目录 | 来源 | 现状 |
|---|---|---|
| `superpowers/design/` | 早期 design system（一份） | 仅作历史参考；frontend 当前视觉规范以 `frontend/tailwind.config.js` + 实际代码为准 |
| `superpowers/plans/` | 早期实施计划（5 份，2026-04 - 2026-05 早期） | 已实施 / 已废弃；不再继续维护 |
| `superpowers/specs/` | 早期 spec（8 份，2026-04 - 2026-05 早期） | 同上；新 spec 写到 `openspec/changes/gh-NN-<slug>/specs/` 或 `openspec/specs/<cap>/` |

## 为什么搬到这里

2026-05-13 之后采用 `WORKFLOW.md` 定义的 9-stage 工作流，spec 流向：

```
GitHub Issue #N
    ↓
openspec/changes/gh-NN-<slug>/   ← per-change 草稿 + deliverable
    ↓
openspec/changes/archive/YYYY-MM-DD-gh-NN-<slug>/   ← ship 后归档
    ↓
openspec/specs/<capability>/spec.md   ← 跨 change 长期累积的产品文档
```

历史目录不强制迁移，但**不再产出新内容**。需要查 v1.0 历史 spec 时翻这里；写新 spec 走 `openspec/`。

## 不要做的事

- 不要在这里写新 spec
- 不要把 `openspec/` 里的东西移过来（信息源单一原则）
- 不要删除 — 历史 commit 引用这些文件
