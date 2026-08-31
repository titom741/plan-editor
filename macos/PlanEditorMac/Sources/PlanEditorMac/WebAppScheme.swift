import Foundation
import WebKit
import os

/// Serves the bundled web build to the web view over `planeditor://app/`.
///
/// The obvious route — `loadFileURL` on `index.html` — is the one that
/// does not work, and it shipped blank because nothing checked.
///
/// The asset paths were half of it: Vite emitted root-absolute ones
/// (`/assets/index-….js`), which under `file://` resolve to the
/// *filesystem* root, so the application's only script never loaded and
/// the page rendered an empty `<div id="root">`. KL-037 made the web build
/// relative for deployment reasons of its own, which happens to fix that
/// half — but not the half that matters here.
///
/// **A `file://` page has an opaque origin**, and WebKit gives it no
/// `localStorage` and no IndexedDB. Autosave, the material catalogue, the
/// saved components, the shortcuts and the rail widths all live in one or
/// the other — so a page that now renders would still forget everything,
/// which is a worse bug than a blank window because it looks like it works.
///
/// A custom scheme is a real origin, so storage behaves as it does in a
/// browser, and the web build is left untouched — the same bytes are
/// deployed to both hosts, which is the point.
///
/// Serving over `http://localhost` would also work and was not chosen: it
/// opens a listening socket, and "no backend, no network dependency" is a
/// property of this app worth keeping literally true.
final class WebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "planeditor"
    static let host = "app"

    /// The page the shell loads at startup.
    static var indexURL: URL { URL(string: "\(scheme)://\(host)/index.html")! }

    static let log = Logger(subsystem: "com.planeditor.app", category: "webapp")

    /// The directory `scripts/build-macos.sh` copies `dist/` into.
    let root: URL

    /// Tasks WebKit has stopped. Calling back into one of those is a crash,
    /// not an error, so a cancelled task has to be remembered rather than
    /// discovered.
    private var stopped = Set<ObjectIdentifier>()

    init(root: URL) {
        self.root = root
    }

    convenience override init() {
        // `.copy("WebApp")` puts the directory in the resource bundle whole.
        let bundled = Bundle.module.resourceURL?.appendingPathComponent("WebApp")
        self.init(root: bundled ?? URL(fileURLWithPath: "."))
    }

    // MARK: - WKURLSchemeHandler

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let response = Self.response(for: task.request.url, in: root)
        guard !stopped.contains(ObjectIdentifier(task)) else { return }

        switch response {
        case let .found(url, data, mimeType):
            task.didReceive(Self.httpResponse(url: url, mimeType: mimeType, length: data.count, status: 200))
            task.didReceive(data)
            task.didFinish()
        case let .missing(url):
            // A 404 rather than an error: WebKit reports a failed subresource
            // in the console, where it can be read, instead of failing the
            // whole navigation.
            Self.log.error("Ressource absente du bundle : \(url.path, privacy: .public)")
            task.didReceive(Self.httpResponse(url: url, mimeType: "text/plain", length: 0, status: 404))
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    // MARK: - Routing, testable without a web view

    enum Resolution: Equatable {
        case found(url: URL, data: Data, mimeType: String)
        case missing(url: URL)
    }

    /// Maps a request onto a file inside `root`, or reports it missing.
    ///
    /// Read synchronously and on the calling thread: the largest asset is a
    /// few hundred kilobytes coming off the local disk, and doing it inline
    /// removes every race between a read finishing and WebKit stopping the
    /// task.
    static func resolve(_ url: URL, in root: URL) -> Resolution {
        guard let path = self.path(of: url, in: root) else { return .missing(url: url) }
        guard let data = try? Data(contentsOf: path) else { return .missing(url: url) }
        return .found(url: url, data: data, mimeType: mimeType(for: path.pathExtension))
    }

    private static func response(for url: URL?, in root: URL) -> Resolution {
        guard let url else {
            return .missing(url: URL(string: "\(scheme)://\(host)/")!)
        }
        return resolve(url, in: root)
    }

    /// The file a request names, or `nil` when it names something outside
    /// the bundle. `..` is the reason this is not string concatenation: a
    /// page is not trusted to stay inside the directory it was served from.
    static func path(of url: URL, in root: URL) -> URL? {
        var relative = url.path
        if relative.isEmpty || relative == "/" { relative = "/index.html" }

        let resolvedRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let candidate = resolvedRoot
            .appendingPathComponent(String(relative.dropFirst()))
            .standardizedFileURL
            .resolvingSymlinksInPath()

        let rootPath = resolvedRoot.path.hasSuffix("/") ? resolvedRoot.path : resolvedRoot.path + "/"
        guard candidate.path.hasPrefix(rootPath) else { return nil }
        return candidate
    }

    /// WebKit refuses to execute a script served as `text/plain`, so this
    /// table is load-bearing rather than cosmetic.
    static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "svg": return "image/svg+xml"
        case "json": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "map": return "application/json"
        default: return "application/octet-stream"
        }
    }

    private static func httpResponse(url: URL, mimeType: String, length: Int, status: Int) -> URLResponse {
        HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mimeType,
                "Content-Length": String(length),
                // The bundle is rebuilt whole; a stale asset held across a
                // reinstall would pair a new index with an old chunk.
                "Cache-Control": "no-store",
            ]
        ) ?? URLResponse(url: url, mimeType: mimeType, expectedContentLength: length, textEncodingName: nil)
    }
}
