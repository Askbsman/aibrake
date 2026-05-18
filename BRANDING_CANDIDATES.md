# Branding candidates — what to ask before buying the domain

> Working name today: **AIBrake** (`spending-guard` on npm).
> Working domain we keep typing: `aibrake.dev` — 17 characters, three concepts, hard to say fast over a call.
>
> The rename is not mandatory. The product can ship 1.0 as AIBrake. But if you're at the registrar anyway, this is the right moment to consider sharper alternatives.

---

## 1. Criteria for a strong dev-tool / infra brand

Looking at the names that actually stuck in our peer group — Sentry, Vercel, Linear, Resend, Stripe, Modal, Pulumi, Anchor, Cursor, Render, Fly:

| Criterion | Why it matters | "AIBrake" score |
| --- | --- | --- |
| **Short** (1-2 syllables, 4-8 letters) | Easier to type, fits in a tab title, looks good in `import { X } from "x"` | ❌ three words / 17 chars |
| **Pronounceable** in EN and any non-EN | Founders + partners pronounce it the same way | ✅ |
| **Memorable after one hearing** | Word-of-mouth distribution is the wedge | ⚠️ generic enough you might forget |
| **Available on `.com` / `.dev` / `.ai`** | Don't ship on `.xyz` or hyphenated for an infra product | ❌ `.com` likely taken or expensive |
| **Doesn't over-claim the category** | Leaves room to expand. "Sentry" isn't "ErrorReporter" | ⚠️ "Spend Guard" pins us to one use case |
| **Has a visual hook** | A logo can grow around a strong word (lighthouse, anchor, stripe) | ⚠️ no obvious visual |
| **Domain root matches product** | `vercel.com → Vercel`; not `vercel-app.com → Vercel App` | ❌ npm is `spending-guard`, would-be domain `aibrake.dev` |

Net: room for improvement, especially on length and domain root.

---

## 2. Naming directions

### Direction A — keep the name, get a shorter domain

Lowest-effort: keep "AIBrake" as the user-facing name, but acquire a tighter domain.

| Candidate | Reads as | Likely status |
| --- | --- | --- |
| `asg.dev` | three-letter acronym | almost certainly taken |
| `spendguard.com` | drops "Agent" | check |
| `spendguard.dev` | same | check |
| `spendguard.ai` | same, AI-tier | likely available at $60-100/yr |
| `agentguard.com` | drops "Spend" | check |
| `agentguard.dev` | same | check |
| `aspend.dev` | a-spend | check, weird-but-coined |
| `nospend.dev` | clear negation | check |

**Tradeoff:** product name stays "AIBrake" — three words, still long in conversation. But the technical surface (domain, npm package eventually) gets cleaner.

### Direction B — invented / one-word rebrand

The Vercel/Stripe pattern. Short coined or repurposed word that becomes the brand. Product still does loop detection, but the name doesn't dictate the category.

Sorted by my subjective ranking (highest first):

| Candidate | Meaning / hook | Why I'd consider it |
| --- | --- | --- |
| **Halt** | imperative verb, "stop" | shortest possible, exactly what we do at the highest-risk decision point |
| **Loopkit** | "kit" = dev-tool tier | clear category, on-brand for the wedge |
| **Loopless** | adjective | aspirational ("be loopless"), memorable |
| **Reroute** | what we do (downgrade) | active verb, dev-tool tone |
| **Veer** | change direction | short, action-oriented |
| **Cinch** | tighten / secure / "easy" | short, has the warmth of "we make this easy" |
| **Vet** | to check / judge | three letters, accurate verb |
| **Trim** | cut costs | short, financial overtone |
| **Pivly** | pivot + ly | invented, dev-tool suffix |
| **Quench** | satisfy / stop a burn | "quench the burn" reads well |
| **Curb** | restrain | financial undertone |
| **Sift** | filter | what we do |
| **Reverb** | echo / loop | gentle pun on retry-storm |
| **Spendly** | spend + ly | Linear-style suffix |
| **Echo** | loop concept | very nice, surely taken on .com |
| **No7th** | "don't pay for the 7th guess" | strong narrative, weird as a brand |

### Direction C — sound-driven coined names

Made-up words that look good in a logo and on a billing email.

| Candidate | How it parses |
| --- | --- |
| **Halto** | halt + o suffix |
| **Pauly** | pause + suffix |
| **Veerly** | veer + ly |
| **Loopa** | loop + a |
| **Brakefly** | brake + fly |
| **Stallium** | stall + ium |
| **Curbex** | curb + ex |

These are weaker — none has a clear hook — but they almost always have a `.com` available, which is its own advantage.

---

## 3. My recommendations

If I were buying the domain today, in order of preference:

### Top pick: `loopkit.dev` or `loopkit.com`

- 7 letters, two syllables, dev-tool tier
- Direct conceptual link (loops) without claiming the entire "agent" or "spend" category
- The npm package can become `loopkit` cleanly
- Lets the product expand into adjacent loop-detection territory without renaming
- "It's a kit for catching wasteful loops" — one-liner explains itself

### Strong runner-up: `loopless.com` / `loopless.ai`

- Aspirational name ("we make agents loopless")
- 8 letters, easy to spell
- The brand promise IS the name

### If you want the punchiest possible: `halt.dev` (likely taken) or `halt.run`

- Three-letter verb, exactly what the guard does at peak signal
- Risk: too generic, may not differentiate
- Almost certain `.com` is taken; `.dev` worth checking

### If you want to keep AIBrake: `spendguard.dev`

- Drops "Agent" (which doesn't add information)
- Keeps the product name intact in marketing
- Cheap to acquire

---

## 4. How to check availability fast

Use `scripts/check-domains.mjs` to filter the candidate list by DNS state in 30 seconds:

```bash
npm run check:domains
```

It probes each candidate across `.com / .dev / .ai / .io` and prints:

```
loopkit.com     LIKELY TAKEN    has NS records, has A records
loopkit.dev     MAYBE FREE      NXDOMAIN — no DNS at all
loopkit.ai      LIKELY TAKEN    has NS records
loopkit.io      MAYBE FREE      NXDOMAIN
...
```

**Caveat:** DNS-only check is a fast filter, not WHOIS truth. A registered-but-parked domain shows DNS too; an unregistered domain can also briefly show no DNS. The right final check is Namecheap / Porkbun search.

After running, pick 3-5 that show "MAYBE FREE" and confirm on a registrar before committing.

---

## 5. Decision rule

Don't overthink. Spend 30 minutes here, not 30 hours.

```text
1. Run npm run check:domains
2. Pick a name whose .com or .dev says "MAYBE FREE"
3. Verify on Namecheap (5 seconds)
4. If verified free and you like it for >24 hours: buy it
5. If you dislike it after 24 hours: pick the next one on the list
6. Do NOT optimize for the perfect name — names matter less than shipping
```

The product is `spending-guard@0.5.3-beta` whether the domain is `aibrake.dev` or `loopkit.dev`. A good name compounds over years; a perfect name compounds the same way. Pick something defensible and move.

---

## 6. What I'd do if you can't decide

If after 30 minutes no name feels right:

1. **Keep "AIBrake" as the product**
2. **Buy `spendguard.com` if available (or `spendguard.dev`)**
3. **Redirect www.aibrake.dev → spendguard.com** later if you find the better one
4. **Move on to deployment**

The cost of a wrong name is "buy a second domain in 6 months." The cost of a 3-week naming detour is real partners going elsewhere.
