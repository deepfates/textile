# dee-zhps Report

Branch: `fix/silent-generation-error`

Worktree: `/tmp/dee-zhps-fix`

## Fix

- `server/apis/generation.ts` no longer treats `req.close` as a reason to send `data: [DONE]`.
- The SSE response headers are flushed before upstream generation starts, so upstream failures are reported as SSE payloads.
- Actual client disconnects are tracked from `res.close`; those abort upstream work without writing an error to a gone client.
- Streaming catch handling now emits `data: {"error": ...}` before ending, and never sends `[DONE]` for upstream failures.
- `client/interface/hooks/useTextGeneration.ts` already surfaces SSE `payload.error` into hook state; `client/interface/Interface.tsx` renders that state visibly in the navigation bar as `Error: ...`.
- Bounce update: `client/interface/hooks/useStoryGeneration.ts` now tracks an empty-completion notice when generation completes with no content and no error. `useStoryTree` passes that notice through, and `client/interface/Interface.tsx` renders it in the navigation bar as `Model returned no text.` This is distinct from red error rendering and distinct from normal generated story output.

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

Bounce update: added `client/interface/hooks/__tests__/promptJoining.test.ts` coverage for the empty-completion classifier used by the hook, asserting empty completed output maps to the visible notice message and non-empty output does not.

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

Focused client command:

```sh
bun test ./client/interface/hooks/__tests__/promptJoining.test.ts
```

Result:

```text
15 pass
0 fail
20 expect() calls
Ran 15 tests across 1 file.
```

Client package command:

```sh
bun test ./client
```

Result:

```text
29 pass
0 fail
47 expect() calls
Ran 29 tests across 5 files.
```

Server package command:

```sh
bun test ./server
```

Result:

```text
45 pass
1 fail
78 expect() calls
Ran 46 tests across 6 files.
```

Failure:

```text
server/__tests__/siteAuth.test.ts:
error: Failed to start server. Is port 0 in use?
(fail) site auth > serves login styles without Tailwind source directives
```

The same failure repeated on a second `bun test ./server` run. I did not change `server/__tests__/siteAuth.test.ts`; the brief already noted the server/full-suite failure as pre-existing triage (`dee-js7e`), so I did not file a duplicate ticket.

Package-scoped command from `package.json`:

```sh
bun test ./server ./client
```

Result:

```text
74 pass
1 fail
125 expect() calls
Ran 75 tests across 11 files.
```

Failure:

```text
server/__tests__/siteAuth.test.ts:
error: Failed to start server. Is port 0 in use?
(fail) site auth > serves login styles without Tailwind source directives
```

Diff hygiene:

```sh
git diff --check
```

Result: no output, exit 0.

## Filed Tickets

None.
