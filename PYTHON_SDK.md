# PYTHON_SDK.md — Agent Spend Guard Python Client

> **Status:** Stage 0.4 beta.
> **Source:** `python/` in this repo.
> **Discipline:** thin HTTP client mirroring the TypeScript SDK; not a feature-parity SDK.

This document is for Python operators integrating Agent Spend Guard into their LangChain / CrewAI / AutoGen / scraper / research-agent workflows. The TS SDK is in `src/sdk/`; both share the same surface (`check`, `check_shadow`, `check_or_confirm`, `check_or_downgrade`).

---

## 1. Install

Until the first PyPI release, install editable from the repo:

```bash
git clone <repo>
cd repo/python
pip install -e .
```

For tests:

```bash
pip install -e ".[dev]"
python -m pytest
```

If you cannot install Python locally:

```bash
docker build -f python/Dockerfile.test -t asg-python-test python/
docker run --rm asg-python-test
```

---

## 2. Five-line integration

```python
from agent_spend_guard import AgentSpendGuard

guard = AgentSpendGuard(
    base_url="https://agent-spend-guard.example.com",
    api_key="asg_v1_partner_key",
    failure_mode="open",     # CRITICAL: never block your agent on guard outage
)
result = guard.check_shadow(payload)
print(result["decision"], result["pattern"], result["reason"])
```

That is the entire surface for the shadow-mode integration. Read on for the enforcing-mode helpers.

---

## 3. The four helpers

### 3.1 `check(payload) -> dict`

Returns the full structured response. **Never raises on a guard decision** (allow / warn / block / uncertain). Raises only on local programmer errors or, with `failure_mode="throw"`, on transport errors.

```python
result = guard.check(payload)
if result["decision"] == "block":
    log.error("guard blocked: %s", result["reason"])
```

### 3.2 `check_shadow(payload) -> dict`

Same as `check()` but swallows transport errors too — returns a synthetic `{decision: "allow", pattern: "guard_unavailable", error: {...}}` on any failure. **Recommended default for first-week integrations.**

```python
result = guard.check_shadow(payload)
# Always returns a dict; safe to log and ignore the verdict.
```

### 3.3 `check_or_confirm(payload, on_warn=...) -> dict`

Opinionated control flow:

| Guard decision | Behavior |
| --- | --- |
| `allow` | return result |
| `warn` / `require_confirmation` | call `on_warn(result)`; if it returns `False`, raise `SpendingGuardConfirmationDeniedError` |
| `delay` | return result (no callback) |
| `block` | raise `SpendingGuardBlockedError` |
| `uncertain` | apply the configured `uncertain_policy` (default `allow_with_log`) |

```python
def ask_human(result: dict) -> bool:
    return input(f"Guard says {result['decision']}. Continue? [y/N] ").strip().lower() == "y"

try:
    guard.check_or_confirm(payload, on_warn=ask_human)
    run_action(payload["next_action"])
except SpendingGuardBlockedError as err:
    log.error("blocked: %s", err.result["reason"])
```

### 3.4 `check_or_downgrade(payload, downgrade_to=..., on_warn=...) -> (action, result)`

The most useful helper for primary/secondary model workflows.

When the response carries `suggested_action.model_route.to` (set by the server when `objective.model_policy.secondaryModel` is declared), the SDK returns that secondary model as the action your agent should actually run. If no route is present, the static `downgrade_to` argument is used.

```python
action, result = guard.check_or_downgrade(
    payload,
    downgrade_to={"provider": "openai", "model": "gpt-3.5-turbo", "estimated_cost": 0.02},
)
# Returns the (possibly downgraded) action — pass it to your real model call.
response = openai_client.chat.completions.create(model=action["model"], ...)
```

`downgrade_to` keys (all optional, all overridden by route from the server when present):

- `provider`: str
- `model`: str
- `estimated_cost`: float (USD)

---

## 4. Constructor options

```python
AgentSpendGuard(
    base_url: str,                                       # required
    api_key: str | None = None,                          # required for hosted servers in required-auth mode
    timeout_ms: int = 500,                               # /v1/check is hot-path; keep tight
    failure_mode: "open" | "closed" | "throw" = "open",  # what happens when the guard is unreachable
    uncertain_policy: "allow_with_log" | "ask_human" | "run_deep_check" | "throw" = "allow_with_log",
    on_failure_open: Callable[[Exception], None] | None = None,  # called on every transport error
)
```

