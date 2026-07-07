# TODO — CoVibeCode Backlog

> Team backlog for **CoVibeCode**, forked from [AnyiWang/OpenCovibe](https://github.com/AnyiWang/OpenCovibe).
>
> This file tracks the open issues + open PR from upstream that we want to address in our fork.
> Items are grouped **by platform** first, then ordered **by type/severity** within each platform.
>
> Last synced with upstream: **2026-07-08** (merged upstream `v0.2.5`; our fork carries the OAuth cold-restart fix, the `remember_tool` permission feature, and Windows CLI session discovery [PR #169, open]).

## Tech stack quick reference
- **Frontend:** SvelteKit + Tailwind (`src/`)
- **Backend / desktop shell:** Tauri (Rust, `src-tauri/`)
- **i18n strings:** `messages/`

## Legend
| Tag | Meaning |
|-----|---------|
| 🔴 **CRITICAL BUG** | Breaks core functionality / app unusable |
| 🟠 **BUG** | Defect, app still usable |
| 🟡 **IMPROVEMENT** | UX / polish on existing feature |
| 🟢 **NEW FEATURE** | Net-new capability, self-contained |
| 🔵 **HUGE IMPROVEMENT** | Large, multi-file feature / architectural |
| 🏷️ Size | `S` = hours · `M` = a day or two · `L` = multi-day · `XL` = multi-week |

**Status:** `[ ]` todo · `[~]` in progress · `[x]` done · assign an owner in the `Owner` column.

---

## 🌐 Cross-platform

### 🟠 BUG · `M` · Session restore drops assistant turns (revisit shows only "You" messages)
- **Source:** discovered in-house (screenshot 2026-07-07); **not yet filed upstream** — candidate to report + PR.
- **Symptom:** Live chat renders correctly (request → response → request → response). After switching to another chat and back, the reopened chat shows **only the "You" turns, stacked together — every assistant response is gone.** The per-turn token separators (`… · 6.6k out · …`) confirm the responses ran and are persisted → this is a **render/rehydration bug, not data loss.**
- **Localized to:** `src/lib/stores/session-store.svelte.ts` → `loadRun()` snapshot fast-path (`_tryApplySnapshot`). On a snapshot hit, `loadRun` restores `this.timeline` from the serialized snapshot and **skips event replay** (see comment ~L1700: *"a snapshot-hit loadRun skips event replay, so anything not serialized here is lost on revisit"*).
- **Suspected root cause:** the snapshot's `timeline` is missing assistant entries (serialized before the turn committed them, or dropped on serialize) **while `_seenMessageIds` still lists their IDs** — so any follow-up replay also dedup-skips them → assistant turns permanently absent on revisit.
- **Next step:** reproduce → inspect a persisted snapshot body for a run (does `timeline` contain the assistant entries?) → fix the serialize point or the restore/dedup reconciliation. Needs live testing; do **not** blind-patch rehydration.
- **Owner:** _unassigned_  ·  **Status:** `[ ]` (diagnosed, not fixed)

### 🟠 BUG · `S` · [#173] Cannot add more than one hook
- **Issue:** [#173](https://github.com/AnyiWang/OpenCovibe/issues/173) (opened 2026-06-25, no triage yet)
- **Relevance:** touches our hook plumbing (`src-tauri/src/hooks/`, settings hook editor). Likely a UI/storage bug capping hooks at one entry. Small, self-contained — good PR candidate for upstream.
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

### 🟠 BUG · `S` · [#174] Skills load but `/xxx` reports "no such command" after send
- **Issue:** [#174](https://github.com/AnyiWang/OpenCovibe/issues/174) (opened 2026-07-07, newest)
- **Relevance:** the `isKnownSlashCommand` / session-command path (`session-store.svelte.ts`). Skills are listed but a `/skill` send is rejected — likely a name-matching or `sessionCommands` timing gap. Small.
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

### 🔴 CRITICAL BUG · `M` · [#131] Claude Code v2.1.150 breaks pipe communication
- **Issue:** [#131](https://github.com/AnyiWang/OpenCovibe/issues/131)
- **Symptom:** Sending a chat message fails with `send_chat_message requires execution_path=pipe_exec, got SessionActor`.
- **Root cause:** Claude Code v2.1.150 changed the stdin/stdout pipe protocol; OpenCovibe **v0.1.60** was built against the older protocol.
- **✅ VERIFIED 2026-06-03 — not reproducible on our fork.** Tested installed CLI **v2.1.161** against our `v0.1.64` protocol code end-to-end:
  - `initialize` handshake → `control_response` parses (`control.rs` shape intact).
  - Full `user` turn → streamed `assistant` + `result/success is_error=false` (`session_actor.rs`).
  - New event types (`rate_limit_event` handled explicitly; `system/thinking_tokens` → `Raw` fallback) don't break the stream; no `deny_unknown_fields` so new model/command fields are ignored.
  - Frontend routing: `session_actor` runs always use `sendSessionMessage`; the pipe command is guarded behind `!useStreamSession` (incl. the resume path).
  - The break was specific to **CC v2.1.150 + OCV v0.1.60**; resolved by the CLI advancing past 2.1.150 and our fork absorbing PRs #142–148.
- **Regression guard added:** `scripts/check-cli-protocol.mjs` — run after any CLI auto-update (or in CI) to confirm the protocol still matches. `node scripts/check-cli-protocol.mjs`.
- **If it ever recurs:** the script will fail and name the broken expectation → adapt `src-tauri/src/agent/{control.rs,session_actor.rs,claude_protocol.rs}`.
- **Owner:** _unassigned_  ·  **Status:** `[x]` (verified / guarded)

### 🟠 BUG · `S` · [#149] Context-window usage over-counts per turn + wrong pricing table
- **Issue:** [#149](https://github.com/AnyiWang/OpenCovibe/issues/149)
- **Symptom (two bugs):**
  1. Context usage is summed across every request in a turn instead of using the **final** request → shows ~230k (23%) when it should be ~80k (8%).
  2. Opus 4.8 unit prices are off by ~2.6× → a $0.40 turn is billed as $1.06.
- **✅ FIXED 2026-06-03 (Claude).** Empirically confirmed via a live multi-request turn on CC v2.1.161 that `result.usage` is **cumulative** (cache_creation 6172+115076=121248), so the gauge over-counted.
  - **Pricing** (`src-tauri/src/pricing.rs`): legacy Opus (3.x/4.0/4.1) → $15/$75; **all modern Opus (4.5/4.6/4.7/4.8+)** → $5/$25 (cache_read $0.50, cache_write $6.25 via 5-min formula). Opus 4.8 was falling through to the legacy $15/$75 branch. Future-proof: new Opus releases default to the current rate.
  - **Context** (`claude_protocol.rs` + `models.rs` + frontend): backend now tracks the **last main-chain request's** `input+cache_read+cache_creation` and emits it as a new `UsageUpdate.context_tokens`; the cumulative fields stay for cost/stats. Frontend gauge (`session-store.svelte.ts`) uses `ev.context_tokens ?? <sum>` (fallback for old events). Sub-agent/sidechain requests are excluded. CLI imports set it per-message.
  - **Tests:** `pricing::tests` (3) + `claude_protocol::tests::test_context_tokens_*` (2) — all green. Full backend suite: 430 pass / 9 pre-existing Windows-only failures (clipboard/path tests, unrelated).
  - Note: cache_write kept at $6.25 (5-min, CC default) rather than the issue's suggested $10 (1-hr rate), consistent with how 4.5/4.6 are already priced.
  - **Refinement 2026-06-04 (from upstream PR #151):** cost now **trusts the CLI's own `costUSD` for native Claude/OpenAI models** (the CLI is authoritative for its own pricing — tiers/batch/etc.) and only recalculates **third-party** providers via our table. New `pricing::is_native_pricing_model`. Upstream independently fixed #149 the same way (last-request context + inverted Opus table) → expect a conflict if we ever merge their #151.
  - Related closed issue: upstream #135 (top-bar token/turn counter).
- **Owner:** Claude  ·  **Status:** `[x]` (fixed + tested)

### 🟠 BUG · `S` · [#163] Tool sidebar text overflows when collapsed
- **Issue:** [#163](https://github.com/AnyiWang/OpenCovibe/issues/163) (filed against upstream v0.2.1, macOS — but a CSS bug, so cross-platform).
- **✅ FIXED 2026-06-09 (Claude).** Root cause: `ToolActivity.svelte` keeps tabs mounted and toggles each with `visibility: visible/hidden` (lazy keep-alive). When the panel collapses it sets the wrapper to `visibility: hidden`, but the **active tab re-asserts `visibility: visible`**, and per CSS a descendant's `visibility:visible` overrides an ancestor's `hidden` — so the active tab's text paints inside the 32px collapsed rail.
  - Fix: also set `opacity: 0` on the collapsed wrapper. Opacity on an ancestor **cannot** be overridden by descendants, and (unlike `display:none`) preserves CodeMirror's layout so the panel can stay mounted. One-line style change in `src/lib/components/ToolActivity.svelte`.
  - Verified: prettier + svelte-check (0 errors). ⚠️ Manual: confirm visually by collapsing the tool sidebar with the Files tab open.
- **Owner:** Claude  ·  **Status:** `[x]` (fixed)

### 🟠 BUG · `M` · [local] Parallel tool permissions pile up; "only last Allow works"
- **Reported by user (2026-06-09):** leave a working session, come back to ~11 stacked "Allow" prompts + a red `[ede_diagnostic] … stop_reason=tool_use` "retry or dismiss" card. Clicking Allow seems to only take effect for the last request; the prompts reappear after switching away and back.
- **Investigation (Claude):** Traced the full permission path — it is **per-request correct** end-to-end: `can_use_tool` → `PermissionPrompt(request_id)` → reducer matches by `tool_use_id` → per-card `respondPermission(request_id)` → `write_control_response(request_id)`. CLI-cancel → `ControlCancelled` clears the matching card; idle clears stale prompts. The `[ede_diagnostic]` text is emitted by the **Claude CLI itself**, not OpenCovibe.
- **🩹 PARTIAL FIX 2026-06-09:** `session_actor.pending_interactive_request` was a **single `Option`** clobbered by each concurrent prompt → converted to a `HashMap<request_id, …>` so parallel prompts no longer lose each other's timeout diagnostics (`oldest_pending_interactive` + pending count in timeout/quarantine logs). This corrects diagnostics but does **not** by itself explain "only last works".
- **✅ ROOT-CAUSED & FIXED 2026-06-10 — via `logs.txt` (hypothesis (b) confirmed).** The log showed: `14:18` AskUserQuestion prompt → `14:48` `[turn] user hard timeout: entering quarantine (waited 1801s)` → interrupt → `internal control_cancel_request` cancels the prompt → `permission_denied: AskUserQuestion` → `[ede_diagnostic] … stop_reason=tool_use`. The user's later answer (`waited=3476s`) wrote a `control_response` for an **already-cancelled** request → no-op ("stuck"), and the question was re-asked as a new run. So: the **30-min user-turn hard-timeout was quarantining a turn that was simply waiting on the human.**
  - **Fix (`session_actor.rs` `on_tick_timeout`):** when the user-turn `hard_deadline` fires, only quarantine if `pending_interactive_requests.is_empty()`. While a prompt is pending (AskUserQuestion / can_use_tool / elicitation) the deadline is **deferred** (re-armed to `now + USER_HARD_TIMEOUT`) — a slow human answer is never cancelled. Verified: build, rustfmt, 7 actor tests, clippy clean.
  - Earlier partial fix (single `Option` → `HashMap` for `pending_interactive_requests`) remains and underpins the `is_empty()` guard.
- **📓 `~/.opencovibe/logs.txt`** (env_logger tee in `lib.rs`) is what made this diagnosable — keep it.
- **Owner:** Claude  ·  **Status:** `[x]` (fixed — verify in the wild)

### 🟠 BUG · `S` · [local] Post-update regressions in the conversation list
- **Reported by user (2026-06-09):** after the #132 sidebar polish — the **delete button disappeared**, the **"waiting" status stopped showing**, and the colored status **dot was preferred as text**.
- **✅ FIXED 2026-06-09 (Claude):**
  - Reverted the icon-only `StatusBadge` → text pill is back (running/done/**waiting**/stopped), so "waiting" shows again. Removed the now-unused `iconOnly` prop.
  - **Delete button:** root cause was the #132 truncation change — dropping the hard `truncate(title, 28)` exposed a latent layout bug (the title container had `min-w-0` but no `flex-1`, and the span wasn't width-constrained), so long titles overflowed and pushed the action buttons off-screen. Fix: `flex-1` on the title container so it shrinks/truncates and the actions (incl. delete) stay visible.
  - Verified: svelte-check (0 err), eslint, prettier.
- **Owner:** Claude  ·  **Status:** `[x]`

### 🟡 IMPROVEMENT · `S` · [#115] Session auto-recovery is silent
- **Issue:** [#115](https://github.com/AnyiWang/OpenCovibe/issues/115)
- **Problem:** Auto-recovery already works, but gives no feedback, so users needlessly click "Resume Session" first.
- **Fix direction (pick some/all):** (A) show a transient "Restoring session…" indicator; (B) change input placeholder to "Send message to continue this session" when inactive; (C) hide the manual "Resume Session" context-menu item.
- **✅ DONE 2026-06-09 (Claude).** Implemented A + B:
  - **(B)** `PromptInput.effectivePlaceholder`: when `canResume && !sessionAlive && !running`, the composer shows "Send a message to continue this session…" so users know they can just type (the props were already passed from the chat page).
  - **(A)** chat `+page.svelte` auto-resume path now fires a transient "Restoring session…" toast (`promptRef.showToast`).
  - en + zh-CN strings. **(C) skipped** — left the manual Resume option in place (non-destructive); A+B remove the confusion.
  - Verified: svelte-check (0 err), prettier, i18n (0 err).
- **Owner:** Claude  ·  **Status:** `[x]` (done)

### 🟡 IMPROVEMENT · `M` · [#132] Left session-list UI optimization
- **Issue:** [#132](https://github.com/AnyiWang/OpenCovibe/issues/132)
- **Asks:** distinct styling for project vs. conversation titles; indent conversations; icon status indicators (running/done/stopped) instead of text; inline `+` add button next to project name; fix premature title truncation. (Codex UI as reference.)
- **✅ DONE 2026-06-09 (Claude).**
  - **Icon status:** `StatusBadge` gained an `iconOnly` prop (just the colored dot, with a `title`/`aria-label` tooltip); `ConversationItem` uses it → no more "running/done/stopped" text pills cluttering the list.
  - **Truncation fix:** `ConversationItem` was double-truncating (JS `truncate(title, 28)` + CSS `truncate`); dropped the hard 28-char cap so CSS truncates by actual width (no premature ellipsis).
  - **Inline `+`:** `ProjectFolderItem` header now has a hover-revealed `+` next to the project name (quick new-chat without expanding), for non-uncategorized folders.
  - **Already present:** conversations are indented (`pl-3`); project headers are `font-medium` vs conversation `text-xs` (distinct styling). Left those as-is.
  - Verified: svelte-check (0 err), eslint, prettier. ⚠️ Manual: eyeball the sidebar (status dots, long titles, hover `+`).
- **Owner:** Claude  ·  **Status:** `[x]` (done)

### 🟢 NEW FEATURE · `S–M` · [#123] Sound notification on task completion
- **Issue:** [#123](https://github.com/AnyiWang/OpenCovibe/issues/123)
- **Ask:** Play a sound when a task completes (visual notifications get missed in multi-window/full-screen). Settings toggle + sound choice (system default / custom file / built-in). Frontend Web Audio API.
- **✅ DONE 2026-06-04 (Claude).**
  - New `src/lib/utils/completion-sound.ts`: Web Audio API synthesis (no bundled assets), 3 built-in styles (chime/ping/beep), cached pref for a synchronous hot path.
  - Plays in `session-store._setPhase` when an active turn (running/spawning) → done (idle/completed/failed); skipped during replay/load and for background-task contexts.
  - Settings: `task_completion_sound_enabled` + `task_completion_sound` (`models.rs`/`settings.rs`/`types.ts`). New "Notifications" card in Settings → General: toggle + style picker + preview (en + zh-CN i18n).
  - Verified: rustfmt, eslint, svelte-check (0 err), i18n (0 err), 22 settings + 279 session-store tests pass.
  - Scoped out (future): custom sound-file upload (built-in styles only for now).
  - ⚠️ Manual check: confirm audibility in the running app (audio output can't be unit-tested).
- **Owner:** Claude  ·  **Status:** `[x]` (done)

### 🟢 NEW FEATURE · `S–M` · [#155] Custom Claude CLI startup command/path
- **Issue:** [#155](https://github.com/AnyiWang/OpenCovibe/issues/155) — let users point at a non-standard `claude` install or a wrapper (e.g. `claude-tap`) for request tracing/proxying.
- **✅ DONE 2026-06-10 (Claude).** Added a `claude_path` user setting (custom path/program) honored by `resolve_claude_path()`, so it flows to **every** claude launch (sessions, pipe-exec, version check, plugins, MCP) uniformly.
  - Backend: `UserSettings.claude_path` (`models.rs`); merged in `update_user_settings` which invalidates the resolved-path cache; `resolve_claude_path()` returns the override first; `build_agent_command` (pipe-exec) uses it instead of hardcoded `"claude"`.
  - Frontend: `claude_path` type; new **"Launch"** card in Settings → CLI Config with a path/command input (en + zh-CN).
  - **Scope note:** path/transparent-wrapper only. Prefix-wrappers that need a separator (`claude-tap --`) won't work as a raw command because the same binary is also used for `--version`/`plugin list`/MCP — the UI help directs users to a small forwarding wrapper script (which the issue lists as acceptable). Full session-only prefix support could be a follow-up.
  - Verified: build, svelte-check (0 err), eslint, i18n (0 err), 22 settings tests.
- **Owner:** Claude  ·  **Status:** `[x]` (done)

### 🟢 NEW FEATURE · `M` · [#128] Delete / archive conversations
- **Issue:** [#128](https://github.com/AnyiWang/OpenCovibe/issues/128)
- **Ask:** Let users delete or archive specific sessions (none currently possible). Needs UI action + backend storage handling for session removal/archival.
- **✅ DONE 2026-06-09 (Claude).** Delete already existed (soft-delete via `deleted_at`); this added **Archive**:
  - Backend: `archived_at` on `RunMeta` + `archived` on `TaskRun`; `set_runs_archived` storage fn + tauri command (registered in `lib.rs` + `web_server/dispatch.rs`), mirroring `soft_delete_runs`. Archiving an active run is allowed (stays resumable); reversible.
  - Frontend: `setRunsArchived` API; `buildProjectFolders` excludes archived; new `buildArchivedConversations` + a collapsible **"Archived (N)"** section in the sidebar; Archive/Unarchive hover action in `ConversationItem` (threaded via `ProjectFolderItem`). en + zh-CN i18n.
  - Verified: svelte-check (0 err), sidebar-groups 38 tests (2 new), backend `runs` tests, eslint/prettier/rustfmt/i18n clean.
  - ⚠️ Manual: confirm in-app — hover a conversation → Archive → it moves to the Archived section → Unarchive restores it.
- **Owner:** Claude  ·  **Status:** `[x]` (done)

### 🟢 NEW FEATURE · `M` · [PR #127] Enhanced paste (plain-text shortcut + block actions)
- **PR:** [#127](https://github.com/AnyiWang/OpenCovibe/pull/127) — open upstream, **could be cherry-picked**.
- **Adds:** `Ctrl/Cmd+Shift+V` to paste as plain editable text (bypass auto-compression); hover insert/delete buttons on compressed paste blocks; first-time toast + empty-input hint to teach the shortcut.
- **Action:** Review upstream PR diff; cherry-pick or re-implement on our fork.
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

### 🔵 HUGE IMPROVEMENT · `L` · [#117] Full SSH-remote Claude Code support
- **Issue:** [#117](https://github.com/AnyiWang/OpenCovibe/issues/117)
- **Today:** SSH only tests the connection.
- **Ask:** Read remote Claude Code conversations and create/manage new conversations over SSH.
- **🚫 OUT OF SCOPE for this fork (team decision 2026-06-10).** Not needed.
- **Owner:** —  ·  **Status:** `[✗]` (won't do)

### 🔵 HUGE IMPROVEMENT · `XL` · [#134] Web-server mode for mobile remote control
- **Issue:** [#134](https://github.com/AnyiWang/OpenCovibe/issues/134)
- **Ask:** Optional local web server (configurable port) serving the UI; responsive/touch mobile layout; password auth + stable links for LAN/intranet access.
- **🚫 OUT OF SCOPE for this fork (team decision 2026-06-10).** Not needed.
- **Owner:** —  ·  **Status:** `[✗]` (won't do)

---

## 🪟 Windows

### 🔴 CRITICAL BUG · `M–L` · [#103] Opening a session → blank screen, then hang & exit
- **Issue:** [#103](https://github.com/AnyiWang/OpenCovibe/issues/103)
- **Symptom:** On Windows, opening a particular session shows a blank screen, freezes, then the app auto-exits. Persists after updating.
- **Note:** Upstream issue lacks logs/repro. **We run on Windows 10 — we are the best-placed to diagnose this.**
- **Investigation 2026-06-03 (Claude):** Ruled out the two obvious data-dependent culprits:
  - Backend event read (`storage/events.rs`) uses `filter_map(serde_json::from_str(...).ok())` — malformed JSONL lines are **skipped, not panicked**. A corrupt session log won't crash the process.
  - Frontend load (`loadRun` → `applyEventBatchAsync`) **yields between chunks**, so a large session won't block the main thread indefinitely.
  - Remaining most-likely cause: **WebView2 rendering crash** on a single huge payload (e.g. a massive tool output / code block) in one specific session → "blank → hang → auto-exit" matches a renderer OOM/crash on Windows. Unconfirmed without repro.
- **🩹 LIKELY-FIXED 2026-06-04 (Claude) — re-implemented upstream PR #152.** Strong newly-found candidate cause: a **stuck drag-hover overlay**. Native `tauri://drag-leave`/`drag-drop` events can be dropped on Windows, leaving `pageDragActive` stuck `true`; its full-screen `z-50` overlay (`chat/+page.svelte`) then swallows every click → "blank, frozen" exactly as reported.
  - Fix: defensive `pointerdown` + `Escape` (capture-phase) window handlers clear the stuck overlay without touching `dragProcessing` (real in-flight work). `chat/+page.svelte`.
  - ⚠️ Unconfirmed against the original reporter's session (still no repro), but this is the most plausible mechanism and the fix is low-risk. If "blank/hang" recurs after this, fall back to the WebView2-crash hypothesis and capture: `winver`, app version, WebView2 runtime version, logs, and the triggering `events.jsonl`.
- **Owner:** Claude  ·  **Status:** `[~]` (mitigation applied; verify in the wild)

---

## 🍎 macOS

> Lower priority for us (team is on Windows) — tracked for completeness / contributors with Macs.

### 🟠 BUG · `?` · [#119] Mac client freezes when switching conversations
- **Issue:** [#119](https://github.com/AnyiWang/OpenCovibe/issues/119)
- **Symptom:** App suddenly becomes unresponsive while switching conversations; requires force-quit. No logs/repro upstream.
- **🚫 OUT OF SCOPE for this fork (team decision 2026-06-10) — Windows team, macOS not targeted.**
- **Owner:** —  ·  **Status:** `[✗]` (won't do)

### 🟠 BUG · `M` · [#120] Repeated "Downloads" folder permission prompts (macOS Sequoia)
- **Issue:** [#120](https://github.com/AnyiWang/OpenCovibe/issues/120)
- **Symptom:** Sequoia repeatedly re-asks for Downloads access even after granting full disk access.
- **Root cause:** Ad-hoc code signing without a stable Team ID → macOS can't persist `SystemPolicyDownloadsFolder`. Real fix needs proper code signing.
- **🚫 OUT OF SCOPE for this fork (team decision 2026-06-10) — macOS not targeted.**
- **Owner:** —  ·  **Status:** `[✗]` (won't do)

---

## Suggested order of attack (our fork, Windows team)
1. **#131** — pipe protocol (blocks everyone using newer Claude Code). 🔴
2. **#103** — Windows blank/hang (directly affects us). 🔴
3. **#149** — token/billing accuracy (small, high trust impact). 🟠
4. **#115 / #123 / #128 / PR #127** — quick UX/feature wins for the team. 🟡🟢
5. **#132** — session list UI polish. 🟡
6. **#117 / #134** — big features, schedule deliberately. 🔵

---
*Generated from upstream open issues + PR #127 as of 2026-06-03. Re-sync periodically: `gh issue list -R AnyiWang/OpenCovibe --state open`.*
