#!/usr/bin/env bash
# ──────────────────────────────────────────────────────
# Autoresearch Loop Runner
# Launches Claude Code with MiniMax M2.7 (haiku slot)
# to autonomously improve imperium-crawl overnight.
#
# Usage:
#   ./autoresearch/run-loop.sh              # default: 50 iterations
#   ./autoresearch/run-loop.sh 100          # 100 iterations
#   ./autoresearch/run-loop.sh unlimited    # run forever
# ──────────────────────────────────────────────────────

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

MAX_ITERATIONS="${1:-50}"
ITERATION=0
MODEL="${AUTORESEARCH_MODEL:-haiku}"
LOG_DIR="$ROOT/autoresearch/reports"
LOG_FILE="$LOG_DIR/loop-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$LOG_DIR"

echo "═══════════════════════════════════════════" | tee "$LOG_FILE"
echo " Autoresearch Loop" | tee -a "$LOG_FILE"
echo " Model: $MODEL" | tee -a "$LOG_FILE"
echo " Max iterations: $MAX_ITERATIONS" | tee -a "$LOG_FILE"
echo " Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════" | tee -a "$LOG_FILE"

# Ensure LiteLLM proxy is active
if curl -s http://localhost:4000/health &>/dev/null; then
  export ANTHROPIC_BASE_URL="http://localhost:4000"
  echo "[setup] LiteLLM proxy active at localhost:4000" | tee -a "$LOG_FILE"
else
  echo "[setup] LiteLLM proxy not running — using direct Anthropic" | tee -a "$LOG_FILE"
fi

# Read current baseline score
BASELINE_SCORE="unknown"
if [ -f "$ROOT/autoresearch/results.tsv" ]; then
  BASELINE_SCORE=$(tail -1 "$ROOT/autoresearch/results.tsv" | cut -f3)
fi
echo "[setup] Baseline score: $BASELINE_SCORE" | tee -a "$LOG_FILE"

# Main loop
while true; do
  ITERATION=$((ITERATION + 1))

  if [ "$MAX_ITERATIONS" != "unlimited" ] && [ "$ITERATION" -gt "$MAX_ITERATIONS" ]; then
    echo "[done] Reached $MAX_ITERATIONS iterations. Stopping." | tee -a "$LOG_FILE"
    break
  fi

  echo "" | tee -a "$LOG_FILE"
  echo "─── Iteration $ITERATION ───────────────────────" | tee -a "$LOG_FILE"
  echo "[$(date +%H:%M:%S)] Starting iteration $ITERATION" | tee -a "$LOG_FILE"

  # Run Claude Code non-interactively with program.md context
  PROMPT="$(cat <<'PROMPT_EOF'
You are running an autoresearch iteration for imperium-crawl.

Read autoresearch/program.md for full instructions. Then:

1. Run `npx tsx autoresearch/eval.ts --verbose` to see current scores
2. Identify the LOWEST scoring component
3. Make ONE small, targeted improvement to the source code (src/** or SKILL/**)
4. Run eval again to measure impact
5. If score improved: `git add` the changed files and commit with message format: `autoresearch: <description> (score: X.XXXXXX)`
6. If score decreased or unchanged: `git checkout -- .` to discard changes

Rules:
- NEVER modify files in autoresearch/ (they are SACRED)
- NEVER delete existing tests
- ONE change per iteration — keep it small and focused
- Always verify build passes before committing

After completing, output the final score on the last line.
PROMPT_EOF
)"

  # Run with timeout (10 min per iteration) and capture output
  timeout 600 claude -p --model "$MODEL" "$PROMPT" >> "$LOG_FILE" 2>&1 || {
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
      echo "[timeout] Iteration $ITERATION timed out after 600s" | tee -a "$LOG_FILE"
    else
      echo "[error] Iteration $ITERATION failed with exit code $EXIT_CODE" | tee -a "$LOG_FILE"
    fi
  }

  # Extract latest score from results.tsv
  if [ -f "$ROOT/autoresearch/results.tsv" ]; then
    LATEST_SCORE=$(tail -1 "$ROOT/autoresearch/results.tsv" | cut -f3)
    LATEST_STATUS=$(tail -1 "$ROOT/autoresearch/results.tsv" | cut -f11)
    echo "[result] Score: $LATEST_SCORE | Status: $LATEST_STATUS" | tee -a "$LOG_FILE"
  fi

  # Cooldown between iterations (avoid rate limits)
  echo "[cooldown] Sleeping 10s..." | tee -a "$LOG_FILE"
  sleep 10
done

echo "" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════" | tee -a "$LOG_FILE"
echo " Autoresearch complete" | tee -a "$LOG_FILE"
echo " Iterations: $ITERATION" | tee -a "$LOG_FILE"
echo " Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════" | tee -a "$LOG_FILE"
