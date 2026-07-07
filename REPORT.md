# Felt Fixes Report

Branch: `felt-fixes`

Commits:
- `d188f0d fix: remember active story on reload`
- `4d3313b fix: strip chat preambles from branches`
- `3c4184d fix: bonk on blocked story navigation`

Required verification:

```sh
bun test ./server ./client
```

Note: in the managed sandbox, the first run could not bind the site-auth test's ephemeral port. The same command passed with normal local port binding enabled.

## dee-amne: Reload Amnesia

Fix:
- `loadStoriesFromIndex` now chooses the default story from existing story metadata (`lastActiveAt`, then `updatedAt`, then `createdAt`) instead of falling back to `orderedIds[0]` on cold boot.
- Root edits stay inside the current loom as root revisions instead of forking into anonymous `Story N` looms.
- Projection overlays the latest root revision text onto the seed root, so generated children remain reachable after reload.

Before reproduce command:

```sh
git show main:client/interface/hooks/useStoryTree.ts | rg -n "orderedIds\\[0\\]|Story \\$\\{Object\\.keys\\(trees\\)\\.length \\+ 1\\}"
```

Before expected evidence:
- `const firstKey = loaded.orderedIds[0];`
- root edit path creates `Story ${Object.keys(trees).length + 1}`.

After reproduce commands:

```sh
git show felt-fixes:client/interface/hooks/useStoryTree.ts | rg -n "chooseInitialStoryKey|getDefaultStoryKey|parentId === null"
git show felt-fixes:client/interface/lync/storyLoom.ts | rg -n "rootRevisions|appendTurn\\(null"
bun test ./client/interface/hooks/__tests__/useStoryTree.test.ts ./client/interface/lync/__tests__/storyLoom.test.ts
```

After expected evidence:
- `chooseInitialStoryKey` selects metadata recency before index order.
- root revisions are appended to the same loom and projected without dropping children.

## dee-slop: Chat-Slop Branches

Choice:
- Prompt armor plus conservative preamble retry.
- Evidence basis: the route was using raw completions against chat models, so prompt armor reduces bad output. Per coordinator ruling, generated preamble text is never stripped; a standalone branch-start preamble is treated as a failed generation and retried instead.

Fix:
- Adds direct-continuation instructions to the raw completion prompt.
- Detects exact-ish standalone assistant preambles at the start of a generation and retries with the same completion parameters up to 2 times.
- If preamble retries are exhausted, keeps and streams the model generation unmodified by preamble cleanup.
- Removes common Markdown emphasis markers before rendering/storing generated branch text.
- Inserts a missing seam space when prompt text ends tight and the cleaned continuation starts tight.
- Detector precision cases from `VERDICT.md` do not trigger retry: `Of course. Here is the story continued: the narrator lied.`, `Here is the story continued: the inscription began on the wall.`, `Continuing the story: rain filled the street.`, and `Of course, here is the story continued in ink across the page.`.

Before reproduce command:

```sh
git show main:server/apis/generation.ts | rg -n "openai\\.completions\\.create|prompt,"
```

Before expected evidence:
- raw `prompt` is sent directly to `openai.completions.create`.

After reproduce commands:

```sh
git show felt-fixes:server/apis/generation.helpers.ts | rg -n "startsWithChatPreamble|stripMarkdownEmphasis|prepareGeneratedText"
bun test ./server/__tests__/generation.test.ts
```

After expected evidence:
- helper tests cover conservative preamble detection, partial-preamble deferral, the `VERDICT.md` false-positive cases, Markdown emphasis cleanup, and `day before.` + `Morning` seam spacing.

## dee-bonk: Silent No-Op Nav

Fix:
- `handleStoryNavigation` now returns `false` for blocked story-surface actions.
- The interface turns blocked arrow presses into a short directional screen shake plus border flash.
- Reduced-motion users get the flash without the shake.

Before reproduce command:

```sh
git show main:client/interface/hooks/useStoryTree.ts | rg -n "case \"ArrowDown\"|case \"ArrowLeft\"|case \"ArrowRight\"" -A18
```

Before expected evidence:
- blocked arrow branches fall through without a return signal.

After reproduce commands:

```sh
git show felt-fixes:client/interface/hooks/useStoryTree.ts | rg -n "Promise<boolean>|return false"
git show felt-fixes:client/interface/Interface.tsx | rg -n "triggerBonk|nav-bonk"
git show felt-fixes:client/styles/terminal.css | rg -n "nav-bonk"
bun test ./server ./client
```

After expected evidence:
- blocked arrow paths return `false`.
- `triggerBonk` applies `nav-bonk-*` classes for visual feedback.

## Filed Tickets

None.
