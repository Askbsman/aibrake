import { describe, expect, it } from "vitest";
import {
  actionFingerprint,
  canonicalJson,
  failureFingerprint,
  inputHash,
  normalizeErrorMessage,
  normalizePath,
} from "../src/core/fingerprints.js";

describe("fingerprints", () => {
  it("failure fingerprint stable across Windows/Unix path separators", () => {
    const a = failureFingerprint({
      failure_signal_type: "build_error",
      failing_file: "C:\\Users\\x\\src\\foo.ts",
      normalized_error_message: "ts2307",
    });
    const b = failureFingerprint({
      failure_signal_type: "build_error",
      failing_file: "C:/Users/x/src/foo.ts",
      normalized_error_message: "ts2307",
    });
    expect(a).toBe(b);
  });

  it("failure fingerprint stable across whitespace variation", () => {
    const a = failureFingerprint({
      failure_signal_type: "build_error",
      normalized_error_message: "  TS2307:  Cannot   find   module  \n",
    });
    const b = failureFingerprint({
      failure_signal_type: "build_error",
      normalized_error_message: "ts2307: cannot find module",
    });
    expect(a).toBe(b);
  });

  it("different error codes produce different failure fingerprints", () => {
    const a = failureFingerprint({
      failure_signal_type: "build_error",
      error_code: "TS2307",
    });
    const b = failureFingerprint({
      failure_signal_type: "build_error",
      error_code: "TS2554",
    });
    expect(a).not.toBe(b);
  });

  it("all fingerprints carry the fp_v1_ prefix", () => {
    const f = failureFingerprint({ failure_signal_type: "exception" });
    const a = actionFingerprint({ action_type: "paid_llm_call" });
    expect(f.startsWith("fp_v1_failure_")).toBe(true);
    expect(a.startsWith("fp_v1_action_")).toBe(true);
  });

  it("canonical JSON has stable key ordering", () => {
    const a = canonicalJson({ b: 1, a: 2, c: 3 });
    const b = canonicalJson({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("inputHash carries input_v1_ prefix", () => {
    const h = inputHash({ actor: { type: "agent" } });
    expect(h.startsWith("input_v1_")).toBe(true);
  });

  it("inputHash redacts raw text fields so payload content never reaches the log", () => {
    const raw = "user wants to ship a paid leaks bot";
    const h1 = inputHash({
      actor: { type: "agent" },
      next_action: {
        type: "paid_llm_call",
        estimated_cost: { amount: 0.1, currency: "USD" },
        reason: raw,
      },
    });
    const h2 = inputHash({
      actor: { type: "agent" },
      next_action: {
        type: "paid_llm_call",
        estimated_cost: { amount: 0.1, currency: "USD" },
        reason: raw,
      },
    });
    expect(h1).toBe(h2);
    // The raw string must not appear inside the hash (sanity).
    expect(h1).not.toContain("paid leaks bot");
  });

  it("normalizeErrorMessage strips line/column markers and timestamps", () => {
    const a = normalizeErrorMessage("Error at file.ts:42:11 (2026-05-14T12:34:56Z)");
    const b = normalizeErrorMessage("error at file.ts:LINE:COL (TS)");
    expect(a).toBe(b);
  });

  it("normalizePath converts backslashes and lowercases consistently", () => {
    expect(normalizePath("C:\\Foo\\Bar.ts")).toBe("c:/foo/bar.ts");
    expect(normalizePath("C:/Foo/Bar.ts")).toBe("c:/foo/bar.ts");
  });
});
