import { describe, expect, it } from "vitest";
import {
  CACHE_NAME,
  handlesRequest,
  offlineFallbackUrl,
  shellUrls,
  shouldCacheResponse,
  staleCacheNames,
} from "./swCore";

// The three hosts this build has to survive: a domain root, the GitHub
// Pages sub-directory, and the macOS shell's own scheme.
const ROOT = "https://example.org/";
const SUBDIRECTORY = "https://titom741.github.io/plan-editor/";
const SHELL = "planeditor://app/";

describe("shellUrls", () => {
  it("resolves every entry against the scope it is given", () => {
    expect(shellUrls(ROOT)).toEqual([
      "https://example.org/",
      "https://example.org/index.html",
      "https://example.org/manifest.webmanifest",
      "https://example.org/favicon.svg",
      "https://example.org/icon-192.png",
      "https://example.org/icon-512.png",
    ]);
  });

  it("keeps the sub-directory a project page is served from", () => {
    // The bug this guards: a worker that seeds "/index.html" under
    // /plan-editor/ caches the GitHub 404 page as the offline shell.
    for (const url of shellUrls(SUBDIRECTORY)) {
      expect(url.startsWith(SUBDIRECTORY)).toBe(true);
    }
    expect(shellUrls(SUBDIRECTORY)).toContain("https://titom741.github.io/plan-editor/index.html");
  });

  it("works on the macOS shell's custom scheme", () => {
    expect(shellUrls(SHELL)).toContain("planeditor://app/index.html");
  });

  it("seeds the scope itself as well as index.html", () => {
    // Opening the app at the directory URL and at index.html are two
    // different cache keys; offline has to answer both.
    const urls = shellUrls(ROOT);
    expect(urls).toContain(ROOT);
    expect(urls).toContain(`${ROOT}index.html`);
  });

  it("lists no hashed asset", () => {
    // Chunk names change every build: naming one here would guarantee a
    // failed install on the following deploy.
    for (const url of shellUrls(ROOT)) {
      expect(url).not.toContain("/assets/");
    }
  });
});

describe("staleCacheNames", () => {
  it("keeps this build's cache and drops the rest", () => {
    expect(
      staleCacheNames([CACHE_NAME, "plan-editor-shell-v1", "kl-implantation-shell-v1"]),
    ).toEqual(["plan-editor-shell-v1", "kl-implantation-shell-v1"]);
  });

  it("drops nothing when the only cache is the current one", () => {
    expect(staleCacheNames([CACHE_NAME])).toEqual([]);
  });

  it("takes the current name as an argument, so the rule can be tested apart from the constant", () => {
    expect(staleCacheNames(["a", "b"], "b")).toEqual(["a"]);
  });
});

describe("shouldCacheResponse", () => {
  it("keeps a response the server actually answered from inside the scope", () => {
    expect(shouldCacheResponse("https://example.org/assets/app.js", true, ROOT)).toBe(true);
  });

  it("refuses a failed response", () => {
    // Caching a 404 means serving that 404 offline from then on.
    expect(shouldCacheResponse("https://example.org/assets/app.js", false, ROOT)).toBe(false);
  });

  it("refuses another origin", () => {
    expect(shouldCacheResponse("https://cdn.example.net/font.woff2", true, ROOT)).toBe(false);
  });

  it("refuses a neighbour project on the same host", () => {
    // titom741.github.io carries every project page of the account: the
    // origin is not this app, the sub-directory is.
    expect(
      shouldCacheResponse("https://titom741.github.io/autre-app/app.js", true, SUBDIRECTORY),
    ).toBe(false);
    expect(
      shouldCacheResponse("https://titom741.github.io/plan-editor/app.js", true, SUBDIRECTORY),
    ).toBe(true);
  });

  it("treats a different port or scheme as outside the scope", () => {
    expect(shouldCacheResponse("https://example.org:8443/a.js", true, ROOT)).toBe(false);
    expect(shouldCacheResponse("http://example.org/a.js", true, ROOT)).toBe(false);
  });

  it("refuses a URL it cannot parse rather than throwing", () => {
    expect(shouldCacheResponse("not a url", true, ROOT)).toBe(false);
  });

  it("works under the custom scheme the macOS shell serves from", () => {
    // URL.origin reports "null" for a non-special scheme, which is why the
    // rule compares scopes and not origins.
    expect(shouldCacheResponse("planeditor://app/index.html", true, SHELL)).toBe(true);
    expect(shouldCacheResponse("planeditor://ailleurs/x.js", true, SHELL)).toBe(false);
  });
});

describe("offlineFallbackUrl", () => {
  it("sends a page to the shell", () => {
    expect(offlineFallbackUrl("navigate", ROOT)).toBe("https://example.org/index.html");
  });

  it("resolves that shell inside the deployment sub-directory", () => {
    expect(offlineFallbackUrl("navigate", SUBDIRECTORY)).toBe(
      "https://titom741.github.io/plan-editor/index.html",
    );
  });

  it("leaves a subresource without a fallback", () => {
    // HTML in place of a missing script is a MIME-type error, which reads
    // far worse in a console than the network error it replaced.
    expect(offlineFallbackUrl("cors", ROOT)).toBeNull();
    expect(offlineFallbackUrl("no-cors", ROOT)).toBeNull();
    expect(offlineFallbackUrl("same-origin", ROOT)).toBeNull();
  });
});

describe("handlesRequest", () => {
  it("handles reads", () => {
    expect(handlesRequest("GET")).toBe(true);
  });

  it("leaves everything else to the network", () => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      expect(handlesRequest(method)).toBe(false);
    }
  });
});
