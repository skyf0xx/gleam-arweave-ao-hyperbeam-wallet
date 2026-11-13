// swift-tools-version: 5.9
import PackageDescription

// `cap sync ios` adds this package to CapApp-SPM under the name it derives
// from "@gleam/cloud-backup", so the package and product are "GleamCloudBackup".
let package = Package(
    name: "GleamCloudBackup",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "GleamCloudBackup",
            targets: ["ICloudFilePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "ICloudFilePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/ICloudFilePlugin")
    ]
)
