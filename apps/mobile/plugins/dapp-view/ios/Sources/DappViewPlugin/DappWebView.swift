import Foundation
import UIKit
import WebKit

/// One dApp page in a `WKWebView` that shares nothing with the wallet
/// WebView: its own configuration, data store and content controller, with
/// the provider as its only user script and one message handler.
final class DappWebView: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    struct Events {
        let message: ([String: Any]) -> Void
        let navigation: ([String: Any]) -> Void
        let loadError: ([String: Any]) -> Void
        let presenter: () -> UIViewController?
    }

    /// Kept for the life of the process, so `clearData` reaches the same
    /// records the open view uses. iOS 17 gives the view a persistent store
    /// of its own; before that the only store apart from the wallet's
    /// `default()` is a non-persistent one, so dApp logins last until the
    /// app quits.
    static let dataStore: WKWebsiteDataStore = {
        if #available(iOS 17.0, *) {
            return WKWebsiteDataStore(forIdentifier: storeIdentifier)
        }
        return WKWebsiteDataStore.nonPersistent()
    }()

    private static let storeIdentifier = UUID(uuidString: "6F1C2A4E-9B3D-4E57-8A21-D4C0B7E95F13")!
    private static let handlerName = "gleamDappView"
    private static let pageEvent = "gleamdappview"

    let webView: WKWebView
    private let events: Events
    private var observations: [NSKeyValueObservation] = []
    private var leavePrompt: UIAlertController?
    /// Set when the user turns down an app link, until the next http(s)
    /// page commits, so a page can't keep asking.
    private var declinedToLeave = false
    /// Set by a web content crash and cleared when a load finishes, so a
    /// page that crashes on every load stops after one retry.
    private var crashedThisLoad = false
    private var closed = false

    init(providerScript: String, dataStore: WKWebsiteDataStore, events: Events) {
        self.events = events
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        configuration.allowsInlineMediaPlayback = true
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: providerScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        configuration.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        // The content controller holds its handler strongly; the proxy keeps
        // that from holding this object and its web view forever.
        controller.add(WeakMessageHandler(self), name: Self.handlerName)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        observations = [
            webView.observe(\.url) { [weak self] _, _ in self?.emitNavigation() },
            webView.observe(\.canGoBack) { [weak self] _, _ in self?.emitNavigation() },
            webView.observe(\.isLoading) { [weak self] _, _ in self?.emitNavigation() }
        ]
    }

    func load(_ url: URL) {
        let scheme = url.scheme?.lowercased()
        guard scheme == "http" || scheme == "https" else {
            events.loadError(["url": url.absoluteString, "message": "Only http and https addresses can be opened."])
            return
        }
        webView.load(URLRequest(url: url))
    }

    func reload() {
        crashedThisLoad = false
        webView.reload()
    }

    func close() {
        closed = true
        leavePrompt?.dismiss(animated: false)
        leavePrompt = nil
        observations.forEach { $0.invalidate() }
        observations = []
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
    }

    /// The origin check runs in the page at delivery, so a reply can't reach
    /// a document that replaced the one it was meant for. `location` is
    /// unforgeable, so a page can't fake that check.
    func deliver(_ data: String, targetOrigin: String, completion: @escaping (Bool) -> Void) {
        webView.callAsyncJavaScript(
            """
            if (window.location.origin !== targetOrigin) return false;
            window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
            return true;
            """,
            arguments: ["data": data, "targetOrigin": targetOrigin, "eventName": Self.pageEvent],
            in: nil,
            in: .page
        ) { result in
            if case .success(let value) = result, (value as? NSNumber)?.boolValue == true {
                completion(true)
            } else {
                completion(false)
            }
        }
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let data = message.body as? String else { return }
        events.message([
            "origin": Self.origin(message.frameInfo.securityOrigin),
            "isMainFrame": message.frameInfo.isMainFrame,
            "data": data
        ])
    }

    static func origin(_ origin: WKSecurityOrigin) -> String {
        guard !origin.protocol.isEmpty, !origin.host.isEmpty else { return "null" }
        let host = origin.host.contains(":") && !origin.host.hasPrefix("[") ? "[\(origin.host)]" : origin.host
        return origin.port == 0 ? "\(origin.protocol)://\(host)" : "\(origin.protocol)://\(host):\(origin.port)"
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.cancel)
            return
        }
        // No target frame means a new window, which loads in the main frame.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        switch scheme {
        case "http", "https":
            decisionHandler(.allow)
        case "about":
            let page = Self.aboutPage(url)
            let allowed = isMainFrame ? page == "blank" : page == "blank" || page == "srcdoc"
            decisionHandler(allowed ? .allow : .cancel)
        case "data", "blob":
            // Documents a page builds for its own frames. A top-level one
            // would show content under an origin the address bar can't name.
            decisionHandler(isMainFrame ? .cancel : .allow)
        case "file", "javascript":
            decisionHandler(.cancel)
        default:
            decisionHandler(.cancel)
            // A frame can't send the user to another app; only the page can.
            if isMainFrame {
                askToOpenElsewhere(url)
            }
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        let scheme = webView.url?.scheme?.lowercased()
        if scheme == "http" || scheme == "https" {
            declinedToLeave = false
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        crashedThisLoad = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        reportLoadError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        reportLoadError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if crashedThisLoad {
            events.loadError(["url": webView.url?.absoluteString ?? "", "message": "The page stopped working."])
            return
        }
        crashedThisLoad = true
        webView.reload()
    }

    // MARK: WKUIDelegate

    /// No second view: `target=_blank` links and `window.open` load in this
    /// one, and the opener gets no window back.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let scheme = navigationAction.request.url?.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            webView.load(navigationAction.request)
        }
        return nil
    }

    // MARK: Private

    private func emitNavigation() {
        guard let url = webView.url else { return }
        events.navigation([
            "url": url.absoluteString,
            "canGoBack": webView.canGoBack,
            "loading": webView.isLoading
        ])
    }

    private func reportLoadError(_ error: Error) {
        let nsError = error as NSError
        // A navigation the page or this view replaced or cancelled, and
        // WebKit's "frame load interrupted" after a cancelled policy decision.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == WKErrorDomain && nsError.code == 102 { return }
        let failingURL = (nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String)
            ?? webView.url?.absoluteString
            ?? ""
        events.loadError(["url": failingURL, "message": nsError.localizedDescription])
    }

    /// "about:blank#x" and "about:srcdoc?y" name the same pages.
    private static func aboutPage(_ url: URL) -> String {
        let rest = url.absoluteString.dropFirst("about:".count)
        return String(rest.prefix { $0 != "?" && $0 != "#" }).lowercased()
    }

    /// One prompt at a time, and none after a Cancel until another page loads.
    private func askToOpenElsewhere(_ url: URL) {
        guard !closed, leavePrompt == nil, !declinedToLeave, let presenter = events.presenter() else { return }
        let site = webView.url?.host ?? "This page"
        let link = url.absoluteString
        let shown = link.count > 120 ? String(link.prefix(119)) + "…" : link
        let alert = UIAlertController(
            title: "Open another app?",
            message: "\(site) wants to open this link outside Gleam:\n\n\(shown)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.leavePrompt = nil
            self?.declinedToLeave = true
        })
        alert.addAction(UIAlertAction(title: "Open", style: .default) { [weak self] _ in
            guard let self = self, !self.closed else { return }
            self.leavePrompt = nil
            UIApplication.shared.open(url)
        })
        leavePrompt = alert
        presenter.present(alert, animated: true)
    }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
