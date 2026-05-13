# Tasks · gh-3-tokenboss-cc-switch-integration

> **状态：Stage 2 待填**
>
> 这个文件由 Stage 2 `superpowers:writing-plans` skill 填充到**文件级 / 代码级颗粒度**。Stage 1 brainstorming 已经在 [[proposal.md]] §"估算" 给出 **11 个 high-level task 切片** 作为起点：
>
> 1. `anthropicConvert.ts` lib + 8 组 fixture（含 streaming）— backend ~4-5 天
> 2. `ccSwitchUrl.ts` lib + 5 app × fixture — backend ~1 天
> 3. `deepLinkHandler.ts` + reserved key 选择策略 + 单元测试 — backend ~1.5 天
> 4. `messagesProxy.ts` endpoint + 集成测试（含 streaming round-trip）— backend ~2-3 天
> 5. Frontend lib: `api.getDeepLink()`, `agentDefs.ts` — frontend ~0.5 天
> 6. 7 个新组件（`PrimaryImportButton` / `ImportScopeNote` / `KeyInjectionFlow` / `LoggedInKeyPicker` / `AnonKeyPasteInput` / `CCSwitchDetector` / `ProtocolFamilyLinks` / `AdvancedManualRecipes`）— frontend ~3 天
> 7. `ManualConfigPC.tsx` 整屏重写 — frontend ~1.5 天
> 8. 3 个 `/docs/protocols/*` 子路由屏（重写自 `docs/AI配置指令-TokenBoss厂商.md`）— frontend ~2-2.5 天
> 9. 全仓 URL 修正 + `docs/AI配置指令-TokenBoss厂商.md` 归档到 `docs/legacy/` — docs ~0.5 天
> 10. E2E playwright 测试（PrimaryImportButton happy path + 登录态/未登录态分流） — frontend ~1 天
> 11. Stage 3.5 Vertical Slice 实操 + 录屏 — full ~0.5 天
>
> **Stage 2 writing-plans 应做的**：
>
> - 把每个 high-level task 拆成具体的 file-level / line-level steps
> - 每步明确 Create / Modify / Test 三类动作
> - 标注依赖关系（哪些 task block 哪些）
> - 加入 Plan 路径假设验证 gate（writing-plans skill 内置流程，写完后 5 分钟跑一遍验证）
> - 明确 worktree 策略（按 §1 设计是 frontend + backend 两个 worktree 并行 + 1 个 docs 任务）
> - 标注 Stage 3.5 Vertical Slice 候选（建议 task 4 messagesProxy + task 6 PrimaryImportButton 串起来跑 happy path）
