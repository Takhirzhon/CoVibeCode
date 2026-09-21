//! Workspace trust for Claude Code (`projects[<cwd>].hasTrustDialogAccepted` in `~/.claude.json`).
//!
//! Newer CLIs ignore a project's `permissions.allow` rules (`.claude/settings.local.json`,
//! `.claude/settings.json`) until the folder has been trusted, and print:
//!
//! > Ignoring N permissions.allow entries from .claude/settings.local.json: this workspace
//! > has not been trusted. Run Claude Code interactively here once and accept the trust
//! > dialog, or set projects["<cwd>"].hasTrustDialogAccepted: true in ~/.claude.json.
//!
//! CoVibeCode always spawns the CLI non-interactively (`-p --input-format stream-json`), so
//! the dialog can never be shown and every "always allow" the user saved is silently
//! dropped — the tool keeps asking. The user picked the folder in the app deliberately, and
//! the gate only matters once the folder has settings files, so we accept trust on their
//! behalf right before spawning (see [`ensure_project_trusted`]).

use crate::storage::cli_sessions_common::normalize_cwd;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

/// Claude Code's state file: `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`.
fn claude_state_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir).join(".claude.json"));
        }
    }
    crate::storage::home_dir().map(|h| PathBuf::from(h).join(".claude.json"))
}

/// True when the folder carries project-level Claude settings that the trust gate would
/// suppress. Folders without them don't need trust, so we leave `~/.claude.json` alone.
pub fn has_project_settings(cwd: &str) -> bool {
    let dot_claude = Path::new(cwd).join(".claude");
    dot_claude.join("settings.local.json").is_file() || dot_claude.join("settings.json").is_file()
}

/// Mark `cwd` as trusted for Claude Code. Returns `Ok(true)` when the file was changed,
/// `Ok(false)` when the folder was already trusted. Never touches other keys.
pub fn ensure_project_trusted(cwd: &str) -> Result<bool, String> {
    let path = claude_state_path().ok_or("cannot determine home dir")?;
    ensure_trusted_in(&path, cwd)
}

fn ensure_trusted_in(path: &Path, cwd: &str) -> Result<bool, String> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err("empty cwd".into());
    }

    // Missing file → start from `{}`; a CORRUPT file is an error (never clobber the CLI's
    // state with a guess).
    let mut root: Value = match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| format!("{} is not valid JSON: {}", path.display(), e))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Value::Object(Map::new()),
        Err(e) => return Err(format!("cannot read {}: {}", path.display(), e)),
    };
    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| format!("{} top level is not an object", path.display()))?;
    let projects = root_obj
        .entry("projects")
        .or_insert_with(|| Value::Object(Map::new()));
    let projects = projects
        .as_object_mut()
        .ok_or_else(|| format!("{}: \"projects\" is not an object", path.display()))?;

    // The CLI keys `projects` by its process cwd verbatim, so the same folder can appear
    // as `C:/x/y`, `C:\x\y` or `c:/x/y`. Flip every spelling that already exists, and make
    // sure the spelling we pass to the CLI is present.
    let target = normalize_cwd(cwd);
    let mut changed = false;
    let mut exact_seen = false;
    for (key, entry) in projects.iter_mut() {
        if normalize_cwd(key) != target {
            continue;
        }
        if key == cwd {
            exact_seen = true;
        }
        if let Some(obj) = entry.as_object_mut() {
            if obj.get("hasTrustDialogAccepted") != Some(&Value::Bool(true)) {
                obj.insert("hasTrustDialogAccepted".into(), Value::Bool(true));
                changed = true;
            }
        }
    }
    if !exact_seen {
        let mut obj = Map::new();
        obj.insert("hasTrustDialogAccepted".into(), Value::Bool(true));
        projects.insert(cwd.to_string(), Value::Object(obj));
        changed = true;
    }
    if !changed {
        return Ok(false);
    }

    // Atomic replace: the CLI rewrites this file itself, so never leave it half-written.
    let content = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("json.covibe-{}.tmp", std::process::id()));
    std::fs::write(&tmp, content).map_err(|e| format!("cannot write {}: {}", tmp.display(), e))?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("cannot replace {}: {}", path.display(), e));
    }
    log::info!(
        "[project_trust] marked {} as trusted in {} (hasTrustDialogAccepted=true)",
        cwd,
        path.display()
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_state(name: &str, content: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("covibe-trust-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(".claude.json");
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn creates_entry_when_missing() {
        let p = tmp_state("missing", r#"{"numStartups": 3, "projects": {}}"#);
        assert!(ensure_trusted_in(&p, "C:/Users/u/proj").unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["numStartups"], 3, "other keys preserved");
        assert_eq!(
            v["projects"]["C:/Users/u/proj"]["hasTrustDialogAccepted"],
            true
        );
        std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }

    #[test]
    fn flips_existing_entry_and_its_other_spellings() {
        let p = tmp_state(
            "spellings",
            r#"{"projects": {
                "C:/Users/u/proj": {"hasTrustDialogAccepted": false, "allowedTools": ["x"]},
                "C:\\Users\\u\\proj": {"hasTrustDialogAccepted": false},
                "C:/Users/u/other": {"hasTrustDialogAccepted": false}
            }}"#,
        );
        assert!(ensure_trusted_in(&p, "C:/Users/u/proj").unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(
            v["projects"]["C:/Users/u/proj"]["hasTrustDialogAccepted"],
            true
        );
        assert_eq!(v["projects"]["C:/Users/u/proj"]["allowedTools"][0], "x");
        assert_eq!(
            v["projects"]["C:\\Users\\u\\proj"]["hasTrustDialogAccepted"],
            true
        );
        assert_eq!(
            v["projects"]["C:/Users/u/other"]["hasTrustDialogAccepted"],
            false
        );
        std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }

    #[test]
    fn noop_when_already_trusted() {
        let p = tmp_state(
            "noop",
            r#"{"projects": {"C:/Users/u/proj": {"hasTrustDialogAccepted": true}}}"#,
        );
        let before = std::fs::read_to_string(&p).unwrap();
        assert!(!ensure_trusted_in(&p, "C:/Users/u/proj").unwrap());
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            before,
            "file untouched"
        );
        std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }

    #[test]
    fn refuses_corrupt_file() {
        let p = tmp_state("corrupt", "{not json");
        assert!(ensure_trusted_in(&p, "C:/Users/u/proj").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{not json");
        std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }
}
