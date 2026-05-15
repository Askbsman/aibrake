# agent-spend-guard (Python)

> **Status:** Stage 0.4 beta — thin HTTP client for the Agent Spend Guard hosted API.
>
> **Not a feature-parity SDK.** Mirrors the four integration patterns of the TypeScript SDK; new server features land in the server first and only port to Python when partners ask.

```bash
cd python
pip install -e .
```

(No PyPI release yet — install editable from the repo while the API is in beta.)

```python
from agent_spend_guard import AgentSpendGuard

guard = AgentSpendGuard(
    base_url="https://agent-spend-guard.example.com",
    api_key="asg_v1_your_partner_key",
    failure_mode="open",      # CRITICAL: never block your agent on guard outage
    timeout_ms=1000,
)

result = guard.check_shadow(payload)
print(result["decision"], result["pattern"], result["reason"])
```

See `examples/shadow.py` and `examples/downgrade.py` for runnable examples, and the top-level `PYTHON_SDK.md` for the full integration guide.

## Verification

If Python is installed locally:

```bash
cd python
pip install -e ".[dev]"
python -m pytest                                 # unit tests
AGENT_SPEND_GUARD_URL=http://localhost:8080 \
AGENT_SPEND_GUARD_API_KEY=asg_v1_demo \
python -m pytest -m integration                  # against a live server
```

If Python is **not** installed locally (e.g. on a Windows-only dev box), use the bundled Dockerfile:

```bash
docker build -f python/Dockerfile.test -t asg-python-test python/
docker run --rm asg-python-test                  # unit tests in a container
```

## Surface

| Method | Behavior |
| --- | --- |
| `check(payload)` | Returns the structured result dict. Never raises on guard decisions. |
| `check_shadow(payload)` | Same, but synthesizes `allow` on any transport/decision error. |
| `check_or_confirm(payload, on_warn=...)` | Raises `SpendingGuardBlockedError` on block; calls `on_warn` on warn/require_confirmation. |
| `check_or_downgrade(payload, downgrade_to=..., on_warn=...)` | Auto-applies `suggested_action.model_route.to` from the response, falling back to `downgrade_to`. Returns `(action, result)`. |

## What this client does NOT do

- No async (use sync for now; ping the maintainer if you need asyncio).
- No typed response objects (return dicts; the server response shape evolves).
- No SDK-side retry on transport errors (use `failure_mode="open"` and try again later).
- No `check_deep` helper (the server endpoint is a stub in 0.3 / 0.4).
- No client-side decision logging (the server writes the JSONL).
