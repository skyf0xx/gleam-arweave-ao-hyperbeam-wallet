// swift-tools-version: 5.9
import PackageDescription

// `cap sync ios` adds this package to CapApp-SPM under the name it derives
// from "@gleam/dapp-view", so the package and product are "GleamDappView".
let package = Package(
    name: "GleamDappView",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "GleamDappView",
            targets: ["DappViewPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "DappViewPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/DappViewPlugin")
    ]
)
