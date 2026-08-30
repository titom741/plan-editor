import Testing
import Foundation
@testable import PlanEditorMac

/// Covers the routing the shell puts in front of the web build. The web
/// view itself is not involved: what can be wrong here is which file a URL
/// names, whether a URL can name a file outside the bundle at all, and the
/// MIME type — WebKit refuses to execute a script served as `text/plain`,
/// so that table is as load-bearing as the paths.
@Suite("WebAppSchemeHandler")
struct WebAppSchemeTests {
    /// A throwaway copy of the shape `dist/` has.
    private func makeBundle() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("webapp-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("assets"),
            withIntermediateDirectories: true
        )
        try "<!doctype html><div id=\"root\"></div>".write(
            to: root.appendingPathComponent("index.html"), atomically: true, encoding: .utf8
        )
        try "console.log('chargé')".write(
            to: root.appendingPathComponent("assets/index-abc.js"), atomically: true, encoding: .utf8
        )
        return root
    }

    private func url(_ path: String) -> URL {
        URL(string: "\(WebAppSchemeHandler.scheme)://\(WebAppSchemeHandler.host)\(path)")!
    }

    @Test("the root-absolute asset paths Vite emits resolve inside the bundle")
    func servesAbsoluteAssetPaths() throws {
        // This is the whole reason the handler exists: `/assets/…` under
        // file:// pointed at the filesystem root and the app came up blank.
        let root = try makeBundle()
        defer { try? FileManager.default.removeItem(at: root) }

        let resolved = WebAppSchemeHandler.resolve(url("/assets/index-abc.js"), in: root)
        guard case let .found(_, data, mimeType) = resolved else {
            Issue.record("le script du bundle n'a pas été trouvé")
            return
        }
        #expect(String(data: data, encoding: .utf8) == "console.log('chargé')")
        #expect(mimeType == "text/javascript")
    }

    @Test("the bare origin serves the page, as a web server would")
    func servesIndexAtRoot() throws {
        let root = try makeBundle()
        defer { try? FileManager.default.removeItem(at: root) }

        for path in ["/", ""] {
            guard case let .found(_, data, mimeType) = WebAppSchemeHandler.resolve(url(path), in: root)
            else {
                Issue.record("« \(path) » n'a pas servi index.html")
                return
            }
            #expect(String(data: data, encoding: .utf8)?.contains("id=\"root\"") == true)
            #expect(mimeType == "text/html")
        }
    }

    @Test("a request for something the bundle doesn't have is missing, not a crash")
    func reportsMissing() throws {
        let root = try makeBundle()
        defer { try? FileManager.default.removeItem(at: root) }

        #expect(WebAppSchemeHandler.resolve(url("/assets/parti.js"), in: root) == .missing(url: url("/assets/parti.js")))
    }

    @Test("a path cannot climb out of the bundle")
    func refusesTraversal() throws {
        // The page is not trusted to stay inside the directory it was
        // served from; an escape here would turn the web view into a
        // reader for the whole disk.
        let root = try makeBundle()
        defer { try? FileManager.default.removeItem(at: root) }

        let secret = root.deletingLastPathComponent().appendingPathComponent("secret-\(UUID().uuidString).txt")
        try "clés".write(to: secret, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: secret) }

        #expect(WebAppSchemeHandler.path(of: url("/../\(secret.lastPathComponent)"), in: root) == nil)
        #expect(WebAppSchemeHandler.path(of: url("/assets/../../\(secret.lastPathComponent)"), in: root) == nil)
        #expect(WebAppSchemeHandler.path(of: url("/etc/passwd"), in: root) != nil)  // inside the bundle, simply absent
    }

    @Test("a sibling directory sharing the bundle's name prefix is still outside it")
    func refusesPrefixSibling() throws {
        // "…/webapp-1" must not be reachable from a bundle at "…/webapp-1x":
        // a prefix test without the trailing separator would let it through.
        let parent = FileManager.default.temporaryDirectory
            .appendingPathComponent("prefix-\(UUID().uuidString)")
        let root = parent.appendingPathComponent("web")
        let sibling = parent.appendingPathComponent("webbis")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: parent) }

        #expect(WebAppSchemeHandler.path(of: url("/../webbis/index.html"), in: root) == nil)
    }

    @Test("scripts, styles and the manifest carry the type WebKit needs")
    func mimeTypes() {
        #expect(WebAppSchemeHandler.mimeType(for: "js") == "text/javascript")
        #expect(WebAppSchemeHandler.mimeType(for: "css") == "text/css")
        #expect(WebAppSchemeHandler.mimeType(for: "html") == "text/html")
        #expect(WebAppSchemeHandler.mimeType(for: "svg") == "image/svg+xml")
        #expect(WebAppSchemeHandler.mimeType(for: "webmanifest") == "application/manifest+json")
        // Case comes from the file on disk, not from us.
        #expect(WebAppSchemeHandler.mimeType(for: "JS") == "text/javascript")
        // Unknown stays a download-ish default rather than being guessed at.
        #expect(WebAppSchemeHandler.mimeType(for: "kli") == "application/octet-stream")
    }

    @Test("the page the shell loads is inside its own origin")
    func indexURLIsWellFormed() {
        #expect(WebAppSchemeHandler.indexURL.scheme == WebAppSchemeHandler.scheme)
        #expect(WebAppSchemeHandler.indexURL.host == WebAppSchemeHandler.host)
        #expect(WebAppSchemeHandler.indexURL.path == "/index.html")
    }
}
