# Movement hitch investigation — 2026-11-05

Terrain publication now respects the configured moving limit even when several
worker pages are waiting. The old `adaptiveCommitBudget` selected the idle limit
of four whenever the queue grew beyond the moving limit of one. That grouped
texture uploads and new draws at the chunk boundary. The queue's CPU-copy budget
does not account for that later renderer work.

Idle publication still drains faster, and the existing nearest-first queue,
superseded-page checks, collision readiness and visual settings are preserved.
The fix is committed as `97a5003d`.

## Reproduction and diagnosis

- A test using the real view's reset, worker completion, commit queue and default
  flush path reproduced four publications in one moving frame. It failed before
  the fix and now passes. It also checks nearest-first order and idle draining.
- Runtime captures reproduce the scheduling difference: the frozen baseline
  publishes up to four pages in a movement frame; the candidate diagnostic
  publishes at most one.
- The water-generation counter is worker execution time. It is not evidence of
  synchronous water generation on the main thread. A first-draw shader probe
  observed no cold water shader builds during movement, so the warmup path was
  left unchanged.

The two Vite snapshots use matching runtime sources, with the original terrain
view supplied through a loader for the baseline. All 40 emitted JavaScript chunks
match after normalizing generated filename hashes and the controlled
`adaptiveCommitBudget` method. The local parity record is
`tmp/hitches/snapshot-parity.json`.

## Validation

- All **4,093 Node tests pass**, with concurrency four.
- ESLint passes for the changed runtime, test and QA runner. `git diff --check`
  passes.
- Both corrected frozen-build captures complete movement and recovery, report no
  browser errors, pass collision readiness and timing, and end with zero missing
  or under-density in-view grass tiles. These are functional observations;
  foreground loss prevents accepting their recovery latency or frame timings.
- The candidate memory diagnostic completes without a browser crash and confirms
  the one-page limit and collision gate. It is a diagnostic capture, rather than
  accepted frame-pacing evidence.

The [compact work-count record](research/movement-hitch-work-counts-2026-11-05.json)
preserves the four-to-one publication change, functional checks and rejected
timing status, with hashes of the local source reports.

The current captures lost native foreground focus. Their FPS, hitch counts and
frame-time comparisons are rejected under [performance QA](perf-qa.md). A valid
before/after timing comparison remains outstanding; this report does not claim
that all movement hitches are eliminated. One baseline attempt also reached
Chromium's out-of-memory crash screen before measurement; it supplies no timing
evidence.

## QA runner corrections

The optional grass and recovery diagnostics previously imported `/src/...`
modules inside the browser. Those development URLs do not exist on a frozen
production build. The runner now uses the installed meadow layer's constructor
and the existing `window.__perfQa.counters()` API. This reads the same live module
instances without depending on development URLs.

A page-crash listener now aborts the owned browser so an out-of-memory crash
cannot leave the runner waiting for a report. The ordinary focus, backend,
browser-error, settling and collision checks retain their existing requirements.

Local diagnostic artifacts are in `tmp/hitches/`; no temporary profiling hooks
were added to application code.
