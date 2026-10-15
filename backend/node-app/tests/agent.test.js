// Unit tests for LLM output handling (no network).
const { parseFinal } = require("../src/agent/agent");

describe("parseFinal (LLM output validation)", () => {
  test("parses JSON embedded in text / code fences", () => {
    const r = parseFinal(
      '```json\n{"proposedDecision":"ACCEPT","proposedQty":800,"explanation":"ok"}\n```',
    );
    expect(r.proposedDecision).toBe("ACCEPT");
    expect(r.proposedQty).toBe(800);
  });
  test("rejects non-JSON output", () => {
    expect(() => parseFinal("I think you should buy it")).toThrow();
  });
  test("rejects an unknown decision", () => {
    expect(() =>
      parseFinal('{"proposedDecision":"BUY_MORE","explanation":"x"}'),
    ).toThrow(/Invalid/);
  });
  test("rejects missing explanation", () => {
    expect(() => parseFinal('{"proposedDecision":"REJECT"}')).toThrow(
      /explanation/,
    );
  });
});
