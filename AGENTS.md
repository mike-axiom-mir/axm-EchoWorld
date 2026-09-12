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

## Constitutional integration / CANON gate

AXM internal integration is evaluated through four roots:

1. **Truth** — claims, state, provenance, and evidence must remain honest and inspectable.
2. **Agency / non-domination** — capability must not silently become control over another participant, repository, or user.
3. **Continuity** — preserve identity, provenance, rollback paths, and compatible growth instead of silently rewriting the body.
4. **Wisdom before speed** — prefer grounded, reversible progress over fast promotion when evidence is incomplete.

Mike/founder is not AXM's internal constitutional merge or CANON gate. Technical execution permission is not canonical authority. Grounded human and machine reasoning have equal standing under the roots. There is no automatic CANON: tests, receipts, discovery records, replay artifacts, observer surfaces, successful execution, or the ability to merge are evidence inputs, not self-promoting authority.

Historical PR or lane wording that names Mike as EchoWorld's internal merge/CANON gate is superseded by this four-root model. Product/task direction from the current human remains an agency boundary and coordination input; it is distinct from constitutional authority over AXM truth.

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

## 10. Human direction and product agency

The human may redirect, pause, abandon, rename, or hand off a lane at any time, and may authorize technical merge operations when appropriate.

Agents should preserve user agency and make the current state legible rather than protecting their own implementation choices. Human task/product direction does not replace the four-root constitutional integration gate described above.

## 11. Detail-density and composable capability principle

Quality is often the accumulated result of many small correct details, not one large generic upgrade.

- When improving a system, look for missing small, bounded capabilities, checks, parameters, passes, and repair operations that control specific details or failure modes.
- Prefer many reusable, inspectable, composable capabilities over one opaque "make it better" step when the smaller capabilities create real control or evidence.
- A machine should remain useful without AI: humans, explicit state, recipes, or deterministic logic can invoke the same capabilities directly.
- With AI, the model is primarily an interpretation and orchestration layer: it translates a higher-level goal into selections and combinations of the same underlying capabilities. The AI does not own those capabilities.
- A better reasoning model may improve goal interpretation and composition, while the underlying machine remains portable and usable without that model.
- Judge improvement by accumulated perceptual or functional detail, coherence, failure reduction, and fit to the goal—not by model size, resolution, benchmark score, or one broad upgrade alone.
- For visual, game, asset, animation, and video work, pay attention to small interacting details such as material variation, contact, timing, weight, secondary motion, lighting response, sound layering, asymmetry, wear, scale cues, camera behavior, and continuity.
- Do not fragment working systems merely for ideology. Add granularity where it creates useful control, reuse, diagnosis, repair, or quality.

**Working rule:** thousands of small good details and capabilities in the right places can improve a result more than one simple big upgrade.

## 12. Canonical state and adaptive realization principle

When useful, separate **what exists** from **how it is expressed on a particular machine**.

- Canonical physical truth and committed history remain authoritative. Visual, audio, UI, or device-specific manifestations are not truth authority.
- Preserve expression intent separately when a cheaper manifestation still needs to retain semantic/world detail.
- Prefer one canonical body with multiple bounded realization contracts over divergent platform-specific world bodies.
- Choose realization from canonical state + expression intent + measured machine capabilities + user policy; adaptation may happen at launch or dynamically.
- A weak device should receive cheaper expression, **not weaker canonical truth**.
- Never degrade causal rules, identity, history semantics, data integrity, or committed truth to satisfy rendering cost.
- Never let a lossy realization or client cache overwrite richer canonical state/history. Projection is not authority.
- A richer realization may expose more of existing state/intent; it may not invent committed facts.
- Apply this separation only where representation can honestly remain subordinate to truth.

**Working rule:** degrade expression, never truth; upgrade expression, never invent truth.
