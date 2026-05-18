# AIBrake Beta Feedback

> Fill this in after **7 days** of `checkShadow` usage against a real paid agent workflow. Honest answers help us tune the product. Soft-yes answers help less than a clear "no, here's why."

---

## Integration

- **Time to integrate:**
- **Runtime / framework you wired it into:** (Claude Code / Cursor / OpenClaw / custom Node / Python / other)
- **Mode used:** shadow | confirm | downgrade
- **What hosted URL did you use:**

---

## 7-day summary

(If your hosted instance writes JSONL logs, run `npm run logs:summary` and paste here. If not, eyeball.)

- **Total `/v1/check` calls:**
- **`decision: allow`:**
- **`decision: warn`:**
- **`decision: require_confirmation`:**
- **`decision: block`:**
- **Most common `pattern`:**
- **Most common `recommended_policy`:**

---

## Three useful warnings

(Paste a `decision: warn` or `require_confirmation` line where the recommendation matched what you would have done anyway, or surfaced something you missed.)

1.
2.
3.

---

## Three bad warnings / false positives

(Paste any case where you would not have acted on the warning. These are the most valuable to us.)

1.
2.
3.

---

## Did it save money?

- yes | no | unclear
- If yes, rough estimate of $ saved over 7 days:
- Example situation:

---

## Did anything leak?

- Did you see any raw prompt content in your decision logs? **yes | no**
- Did you see any raw API key in your decision logs? **yes | no**
- Did the server ever 500 / crash / hang? **yes | no**

If yes to any of the above, paste a redacted snippet — this is the most important section.

---

## Would you keep it enabled?

- yes | no | maybe
- Why:

---

## Would you pay for it?

- yes | no | maybe
- Fair price (per check / per month / both):
- What would make you certain "yes":

---

## What is missing?

Open-ended. Anything you wished it did but didn't. Anything that confused you. Anything in the docs that misled you.

---

## Anything else

Vent here if needed.