`failure_mode` is the most important knob. **`"open"` is the recommended default for production.** If the guard is unreachable, your agent keeps working; the SDK returns a synthetic `allow` result with `pattern: "guard_unavailable"` and `error.code: "GUARD_UNAVAILABLE"` so you can log it.

---

## 5. Payload shape

Identical to the TS SDK payload shape. See `examples/payloads/` at the repo root for runnable JSON fixtures:

- `retry-storm.json` — coding-agent failed-build retry storm
- `scraper-loop.json` — paid scraper polling the same URL
- `premium-model-loop.json` — primary/secondary model with model_policy declared

Minimum fields (everything else is optional):

```python
{
    "actor": { "type": "agent" },
    "next_action": {
        "type": "paid_llm_call",
        "estimated_cost": { "amount": 0.42, "currency": "USD" },
    },
}
```

You will get a low-confidence result with this minimum. To get useful warnings, send `history.failure_signal_present`, `history.same_failure_count`, `history.new_evidence_since_last_attempt`, and a `objective.id`. See PARTNER_ONBOARDING.md "Pick your path" tiles for the minimal shape per runtime profile.

---

## 6. Cold-start convention

When you call `check()` for the first time on an objective with no prior attempts, send:

```python
"history": {
    "attempt_number": 1,
    "same_action_count": 0,
    "new_evidence_since_last_attempt": None,    # ← not False
    ...
}
```

Setting `new_evidence_since_last_attempt: False` on attempt 1 used to trigger a false positive in 0.3.0 (Partner A reproduction; fixed in 0.3.1). `None` is the correct signal for "I have not gathered evidence yet because no prior attempt exists."

After attempt 2+, set `False` if no investigation happened between attempts, `True` if it did.

---

## 7. Detector policy overrides

Per-request (Stage 0.4):

```python
"objective": {
    "id": "...",
    "detector_policy": {
        "same_tool_retry_threshold": 3,                       # default 6
        "premium_retry_without_evidence_threshold": 2,        # default 3
        "expensive_action_usd_threshold": 0.05,               # default 0.10
        "require_confirmation_after_repeats": 4,              # default 5
    },
}
```

High-cost scrape workflows ($0.50+ per call) typically want `same_tool_retry_threshold: 3`. Low-cost LLM workflows ($0.02 per call) keep the default 6. Premium-model workflows benefit from `premium_retry_without_evidence_threshold: 2`.

These overrides are per-request and never server-side state. Each call may carry different policy if your operator workflows differ.

---

## 8. Errors

```python
from agent_spend_guard import (
    SpendingGuardBlockedError,            # decision == "block"
    SpendingGuardConfirmationDeniedError, # on_warn returned False
    SpendingGuardClientError,             # base class + programmer errors
)
```

`.result` on the exception is the full structured response — useful for logging.

---

## 9. Honesty contract

This client is **a thin HTTP wrapper**. It does NOT:

- track session state — that is in your wrapper
- compute failure_fingerprint — see `CODING_AGENT_ADAPTER.md` for runtime-specific patterns
- ship decision logs anywhere — the server writes JSONL
- do retries on transport failure — use `failure_mode="open"` and try again next call
- support async — sync only in 0.4

If you need any of the above, write it in your wrapper and tell the maintainer what would have helped.

---

## 10. Repo layout

```
python/
├── pyproject.toml
├── README.md
├── Dockerfile.test
├── agent_spend_guard/
│   ├── __init__.py        # public exports
│   ├── client.py          # AgentSpendGuard class
│   └── errors.py          # exception types
├── tests/
│   ├── conftest.py
│   ├── test_client.py     # 16 unit tests (mocked)
│   └── test_integration.py # 4 integration tests (live server)
└── examples/
    ├── shadow.py          # check_shadow integration
    └── downgrade.py       # check_or_downgrade with model_route
```

Source of truth for the API contract is the TS server in `src/`. If the TS response shape changes, this client may need an update — see CHANGELOG.md.
