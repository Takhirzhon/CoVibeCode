#!/usr/bin/env node
/**
 * CLI protocol smoke-test — guards against issue #131 recurring.
 *
 * Claude Code auto-updates itself. A future release can change the stream-json
 * control protocol that CoVibeCode's SessionActor depends on (this is exactly
 * what broke OpenCovibe v0.1.60 against CC v2.1.150 — see TODO.md #131).
 *
 * This script replicates the two protocol exchanges the app relies on and
 * asserts the responses still have the shape the Rust parser expects:
 *   1. control.rs       — `initialize` control_request  → control_response
 *   2. session_actor.rs — a `user` turn over stdin       → assistant + result
 *
 * Run it after any Claude Code update (or in CI) to confirm compatibility:
 *   node scripts/check-cli-protocol.mjs
 *
 * Exit code 0 = compatible, 1 = a protocol expectation broke.
 */
import { spawn } from "node:child_process";

const TIMEOUT_MS = 60_000;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

const INIT = {
  type: "control_request",
  request_id: "ocv_init_1",
  request: { subtype: "initialize" },
};
const USER_TURN = {
  type: "user",
  uuid: "11111111-1111-1111-1111-111111111111",
  message: { role: "user", content: "Reply with exactly: PONG" },
};

function run() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE_BIN,
      [
        "-p",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose",
        "--model", "haiku", // cheap + fast; protocol shape is model-independent
      ],
      // shell:true so a launcher/.cmd/.ps1 wrapper on PATH (Windows nvm, etc.)
      // resolves exactly as it does in an interactive terminal.
      { stdio: ["pipe", "pipe", "ignore"], shell: true },
    );

    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s waiting for CLI`));
    }, TIMEOUT_MS);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn '${CLAUDE_BIN}': ${e.message}`));
    });
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });

    child.stdin.write(JSON.stringify(INIT) + "\n");
    child.stdin.write(JSON.stringify(USER_TURN) + "\n");
    child.stdin.end();
  });
}

function parseLines(out) {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
}

(async () => {
  let events;
  try {
    events = parseLines(await run());
  } catch (e) {
    console.error(`\x1b[31m✗ ${e.message}\x1b[0m`);
    process.exit(1);
  }

  // 1. initialize → control_response with the nested shape control.rs reads:
  //    response.response.{models,commands,account}
  const cr = events.find((e) => e.type === "control_response");
  check("control_response present", !!cr);
  const data = cr?.response?.response;
  check("control_response.response.response.models[] present", Array.isArray(data?.models) && data.models.length > 0);
  check("control_response.response.response.commands[] present", Array.isArray(data?.commands));
  check(
    "models carry value+displayName (CliModelInfo fields)",
    !!data?.models?.[0]?.value && !!data?.models?.[0]?.displayName,
  );

  // 2. user turn → assistant message + terminal result (session_actor.rs turn loop)
  const assistant = events.find((e) => e.type === "assistant");
  check("assistant event present", !!assistant);
  check("assistant.message.content[] present", Array.isArray(assistant?.message?.content));
  const result = events.find((e) => e.type === "result");
  check("terminal result event present", !!result);
  check("result.is_error === false", result?.is_error === false, `is_error=${result?.is_error}`);

  // Informational: surface any event types this parser version doesn't model
  // explicitly (these fall through to BusEvent::Raw — non-fatal, but worth noting
  // so the team can add first-class handling if a new type becomes important).
  const KNOWN = new Set([
    "control_response", "control_request", "system", "assistant", "user",
    "result", "stream_event", "content_block_start", "content_block_delta",
    "content_block_stop", "message_stop", "tool_progress", "tool_use_summary",
    "rate_limit_event",
  ]);
  const unknown = [...new Set(events.map((e) => e.type).filter((t) => !KNOWN.has(t)))];

  let failed = 0;
  for (const c of checks) {
    const tag = c.pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`${tag} ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
    if (!c.pass) failed++;
  }
  if (unknown.length) {
    console.log(`\x1b[33mℹ unmodeled event types (→ Raw fallback): ${unknown.join(", ")}\x1b[0m`);
  }

  if (failed) {
    console.error(`\n\x1b[31m${failed} protocol check(s) FAILED — CLI protocol may have changed (see TODO.md #131).\x1b[0m`);
    process.exit(1);
  }
  console.log("\n\x1b[32mCLI protocol compatible.\x1b[0m");
})();
