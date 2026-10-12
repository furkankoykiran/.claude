#!/usr/bin/env bun
// Deterministic official-protocol fixture; never reads login/session/keyring state.
import { readFile } from "node:fs/promises";
if (process.argv.includes("--help")) { console.error("--input-format --output-format --disable-slash-commands"); process.exit(0); }
if (process.argv.includes("models")) { console.log("fixture-model Fixture model"); process.exit(0); }
if (process.env.FIXTURE_AGY_AUTH === "missing") process.exit(1);
const conversation = crypto.randomUUID();
console.log(JSON.stringify({ event: "init", conversation_id: conversation, init: { model: "fixture-model" } }));
for await (const line of console) {
  const request = JSON.parse(line);
  const hooks = JSON.parse(await readFile(".agents/hooks.json", "utf8"));
  const guard = Bun.spawn(["sh", "-c", hooks["gateway-native-deny"].PreInvocation[0].command], { cwd: ".agents", stdin: "pipe", stdout: "ignore" });
  guard.stdin.write(JSON.stringify({ conversationId: conversation })); guard.stdin.end();
  if (await guard.exited) process.exit(1);
  const data = JSON.parse(request.message.content.split("REQUEST:\n")[1]);
  const text = data.current_user_text.match(/exactly ([a-f0-9-]+) and/)?.[1] ?? data.current_user_text;
  console.log(JSON.stringify({ event: "result", result: { conversation_id: conversation, status: "SUCCESS", num_turns: 1, structured_output: { text, tool_calls: [] } } }));
  process.exit(0);
}
