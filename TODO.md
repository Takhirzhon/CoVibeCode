# TODO — CoVibeCode Backlog

> Team backlog for **CoVibeCode**, forked from [AnyiWang/OpenCovibe](https://github.com/AnyiWang/OpenCovibe).
>
> This file tracks the open issues + open PR from upstream that we want to address in our fork.
> Items are grouped **by platform** first, then ordered **by type/severity** within each platform.
>
> Last synced with upstream: **2026-06-03** (our fork is at `v0.1.64`, even with upstream's latest merged PRs #146/#147/#148).

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

### 🟡 IMPROVEMENT · `S` · [#115] Session auto-recovery is silent
- **Issue:** [#115](https://github.com/AnyiWang/OpenCovibe/issues/115)
- **Problem:** Auto-recovery already works, but gives no feedback, so users needlessly click "Resume Session" first.
- **Fix direction (pick some/all):** (A) show a transient "Restoring session…" indicator; (B) change input placeholder to "Send message to continue this session" when inactive; (C) hide the manual "Resume Session" context-menu item.
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

### 🟡 IMPROVEMENT · `M` · [#132] Left session-list UI optimization
- **Issue:** [#132](https://github.com/AnyiWang/OpenCovibe/issues/132)
- **Asks:** distinct styling for project vs. conversation titles; indent conversations; icon status indicators (running/done/stopped) instead of text; inline `+` add button next to project name; fix premature title truncation. (Codex UI as reference.)
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

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
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

### 🔵 HUGE IMPROVEMENT · `XL` · [#134] Web-server mode for mobile remote control
- **Issue:** [#134](https://github.com/AnyiWang/OpenCovibe/issues/134)
- **Ask:** Optional local web server (configurable port) serving the UI; responsive/touch mobile layout; password auth + stable links for LAN/intranet access.
- **Use cases:** monitor long sessions & cost from phone, approve permission prompts, send messages remotely.
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

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
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

### 🟠 BUG · `M` · [#120] Repeated "Downloads" folder permission prompts (macOS Sequoia)
- **Issue:** [#120](https://github.com/AnyiWang/OpenCovibe/issues/120)
- **Symptom:** Sequoia repeatedly re-asks for Downloads access even after granting full disk access.
- **Root cause:** Ad-hoc code signing without a stable Team ID → macOS can't persist `SystemPolicyDownloadsFolder`. Real fix needs proper code signing.
- **Owner:** _unassigned_  ·  **Status:** `[ ]`

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
