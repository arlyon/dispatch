---
name: dispatch-feedback
description: Wait for an existing Dispatch review result as a non-LLM background command
runner:
  type: external-cli
  command: mise
  args: ["exec", "--", "node", "scripts/wait-feedback.cjs"]
  promptDelivery: stdin
async: true
timeoutMs: 86400000
---
The external command consumes the task's single DISPATCH_WAIT JSON line, invokes dispatch-review wait, and returns the completed feedback JSON on stdout. It creates no Pi session and never enqueues or submits a review. An optional absolute directory selects a private test/custom queue. The harness must notify the caller when this command exits. No language model is involved.
