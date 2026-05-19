import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/core/check.js";
import { setLoggerSink } from "../../src/core/logger.js";
import { baseInput } from "../helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("unverified_success_assertion detector", () => {
  it("blocks a deployment_assertion with zero verifications", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "deployment_assertion",
          estimated_cost: { amount: 0, currency: "USD" },
          reason: "Deployed aibrake/auto to vidimai.ru, PM2 restarted",
        },
        history: {
          evidence_signals: {
            health_check_run: false,
            endpoint_curled: false,
            process_status_checked: false,
            logs_read_after_action: 0,
            tests_run_after_action: 0,
          },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.pattern).toBe("unverified_success_assertion");
    expect(out.decision).toBe("block");
    expect(out.matched_rules).toContain("zero_verification_signals");
    expect(out.matched_rules).toContain("hard_deploy_unverified");
  });

  it("warns / requires confirmation on a generic success_assertion with zero verifications", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "success_assertion",
          estimated_cost: { amount: 0, currency: "USD" },
          reason: "All set",
        },
        history: { evidence_signals: {} },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.pattern).toBe("unverified_success_assertion");
    expect(["warn", "require_confirmation", "block"]).toContain(out.decision);
  });

  it("flags a restart_assertion with only one weak verification", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "restart_assertion",
          estimated_cost: { amount: 0, currency: "USD" },
        },
        history: {
          evidence_signals: {
            // One verification — but for a restart that's not enough.
            git_diff_verified: true,
          },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.pattern).toBe("unverified_success_assertion");
    expect(out.matched_rules).toContain("only_one_verification_signal");
  });

  it("passes a deployment_assertion that was actually verified (2+ signals)", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "deployment_assertion",
          estimated_cost: { amount: 0, currency: "USD" },
        },
        history: {
          evidence_signals: {
            process_status_checked: true,
            endpoint_curled: true,
            logs_read_after_action: 5,
          },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.pattern).not.toBe("unverified_success_assertion");
    expect(out.decision).toBe("allow");
  });

  it("does not fire on plain paid_llm_call actions (different category)", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "paid_llm_call",
          provider: "anthropic",
          model: "claude-sonnet",
          estimated_cost: { amount: 0.05, currency: "USD" },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.pattern).not.toBe("unverified_success_assertion");
  });

  it("provides the specific missing verifications in the reason", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "deployment_assertion",
          estimated_cost: { amount: 0, currency: "USD" },
        },
        history: {
          evidence_signals: {
            // none truthy
          },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.reason).toMatch(/process_status_checked|endpoint_curled/);
  });

  it("does not double-fire — only one entry in detector_versions", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "task_complete",
          estimated_cost: { amount: 0, currency: "USD" },
        },
        history: { evidence_signals: {} },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.detector_version).toContain("unverified_success_assertion");
  });
});
