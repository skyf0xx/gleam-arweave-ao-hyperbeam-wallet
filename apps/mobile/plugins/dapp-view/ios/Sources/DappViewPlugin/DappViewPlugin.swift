import Foundation
import Capacitor
import WebKit

/// Bridges `DappWebView` to the wallet WebView. Method names, the `jsName`
/// and the event names are the TypeScript API in `src/definitions.ts`.
@objc(DappViewPlugin)
public class DappViewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DappViewPlugin"
    public let jsName = "DappView"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "goBack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "postMessage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFrame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHidden", returnType: CAPPluginReturnPromise)
    ]

    private var dappView: DappWebView?
    private var hostLoading: NSKeyValueObservation?

    @objc func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("A valid url is required")
            return
        }
        guard let providerScript = call.getString("providerScript") else {
            call.reject("providerScript is required")
            return
        }
        guard let frame = Self.rect(call.getObject("frame")) else {
            call.reject("frame needs x, y, width and height")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let host = self.bridge?.webView else {
                call.reject("The wallet WebView is not available")
                return
            }
            self.closeView()
            let view = DappWebView(
                providerScript: providerScript,
                dataStore: DappWebView.dataStore,
                events: DappWebView.Events(
                    message: { [weak self] in self?.notifyListeners("message", data: $0) },
                    navigation: { [weak self] in self?.notifyListeners("navigation", data: $0) },
                    loadError: { [weak self] in self?.notifyListeners("loadError", data: $0) },
                    presenter: { [weak self] in self?.topViewController() }
                )
            )
            // The wallet WebView is the bridge controller's root view, so the
            // rectangle it measured in CSS pixels is already in its points.
            view.webView.frame = frame
            host.addSubview(view.webView)
            self.dappView = view
            // A reload or crash of the wallet WebView loses the JS that owns
            // this view. Capacitor 8 has no plugin reset hook, but every such
            // reload starts a main-frame load, so that closes the view.
            self.hostLoading = host.observe(\.isLoading, options: [.new]) { [weak self] _, change in
                if change.newValue == true {
                    self?.closeView()
                }
            }
            view.load(url)
            call.resolve()
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.closeView()
            call.resolve()
        }
    }

    @objc func goBack(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            if let webView = self?.dappView?.webView, webView.canGoBack {
                webView.goBack()
            }
            call.resolve()
        }
    }

    @objc func reload(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.dappView?.reload()
            call.resolve()
        }
    }

    @objc func clearData(_ call: CAPPluginCall) {
        // An open page could write its in-memory state straight back.
        DispatchQueue.main.async { [weak self] in
            self?.closeView()
            DappWebView.dataStore.removeData(
                ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
                modifiedSince: .distantPast
            ) {
                call.resolve()
            }
        }
    }

    @objc func postMessage(_ call: CAPPluginCall) {
        guard let data = call.getString("data"), let targetOrigin = call.getString("targetOrigin") else {
            call.reject("data and targetOrigin are required")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let view = self?.dappView else {
                call.resolve(["delivered": false])
                return
            }
            view.deliver(data, targetOrigin: targetOrigin) { delivered in
                call.resolve(["delivered": delivered])
            }
        }
    }

    @objc func setFrame(_ call: CAPPluginCall) {
        guard let frame = Self.rect(call.getObject("frame")) else {
            call.reject("frame needs x, y, width and height")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.dappView?.webView.frame = frame
            call.resolve()
        }
    }

    @objc func setHidden(_ call: CAPPluginCall) {
        guard let hidden = call.getBool("hidden") else {
            call.reject("hidden is required")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.dappView?.webView.isHidden = hidden
            call.resolve()
        }
    }

    private func closeView() {
        hostLoading?.invalidate()
        hostLoading = nil
        dappView?.close()
        dappView = nil
    }

    private func topViewController() -> UIViewController? {
        var top = bridge?.viewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    private static func rect(_ object: JSObject?) -> CGRect? {
        guard let object = object,
              let x = number(object["x"]), let y = number(object["y"]),
              let width = number(object["width"]), let height = number(object["height"]),
              width >= 0, height >= 0 else {
            return nil
        }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private static func number(_ value: Capacitor.JSValue?) -> Double? {
        guard let number = value as? NSNumber else { return nil }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }
}
