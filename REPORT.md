# dee-zhps Report

Branch: `fix/silent-generation-error`

Worktree: `/tmp/dee-zhps-fix`

## Fix

- `server/apis/generation.ts` no longer treats `req.close` as a reason to send `data: [DONE]`.
- The SSE response headers are flushed before upstream generation starts, so upstream failures are reported as SSE payloads.
- Actual client disconnects are tracked from `res.close`; those abort upstream work without writing an error to a gone client.
- Streaming catch handling now emits `data: {"error": ...}` before ending, and never sends `[DONE]` for upstream failures.
- `client/interface/hooks/useTextGeneration.ts` already surfaces SSE `payload.error` into hook state; `client/interface/Interface.tsx` renders that state visibly in the navigation bar as `Error: ...`.

## Main Reproduction

Primary checkout stayed on `main`; the only local dirt there was the pre-existing untracked `pnpm-lock.yaml`.

`PORT=4123` and `PORT=4124` could not be used in this session, so I used port `41999`.

Commands:

```sh
cd /Users/deepfates/Hacking/github/deepfates/textile
PORT=41999 OPENROUTER_API_KEY=bad-test-key bun run dev
curl -s -N -X POST http://localhost:41999/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Once upon a time","model":"deepseek/deepseek-chat-v3.1","length":"sentence","temperature":1}'
```

Observed client output on `main`:

```text
data: [DONE]
```

Server log showed the hidden failure:

```text
Generation error: error: Request was aborted.
```

## Branch Reproduction

Commands:

```sh
cd /tmp/dee-zhps-fix
PORT=42000 OPENROUTER_API_KEY=bad-test-key bun run dev
curl -s -N -X POST http://localhost:42000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Once upon a time","model":"deepseek/deepseek-chat-v3.1","length":"sentence","temperature":1}'
```

Observed client output on `fix/silent-generation-error`:

```text
data: {"error":"401 Missing Authentication header"}
```

No `[DONE]` marker was sent before or instead of the error.

## Regression Test

Added `server/__tests__/generation.test.ts` coverage that simulates the old race: request `close` fires, then upstream generation throws `Request was aborted.` The test asserts the only stream write is the SSE error payload and that `[DONE]` is absent.

Focused command:

```sh
bun test server/__tests__/generation.test.ts
```

Result:

```text
24 pass
0 fail
50 expect() calls
Ran 24 tests across 1 file.
```

Package-scoped command from `package.json`:

```sh
bun test ./server ./client
```

Result:

```text
73 pass
0 fail
131 expect() calls
Ran 73 tests across 11 files.
```

Full raw command:

```sh
bun test
```

Result:

```text
122 pass
1 fail
1 error
247 expect() calls
Ran 123 tests across 23 files.
```

Known remaining full-suite issue: `tests/e2e/lync-story.spec.ts` is loaded by `bun test` and fails with Playwright's `test() did not expect test() to be called here` error. I did not change that path.

## Filed Tickets

None.
