# Upstream PR draft — automerge/automerge-repo

Everything below is ready to submit. The three commands at the bottom are the only
manual step (public post from your account, so it's yours).

## Title

fix: clamp throttle delay to zero to avoid TimeoutNegativeWarning

## Body

`throttle()` in `src/helpers/throttle.ts` computes the trailing-call wait as
`lastCall + delay - Date.now()`. When the debounce target has already passed
(event-loop delay, repeated reconnects, story-writing bursts), this value goes
negative and is passed directly to `setTimeout`, which emits
`TimeoutNegativeWarning: -N is a negative number` on Node and Bun.

The comment on the tail-call branch already acknowledges that a negative value
means "execute immediately," so this clamps the computed wait with
`Math.max(0, ...)` — same behavior (overdue trailing call fires next tick,
nothing dropped), no more warning noise.

Repro (Node 20+ / Bun):

```js
import { throttle } from "@automerge/automerge-repo/helpers/throttle.js"
const t = throttle(() => {}, 100)
t(); await new Promise(r => setTimeout(r, 200)); t()
// -> TimeoutNegativeWarning
```

We hit this in production driving repeated document syncs through
`automerge-repo` 2.5.5 and verified the clamp against a two-client sync
convergence test (documents still converge, warning gone). Still present in
2.5.6.

## The change

One line in `src/helpers/throttle.ts`:

```diff
-    wait = lastCall + delay - Date.now()
+    wait = Math.max(0, lastCall + delay - Date.now())
```

## Commands (run from anywhere)

```sh
gh repo fork automerge/automerge-repo --clone /tmp/automerge-repo-fork
cd /tmp/automerge-repo-fork && git switch -c fix-throttle-negative-timeout
# apply the one-line change to src/helpers/throttle.ts (see diff above), then:
git commit -am "fix: clamp throttle delay to zero to avoid TimeoutNegativeWarning"
git push -u origin fix-throttle-negative-timeout
gh pr create --repo automerge/automerge-repo --title "fix: clamp throttle delay to zero to avoid TimeoutNegativeWarning" --body-file <this file's Body section>
```
