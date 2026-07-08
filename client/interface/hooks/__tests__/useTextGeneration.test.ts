import { describe, expect, it } from "bun:test";
import {
  formatGenerationErrorMessage,
  OPENROUTER_API_KEY_ERROR_MESSAGE,
} from "../useTextGeneration";

describe("formatGenerationErrorMessage", () => {
  it("turns missing OpenRouter authentication into friendly setup copy", () => {
    expect(
      formatGenerationErrorMessage(
        new Error("401 Missing Authentication header"),
      ),
    ).toBe(OPENROUTER_API_KEY_ERROR_MESSAGE);
  });

  it("turns invalid OpenRouter keys into friendly setup copy", () => {
    expect(
      formatGenerationErrorMessage(new Error("401 User not found.")),
    ).toBe(OPENROUTER_API_KEY_ERROR_MESSAGE);
  });

  it("keeps non-auth generation details visible to the user", () => {
    expect(formatGenerationErrorMessage(new Error("Request was aborted."))).toBe(
      "Request was aborted.",
    );
  });

  it("does not rewrite Textile access-gate errors as OpenRouter setup errors", () => {
    expect(formatGenerationErrorMessage(new Error("Unauthorized"))).toBe(
      "Unauthorized",
    );
  });
});
