/**
 * Sidebar grouping utilities — pure functions for building the project folder tree.
 *
 * Transforms a flat list of TaskRun into ProjectFolder[] where each folder
 * contains ConversationGroup[] (runs grouped by session_id).
 */

import type { TaskRun } from "$lib/types";

// ── Public types ──

export interface ConversationGroup {
  groupKey: string; // "s:<session_id>" or "r:<run.id>"
  runs: TaskRun[]; // sorted by started_at desc
  title: string;
  latestRun: TaskRun;
  isFavorite: boolean;
  isArchived: boolean;
  totalMessages: number;
}

export interface ProjectFolder {
  cwd: string; // "" = uncategorized
  folderKey: string; // "uncategorized" or "cwd:<path>"
  isUncategorized: boolean;
  conversations: ConversationGroup[];
  conversationCount: number;
  latestActivityAt: string; // last_activity_at ?? started_at (safe)
}

// ── normalizeCwd ──

/** Normalize cwd: unify separators + strip trailing + uppercase drive; empty/"/"/"\" → "" */
export function normalizeCwd(cwd: string | undefined): string {
  let s = (cwd ?? "").trim();
  if (!s || s === "/" || s === "\\") return "";
  // Windows: backslash → forward slash
  s = s.replace(/\\/g, "/");
  // Windows: drive letter uppercase (c:/Repo → C:/Repo)
  s = s.replace(/^([a-z]):/, (_, d: string) => d.toUpperCase() + ":");
  // Bare drive letter "C:" → "C:/"
  if (/^[A-Z]:$/.test(s)) return s + "/";
  // Preserve drive root "C:/"
  if (/^[A-Z]:\/$/.test(s)) return s;
  // Preserve UNC root "//server" (strip trailing slash if "//server/")
  if (/^\/\/[^/]+\/?$/.test(s)) return s.replace(/\/$/, "");
  // Strip trailing slashes
  return s.replace(/\/+$/, "");
}

// ── Sort key helper ──

function sortKey(run: TaskRun): string {
  return run.last_activity_at ?? run.started_at;
}

// ── Conversation grouping (shared by project folders + archived list) ──

/** Group a flat run list into ConversationGroups (by session_id, else standalone),
 *  sorted by latest activity desc. */
function groupRunsIntoConversations(
  runs: TaskRun[],
  favoriteRunIds: Set<string>,
): ConversationGroup[] {
  const sessionMap = new Map<string, TaskRun[]>();
  const standalone: TaskRun[] = [];

  for (const run of runs) {
    if (run.session_id) {
      let group = sessionMap.get(run.session_id);
      if (!group) {
        group = [];
        sessionMap.set(run.session_id, group);
      }
      group.push(run);
    } else {
      standalone.push(run);
    }
  }

  const conversations: ConversationGroup[] = [];

  for (const [sessionId, sessionRuns] of sessionMap) {
    sessionRuns.sort((a, b) => b.started_at.localeCompare(a.started_at));
    const latestRun = sessionRuns[0];
    const earliestRun = sessionRuns[sessionRuns.length - 1];
    const title = latestRun.name?.trim() || earliestRun.prompt?.trim() || "Untitled";
    conversations.push({
      groupKey: `s:${sessionId}`,
      runs: sessionRuns,
      title,
      latestRun,
      isFavorite: sessionRuns.some((r) => favoriteRunIds.has(r.id)),
      isArchived: sessionRuns.every((r) => !!r.archived),
      totalMessages: sessionRuns.reduce((sum, r) => sum + (r.message_count ?? 0), 0),
    });
  }

  for (const run of standalone) {
    conversations.push({
      groupKey: `r:${run.id}`,
      runs: [run],
      title: run.name?.trim() || run.prompt?.trim() || "Untitled",
      latestRun: run,
      isFavorite: favoriteRunIds.has(run.id),
      isArchived: !!run.archived,
      totalMessages: run.message_count ?? 0,
    });
  }

  conversations.sort((a, b) => sortKey(b.latestRun).localeCompare(sortKey(a.latestRun)));
  return conversations;
}

