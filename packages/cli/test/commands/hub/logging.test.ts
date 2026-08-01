import { describe, expect, it } from "vitest";

import { sanitizeUrlForLogging } from "../../../src/commands/hub/logging.js";

describe("sanitizeUrlForLogging", () => {
  it("redacts query parameters while preserving the request route", () => {
    expect(
      sanitizeUrlForLogging(
        "https://hub.example.test/uploads/file.md?X-Amz-Signature=secret#trace",
      ),
    ).toBe("https://hub.example.test/uploads/file.md?[redacted]#trace");
  });

  it("redacts query parameters from non-URL request targets", () => {
    expect(sanitizeUrlForLogging("/uploads/file.md?token=secret")).toBe(
      "/uploads/file.md?[redacted]",
    );
  });
});
