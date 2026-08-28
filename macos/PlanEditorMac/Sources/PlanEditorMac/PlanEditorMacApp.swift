import SwiftUI
import WebKit

@main
struct PlanEditorMacApp: App {
    var body: some Scene {
        WindowGroup("Plan Editor") {
            PlanEditorWebView()
                .frame(minWidth: 1024, minHeight: 700)
        }
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("À propos de Plan Editor") {
                    NSApplication.shared.orderFrontStandardAboutPanel()
                }
            }
        }
    }
}

struct PlanEditorWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")

        if let indexURL = Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "WebApp") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        }
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
