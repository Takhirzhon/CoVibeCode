import type { PromptInputSnapshot } from "$lib/types";

/**
 * Per-conversation unsent draft storage.
 *
 * The chat PromptInput is unmounted/remounted when switching conversations
 * (the surrounding `{#if}` in the chat page toggles with run state), which
 * would otherwise discard whatever the user had typed but not yet sent.
 *
 * This module keeps drafts in a plain module-level Map keyed by runId. Module
 * state survives client-side navigation (`goto`) and component remounts within
 * the running app, so a half-written message is restored when the user returns
 * to that conversation. Drafts are intentionally in-memory only — they hold
 * potentially large attachment payloads and are transient by nature.
 *
 * The empty-run key ("") holds the draft for a not-yet-started conversation.
 */

const drafts = new Map<string, PromptInputSnapshot>();

function isEmptySnapshot(snapshot: PromptInputSnapshot): boolean {
  return !(
    snapshot.text.trim() ||
    snapshot.attachments.length ||
    snapshot.pastedBlocks.length ||
    (snapshot.pathRefs?.length ?? 0)
  );
}

export function getDraft(runId: string): PromptInputSnapshot | null {
  return drafts.get(runId) ?? null;
}

/** Store a draft for a run, or drop it when there's nothing worth keeping. */
export function setDraft(runId: string, snapshot: PromptInputSnapshot): void {
  if (isEmptySnapshot(snapshot)) {
    drafts.delete(runId);
  } else {
    drafts.set(runId, snapshot);
  }
}

export function clearDraft(runId: string): void {
  drafts.delete(runId);
}
