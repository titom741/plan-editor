import Testing
import Foundation
@testable import PlanEditorMac

/// Covers everything in the bridge except the panels themselves, which
/// need a user in front of them. What is left is the part that can be
/// wrong silently: request routing, the reply shapes the web side parses,
/// and the write.
///
/// The suite is `@MainActor` because `FileBridge` is a
/// `WKScriptMessageHandlerWithReply`, which WebKit isolates there.
@MainActor
@Suite("FileBridge")
struct FileBridgeTests {
    /// Runs one request and returns the reply dictionary.
    private func reply(to body: Any?) async -> [String: Any] {
        await withCheckedContinuation { continuation in
            FileBridge().handle(body) { result, _ in
                continuation.resume(returning: result as? [String: Any] ?? [:])
            }
        }
    }

    @Test("a request that isn't a dictionary is refused, not crashed on")
    func malformedRequest() async {
        #expect(await reply(to: "saveAs")["error"] != nil)
        #expect(await reply(to: nil)["error"] != nil)
        #expect(await reply(to: ["nothing": "useful"])["error"] != nil)
    }

    @Test("an unknown action names itself in the error")
    func unknownAction() async {
        let error = await reply(to: ["action": "launchMissiles"])["error"] as? String
        #expect(error?.contains("launchMissiles") == true)
    }

    @Test("a save with no path or no contents is refused before touching the disk")
    func incompleteSave() async {
        #expect(await reply(to: ["action": "save", "path": "/tmp/x.kli"])["error"] != nil)
        #expect(await reply(to: ["action": "save", "contents": "{}"])["error"] != nil)
    }

    @Test("a save writes the file and answers with its path and name")
    func saveWritesTheFile() async throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bridge-\(UUID().uuidString).kli")
        defer { try? FileManager.default.removeItem(at: url) }

        let answer = await reply(to: [
            "action": "save",
            "path": url.path,
            "contents": #"{"schemaVersion":2}"#,
        ])

        #expect(answer["path"] as? String == url.path)
        #expect(answer["name"] as? String == url.lastPathComponent)
        #expect(answer["error"] == nil)
        #expect(try String(contentsOf: url, encoding: .utf8) == #"{"schemaVersion":2}"#)
    }

    @Test("a save that cannot be written reports why instead of failing silently")
    func saveReportsFailure() async {
        // A project file is the only copy the user owns; a write that goes
        // nowhere must never look like a success.
        let answer = await reply(to: [
            "action": "save",
            "path": "/nowhere-that-exists/plan.kli",
            "contents": "{}",
        ])
        #expect(answer["error"] is String)
        #expect(answer["path"] == nil)
    }

    @Test("writing replaces the previous contents rather than appending")
    func writeReplaces() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bridge-\(UUID().uuidString).kli")
        defer { try? FileManager.default.removeItem(at: url) }

        _ = FileBridge.write("premier contenu, plus long", to: url)
        _ = FileBridge.write("court", to: url)
        #expect(try String(contentsOf: url, encoding: .utf8) == "court")
    }

    @Test("accented and non-ASCII content survives the round trip")
    func writesUtf8() throws {
        // Project names are French and routinely accented; a bridge that
        // mangled the encoding would corrupt every file it wrote.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bridge-\(UUID().uuidString).kli")
        defer { try? FileManager.default.removeItem(at: url) }

        let contents = #"{"name":"Aérodrome — Fête à Noël ⛺"}"#
        _ = FileBridge.write(contents, to: url)
        #expect(try String(contentsOf: url, encoding: .utf8) == contents)
    }

    @Test("the document type is offered to the panels, JSON included")
    func contentTypes() {
        let types = ProjectDocument.contentTypes
        // Plain JSON has to be in the list or the .kl.json files written
        // before the rename could not be opened at all.
        #expect(types.contains { $0.identifier == "public.json" })
        #expect(types.contains { $0.preferredFilenameExtension == "kli" })
    }
}
