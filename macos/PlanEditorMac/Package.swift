// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PlanEditorMac",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PlanEditorMac", targets: ["PlanEditorMac"])
    ],
    targets: [
        .executableTarget(
            name: "PlanEditorMac",
            resources: [.copy("WebApp")]
        )
    ]
)
