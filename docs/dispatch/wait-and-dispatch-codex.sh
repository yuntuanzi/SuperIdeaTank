#!/usr/bin/env bash
# 等 Codex 额度恢复（官方提示 11:15）后自动派活，避免我反复轮询浪费轮次。
# 判据：codex exec 的输出里不再出现 "usage limit"。
set -u
REPO="C:/Users/bokily/dev/super-eco"
LOG="$REPO/docs/dispatch/codex-annotator.log"
PROBE="$REPO/docs/dispatch/.codex-probe.txt"

for i in $(seq 1 40); do
  timeout 120 codex exec --skip-git-repo-check "回复 READY" < /dev/null > "$PROBE" 2>&1
  if ! grep -q "usage limit" "$PROBE"; then
    echo "[$(date +%H:%M:%S)] Codex 额度已恢复，开始派活" | tee -a "$LOG"
    cd "$REPO" || exit 1
    codex exec --skip-git-repo-check -o "$REPO/docs/dispatch/codex-annotator-report.md" \
"请阅读并严格执行 docs/dispatch/ANNOTATOR-SPEC.md 这份派活单。

工作目录就是当前仓库根目录 C:\\Users\\bokily\\dev\\super-eco（master 分支）。

动手前必须先读这三个文件：
1. docs/dispatch/ANNOTATOR-SPEC.md   —— 任务本体
2. docs/evidence/zhida-raw-2026-09-13.json —— 直答 API 的原始响应，是这次重构的根因证据
3. docs/evidence/annotator-fixtures.json   —— 12 条人工标注锚点，测试要用

关键红线（违反即打回）：
- 只改 app/server/** 和 app/web/src/types.ts。
  app/web/src/styles.css、components/**、App.tsx、lib/**、index.html、vite.config.ts
  正由另一个模块在独立 worktree 改，你碰了必冲突。
- 不许 git commit / git add -A / git stash。改动留工作区。
- 不许新增任何 npm 依赖。
- 不许动 app/server/.env（真实凭证）。
- 不许真的调用直答 API 验证 —— 今日 zhida_openai 额度已 2/2 用尽。
  直答相关代码要做成可注入 HTTP 函数的结构，测试喂假响应。
- 先写测试看到红，再写实现（R7），报告里要贴先红后绿的原文输出。
- 发现 bug 只报告不修。
- 所有新增代码块要有解释「为什么」而不是复述代码的中文注释。

最后在仓库根目录写 ANNOTATOR-REPORT.md，内容按 spec 第 9 节。
我尤其要听你对这份 spec 的反对意见 —— 特别是这套词典规则在中文知乎语料上的真实上限。" \
      < /dev/null >> "$LOG" 2>&1
    echo "[$(date +%H:%M:%S)] Codex 派活结束，退出码 $?" | tee -a "$LOG"
    exit 0
  fi
  sleep 60
done
echo "[$(date +%H:%M:%S)] 等待超过 40 分钟仍未恢复，放弃自动派活" | tee -a "$LOG"
exit 1
