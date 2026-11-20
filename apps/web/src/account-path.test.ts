import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./account-path";

describe("safeReturnPath", () => {
  const origin = "https://news.example";
  it("keeps only safe same-site destinations", () => {
    expect(safeReturnPath("/topics/t-0123456789abcdef01234567/news/abcd/?from=home#source", origin)).toBe("/topics/t-0123456789abcdef01234567/news/abcd/?from=home#source");
    expect(safeReturnPath("/account/favorites/", origin)).toBe("/account/favorites/");
  });
  it.each(["https://evil.example/", "//evil.example/", "/\\evil.example/", "/%5cevil.example/", "/%2fevil.example/", "/api/auth/me", "/account/login/", "javascript:alert(1)", "/bad\npath"])('rejects unsafe return %s', input => {
    expect(safeReturnPath(input, origin)).toBeNull();
  });
});
