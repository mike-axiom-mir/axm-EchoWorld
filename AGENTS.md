# AXM EchoWorld — Agent / Chat Work Rules

This repository uses **one work lane per chat/session** to prevent agents from spreading changes across unrelated branches, files, or parallel workstreams.

## 1. One chat = one lane

Every chat/session that performs repository work MUST claim exactly one lane before implementation work begins.

A lane is represented by one dedicated branch.

Recommended branch shape:

`<agent-or-model>/echoworld-lane-<nn>`

Examples:

- `chatgpt/echoworld-lane-01`
- `codex/echoworld-lane-02`
- `claude/echoworld-lane-03`

### Hard rule

A chat MUST NOT:

- create a second implementation branch for itself;
- scatter related work across multiple PRs or lanes;
- silently continue another chat's unfinished lane;
- modify another active lane to make its own work easier;
- open side branches for experiments that belong to its current task.

If the task grows, keep it inside the same lane unless the human explicitly creates or authorizes a handoff to a new chat/lane.

If work genuinely needs to split, STOP the split at the boundary and leave a clear handoff instead of creating extra lanes.

## 2. Lane ownership is coordination, not authority

Owning a lane means responsibility for that lane's work only. It does not grant authority over:

- `main`;
- other lanes;
- canonical architecture;
- source history;
- evidence produced elsewhere.

Do not rewrite or absorb another lane without explicit human direction.

## 3. Preserve active direction

Do not rebuild EchoWorld from scratch because a different design seems cleaner.

Prefer:

1. inspect current source;
2. identify the smallest real gap;
3. change only what is required;
4. test it;
5. record evidence;
6. leave the lane coherent for review or handoff.

No silent architectural replacement.

## 4. Source honesty

Keep these categories separate:

- **OBSERVED** — demonstrated by code, tests, receipts, measurements, or cited prior art;
- **INTERPRETATION** — a reasonable reading of evidence;
- **PROPOSAL** — something EchoWorld intends to build or test;
- **NOT PROVEN** — a claim that must not be promoted without evidence.

Never report planned behavior as implemented behavior.
Never report a passing test that was not run.
Never report a file, commit, branch, PR, benchmark, or receipt that does not exist.

## 5. EchoWorld v0.01 architecture guardrails

For the first prototype:

- canonical physical truth is deterministic;
- memory is NOT truth authority;
- specialists are NOT truth authority;
- worker finish order must not change canonical truth;
- failed truth transitions must create no false memory;
- truth commits before memory updates;
- persistent identity does not imply an always-running process;
- handoffs are bounded events, not unlimited neighbor-write authority;
- memory and specialist spawning must remain bounded;
- AI is outside EchoWorld v0.01.

Enabling memory must not silently alter canonical deterministic physics.

## 6. Deterministic truth before experiential layers

The required ordering is conceptually:

`event -> affected cells wake -> bounded relevant work -> deterministic merge -> canonical commit -> memory update -> bounded handoff -> sleep`

Experiential layers may remember, interpret, compress, or disagree subjectively. They may not overwrite canonical physical truth.

## 7. Temporary specialists

Specialists are bounded work contracts, not permanent agents by default.

A specialist must have explicit inputs, scope, budget, output shape, and a receipt or equivalent observable result.

Do not turn EchoWorld into a swarm of permanently running agents.

## 8. Tests and receipts

Prefer reproducible evidence over narrative confidence.

When changing canonical behavior, include or update tests that prove the relevant invariant.

Important proof target for v0.01:

**The same causal input stream must produce the same canonical physical end state with EchoWorld memory disabled or enabled.**

## 9. Merge discipline

A lane should reach one coherent review point.

Before proposing merge:

- state what changed;
- state what did not change;
- list tests actually run;
- preserve failures and contradictions;
- identify remaining gaps;
- avoid unrelated cleanup.

No automatic canon. No silent merge.

## 10. Human direction wins

The human may redirect, merge, pause, abandon, rename, or hand off a lane at any time.

Agents should preserve user agency and make the current state legible rather than protecting their own implementation choices.
