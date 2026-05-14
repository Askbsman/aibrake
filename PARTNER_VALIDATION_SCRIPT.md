# Spending Guard — Partner Validation Script

> **Goal:** confirm that a real builder running paid agents would put Spending Guard in their workflow this week. Not "interesting" — *deployed in shadow mode within a week*.
>
> **Pass condition:** at least **2 of 3 builders** agree to test Spending Guard in `checkShadow` mode against their own paid agent workflow. Anything less means the wedge isn't sharp enough yet — go back and refine the pitch / pick different partners.

---

## 30-second pitch

> We built Spending Guard — pre-flight middleware for AI agents that catches paid loops **before** the next expensive call.
>
> The first case: an agent fixes the same build or test error 6 times without new evidence and is about to make a 7th expensive LLM call. Spending Guard returns `warn` or `require_confirmation` and tells the operator to refresh context, downgrade the model, or ask a human — *before* the call fires.
>
> It does not block creative iteration, research, planning, or normal debugging *with* evidence. We tested that explicitly.
>
> If this drops in as 5-line middleware — would you put it in your agent workflow this week?

---

## Live demo: The $40 TypeScript Retry Storm

Share screen, run:

```bash
npx tsx examples/40-dollar-retry-storm.ts
```

Talk through the output as it appears:

- 6 prior paid Claude Opus calls on the same `TS2307: Cannot find module` build error
- No files read, no tests rerun, no git diff change between attempts
- About to fire the 7th paid call (~$0.42)
- Spending Guard says:
  - **decision:** `require_confirmation`
  - **pattern:** `stale_context_retry_storm`
  - **risk_score:** 100 (critical)
  - **confidence:** 0.90
  - **reason:** *"Attempt #7 on the same build_error: 6 prior repeats with no evidence gathered in any attempt. Another paid retry is unlikely to produce a different result without a context refresh."*
  - **suggested action:** read the actual failing file, run the exact failing test, confirm the git diff, or downgrade the model
- The structured decision log event prints below — show that `input_hash` is `input_v1_…` and the raw prompt is *not* in the log

**Total demo time: under 90 seconds.**

If you need a second demo, show one false-positive case from the audit (writer-agent rewriting paragraph 10 times → `decision: allow`, no `stale_context_retry_storm` fire). That sells the *non*-trigger as hard as the trigger.

---

## Questions to ask (in order, do not skip)

1. **Have you seen this pattern in your own agent workflow?**
   - If "no" → the partner is wrong; thank and end.
   - If "yes" → ask for a recent example with rough $ cost. That number is your future case study.

2. **Would you integrate this as middleware this week?**
   - The week test is load-bearing. "Eventually" = no.
   - "Next sprint" is a soft yes. Probe what would unblock this week.

3. **Would you start in `checkShadow`, `checkOrConfirm`, or `checkOrDowngrade`?**
   - `checkShadow` → low-friction integration; right answer for first partner.
   - `checkOrConfirm` → they already trust the judgment.
   - `checkOrDowngrade` → they have a routing layer; good fit.
   - "I'm not sure" → walk them to `checkShadow` as the safe entry.

4. **What telemetry can your runtime provide?**
   - Best answer: action type, model, cost, error fingerprint, files/tests/logs touched per attempt.
   - Acceptable: a subset; missing fields lower confidence, not block integration.
   - If the runtime cannot expose any of these → integration cost is high; flag as a v0.2 conversation, not a v0.1 partner.

5. **What warning would you actually act on?**
   - Listen for what triggers human confirmation in their stack today. Match the SDK pattern to that.
   - If "I'd ignore all warnings" → product-market fit problem; not a code problem.

6. **What false block would make you remove it?**
   - Make them name a real one. "Blocks a legitimate Cursor session," "stops a customer demo run," etc.
   - Whatever they name becomes a regression test in the audit suite.

7. **Would you pay for it if it saved paid retries?**
   - Don't anchor a price. Listen for "yes if it saves $X / month" vs "we'd only use it free." Both are useful signal.
   - If "no even if it works" → no business; thank and end.

---

## Pass condition

> **2 of 3 builders agree to test in `checkShadow` mode against their own paid agent workflow within one week.**

What counts as a "yes":

- They have a real paid agent workflow they can point at.
- They will send us a sample telemetry payload or wire `checkShadow` themselves.
- They agree to share the resulting decision-log events for one week so we can tune.

What does NOT count as a "yes":

- "Interesting, send me the link."
- "When you have a hosted version."
- "After we ship our v2."

If we don't get 2 of 3, the failure mode is almost always one of:

- **Wrong partners.** They don't run paid agents at meaningful volume yet. Find people with a real spend problem.
- **Pitch is too abstract.** Open with a concrete dollar amount they recognize ("agent burning $30 chasing a TypeScript error" → "we caught that") not with architecture.
- **Wedge is wrong.** If multiple partners say "I've seen this but I'd ignore the warning," then `stale_context_retry_storm` may be the wrong first detector. Re-investigate which loop pattern they'd actually act on, and pivot the first detector there.

---

## What NOT to mention in the pitch

These are real but distracting in a 30-second conversation:

- x402 marketplace listing (mention only if the partner asks about payment)
- Sober Builder consumer brand
- Builder Mode / Family Mode / Stop Ritual
- Full SDK API surface (show only `checkShadow` first)
- Detector taxonomy beyond `stale_context_retry_storm`
- Confidence formula, fingerprint algorithm, evidence model details (offer the README if asked)

Anything that doesn't shorten the path to *"yes, I'll wire `checkShadow` this week"* — leave it out.

---

## After the call

Within 1 hour, capture in `validation-log.md` (gitignored, partner-specific):

```
Partner:
Date:
Stack (agent runtime, paid surfaces):
Q1 Seen the pattern?:
Q2 Integrate this week?:
Q3 Which SDK helper?:
Q4 Telemetry they can ship:
Q5 Warnings they'd act on:
Q6 False blocks that would kill it:
Q7 Pay if it saved retries?:
Result: [yes / soft-yes / no]
Notes / direct quotes:
```

After three calls, tally:

- 3 / 3 yes → ship hosted, take their money
- 2 / 3 yes → ship hosted to those two, hold tuning data for one cycle
- 1 / 3 yes → pivot the pitch or the first detector; do not start v0.2 yet
- 0 / 3 yes → stop building, revisit the wedge

---

## Reference materials to have open during the call

- This repo's `README.md` (status banner at the top)
- `STAGE_0_1_1_AUDIT_REPORT.md` (only if a partner asks "does this work?")
- A running `npx tsx examples/40-dollar-retry-storm.ts` shell
- One side-by-side false-positive demo (writer-agent rewriting) — to be ready if pushed back on false positives

Nothing else. Keep the surface area tight.
