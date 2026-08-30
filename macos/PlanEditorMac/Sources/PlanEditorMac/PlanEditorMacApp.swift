import AppKit
import SwiftUI
import WebKit

/// The macOS shell around the web build.
///
/// The web app stays the single functional source: this adds the two
/// things a browser tab cannot give it — real save/open panels through
/// `FileBridge`, and documents that open by double-click.
@main
struct PlanEditorMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup(ProjectDocument.displayName) {
            PlanEditorWebView()
                .frame(minWidth: 1024, minHeight: 700)
        }
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("À propos de Plan Editor") {
                    NSApplication.shared.orderFrontStandardAboutPanel()
                }
            }
            // The web app binds ⌘O, ⌘S and ⇧⌘S itself, and its handlers
            // now route through the bridge. Menu items carrying the same
            // shortcuts would shadow them and do less.
            CommandGroup(replacing: .newItem) {}
        }
    }
}

/// Holds the one web view, so a file opened from the Finder can be pushed
/// into a page that is already running.
final class WebViewRegistry {
    static let shared = WebViewRegistry()
    weak var webView: WKWebView?
    /// A document double-clicked before the page finished loading.
    var pendingFileURL: URL?
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first else { return }
        guard let webView = WebViewRegistry.shared.webView else {
            // Launched *by* the double-click: the page isn't there yet, so
            // hand it over once it reports itself ready.
            WebViewRegistry.shared.pendingFileURL = url
            return
        }
        Self.deliver(url, to: webView)
    }

    static func deliver(_ url: URL, to webView: WKWebView) {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return }
        let payload: [String: Any] = [
            "path": url.path,
            "name": url.lastPathComponent,
            "contents": contents,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return }
        // JSON is a subset of JavaScript literals, so the payload can be
        // handed over as an expression — no string escaping to get wrong.
        webView.evaluateJavaScript("window.planEditorOpenFile?.(\(json))")
    }
}

struct PlanEditorWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let bridge = FileBridge()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: FileBridge.channelName
        )
        // The web build is served over a scheme of our own, not from
        // `file://` — see WebAppScheme.swift for the two reasons.
        configuration.setURLSchemeHandler(
            WebAppSchemeHandler(),
            forURLScheme: WebAppSchemeHandler.scheme
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        context.coordinator.bridge = bridge
        WebViewRegistry.shared.webView = webView

        webView.load(URLRequest(url: WebAppSchemeHandler.indexURL))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // The panels are sheets on the app's window; it only exists once
        // the view has been placed in one.
        context.coordinator.bridge?.window = webView.window
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var bridge: FileBridge?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            reportIfBlank(webView)
            guard let pending = WebViewRegistry.shared.pendingFileURL else { return }
            WebViewRegistry.shared.pendingFileURL = nil
            AppDelegate.deliver(pending, to: webView)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            WebAppSchemeHandler.log.error(
                "La page n'a pas pu être chargée : \(error.localizedDescription, privacy: .public)"
            )
        }

        /// A page whose scripts failed still "finishes" loading — that is
        /// exactly how a blank window shipped once. Nothing can be shown to
        /// the user from here, but leaving a line in Console.app means the
        /// next occurrence is diagnosable instead of silent.
        private func reportIfBlank(_ webView: WKWebView) {
            webView.evaluateJavaScript("document.getElementById('root')?.childElementCount ?? -1") { result, _ in
                guard let count = result as? Int, count <= 0 else { return }
                WebAppSchemeHandler.log.error(
                    "La page est chargée mais vide (racine React à \(count, privacy: .public)) : le bundle web n'a pas dû s'exécuter."
                )
            }
        }
    }
}
