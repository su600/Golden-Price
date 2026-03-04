# Agent Implementation Skills

## Skill: Auto Request Review
**Description:** 当你完成代码修改并推送到远程 PR 分支后，必须执行的操作。

**Execution Protocol:**
1. **Context:** 无论 PR 是否处于 Draft 状态。
2. **Action:** 你必须调用 GitHub CLI 工具执行以下指令把su600添加的reviewer里：
   ```bash
   gh pr edit --add-reviewer "su600"