/** Flat list of archived conversations (cwd-agnostic), for the Archived section. (#128) */
export function buildArchivedConversations(
  runs: TaskRun[],
  favoriteRunIds: Set<string>,
): ConversationGroup[] {
  return groupRunsIntoConversations(
    runs.filter((r) => r.archived),
    favoriteRunIds,
  );
}

// ── Main grouping function ──

export function buildProjectFolders(
  runs: TaskRun[],
  favoriteRunIds: Set<string>,
  pinnedCwds: string[],
  removedCwds: string[] = [],
): ProjectFolder[] {
  // 1. Build removed set (empty string excluded — Uncategorized never removed)
  const removedSet = new Set(removedCwds.map(normalizeCwd));
  removedSet.delete("");

  // 2. Clean pinnedCwds — normalize + filter empty + filter removed
  const cleanPinned = pinnedCwds.map(normalizeCwd).filter((c) => c !== "" && !removedSet.has(c));

  // 3. Bucket runs by normalized cwd (archived runs are excluded from the main tree —
  //    they live in the separate Archived section, cf. buildArchivedConversations). (#128)
  const cwdBuckets = new Map<string, TaskRun[]>();
  for (const run of runs) {
    if (run.archived) continue;
    const cwd = normalizeCwd(run.cwd);
    let bucket = cwdBuckets.get(cwd);
    if (!bucket) {
      bucket = [];
      cwdBuckets.set(cwd, bucket);
    }
    bucket.push(run);
  }

  // 4. Remove buckets in removedSet
  for (const cwd of removedSet) {
    cwdBuckets.delete(cwd);
  }

  // 5. Ensure pinned cwds have entries (even if empty)
  for (const cwd of cleanPinned) {
    if (!cwdBuckets.has(cwd)) {
      cwdBuckets.set(cwd, []);
    }
  }

  // 6. Build folders
  const folders: ProjectFolder[] = [];

  for (const [cwd, bucketRuns] of cwdBuckets) {
    const isUncategorized = cwd === "";
    const folderKey = isUncategorized ? "uncategorized" : `cwd:${cwd}`;

    const conversations = groupRunsIntoConversations(bucketRuns, favoriteRunIds);
    const latestActivityAt = conversations.length > 0 ? sortKey(conversations[0].latestRun) : "";

    folders.push({
      cwd,
      folderKey,
      isUncategorized,
      conversations,
      conversationCount: conversations.length,
      latestActivityAt,
    });
  }

  // 7. Sort: normal projects by latestActivityAt desc, Uncategorized always last
  folders.sort((a, b) => {
    if (a.isUncategorized && !b.isUncategorized) return 1;
    if (!a.isUncategorized && b.isUncategorized) return -1;
    return b.latestActivityAt.localeCompare(a.latestActivityAt);
  });

  return folders;
}

// ── Expand helpers ──

/** Auto-expand the folder containing selectedRunId. Returns new Set or null (no change). */
export function autoExpandForRun(
  selectedRunId: string | undefined,
  projectFolders: ProjectFolder[],
  expandedProjects: Set<string>,
): Set<string> | null {
  if (!selectedRunId) return null;

  for (const folder of projectFolders) {
    const found = folder.conversations.some((conv) =>
      conv.runs.some((r) => r.id === selectedRunId),
    );
    if (found) {
      if (expandedProjects.has(folder.folderKey)) return null; // already expanded
      const next = new Set(expandedProjects);
      next.add(folder.folderKey);
      return next;
    }
  }

  return null;
}

/** Expand a folder by its folderKey. Returns new Set or null (skip). */
export function expandForProjectChange(
  folderKey: string,
  expandedProjects: Set<string>,
): Set<string> | null {
  if (!folderKey) return null; // empty = "All Projects" → skip
  if (expandedProjects.has(folderKey)) return null; // already expanded
  const next = new Set(expandedProjects);
  next.add(folderKey);
  return next;
}
