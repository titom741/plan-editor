import AppKit
import UniformTypeIdentifiers
import WebKit

/// The document type this app owns. Declared once here and mirrored in the
/// bundle's `Info.plist`, which is what gives the file its icon and makes a
/// double-click open the app.
enum ProjectDocument {
    static let fileExtension = "kli"
    static let identifier = "com.planeditor.project"
    static let displayName = "Projet d'implantation"

    /// What the panels filter on: our own type first, then plain JSON so
    /// the `.kl.json` files written before the rename still open. Both are
    /// resolved by extension rather than by `UTType(exportedAs:)`, which
    /// asserts when the declaration hasn't been registered yet — as it
    /// hasn't when the binary is run straight out of the build directory.
    static var contentTypes: [UTType] {
        [UTType(filenameExtension: fileExtension, conformingTo: .json), .json].compactMap { $0 }
    }
}

/// Bridges the web app's file requests to `NSOpenPanel` and `NSSavePanel`.
///
/// `WKWebView` implements no File System Access, so without this the web
/// build's only way to save inside the app is a download into `~/Downloads`
/// — no folder choice, no overwriting the file you opened. This is the one
/// capability the shell exists to add.
///
/// The channel is `WKScriptMessageHandlerWithReply`: the page awaits the
/// reply, so a cancelled panel is an ordinary resolved value rather than a
/// timeout. Every reply is a dictionary — `cancelled`, `error`, or the
/// path, name and (for an open) the contents.
final class FileBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let channelName = "planEditorFiles"

    /// The window the panels attach to, so they open as sheets rather than
    /// as a free-floating dialog the user can lose behind the app.
    weak var window: NSWindow?

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        handle(message.body, reply: replyHandler)
    }

    /// The routing, separated from `WKScriptMessage` so it can be tested
    /// without a web view. Everything but the panels themselves lives here.
    func handle(_ body: Any?, reply: @escaping (Any?, String?) -> Void) {
        guard let body = body as? [String: Any],
              let action = body["action"] as? String
        else {
            reply(["error": "Requête mal formée."], nil)
            return
        }

        switch action {
        case "saveAs":
            saveAs(body: body, reply: reply)
        case "save":
            save(body: body, reply: reply)
        case "open":
            open(reply: reply)
        default:
            reply(["error": "Action inconnue : \(action)"], nil)
        }
    }

    // MARK: - Actions

    private func saveAs(body: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let contents = body["contents"] as? String else {
            reply(["error": "Contenu absent."], nil)
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = (body["suggestedName"] as? String) ?? "projet.kli"
        panel.allowedContentTypes = ProjectDocument.contentTypes
        // The user asked for this extension; adding it silently behind their
        // back is how a file ends up as "plan.kli.kli".
        panel.allowsOtherFileTypes = true
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false

        present(panel) { response in
            guard response == .OK, let url = panel.url else {
                reply(["cancelled": true], nil)
                return
            }
            reply(Self.write(contents, to: url), nil)
        }
    }

    func save(body: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let contents = body["contents"] as? String,
              let path = body["path"] as? String
        else {
            reply(["error": "Chemin ou contenu absent."], nil)
            return
        }
        reply(Self.write(contents, to: URL(fileURLWithPath: path)), nil)
    }

    private func open(reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = ProjectDocument.contentTypes
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        present(panel) { response in
            guard response == .OK, let url = panel.url else {
                reply(["cancelled": true], nil)
                return
            }
            do {
                let contents = try String(contentsOf: url, encoding: .utf8)
                reply(
                    ["path": url.path, "name": url.lastPathComponent, "contents": contents],
                    nil
                )
            } catch {
                reply(["error": error.localizedDescription], nil)
            }
        }
    }

    // MARK: - Helpers

    /// Writes atomically: a half-written project file is worse than none,
    /// and this is the only copy of the document the user owns.
    static func write(_ contents: String, to url: URL) -> [String: Any] {
        do {
            try contents.write(to: url, atomically: true, encoding: .utf8)
            return ["path": url.path, "name": url.lastPathComponent]
        } catch {
            return ["error": error.localizedDescription]
        }
    }

    /// Runs a panel as a sheet on the app's window when there is one, and
    /// modally otherwise — during startup there may be no window yet.
    private func present(_ panel: NSSavePanel, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(panel.runModal())
        }
    }
}
