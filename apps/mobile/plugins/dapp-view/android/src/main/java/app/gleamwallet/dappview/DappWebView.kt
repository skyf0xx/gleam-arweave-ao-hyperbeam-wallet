package app.gleamwallet.dappview

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.ValueCallback
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.ProfileStore
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.net.URISyntaxException

/**
 * One dApp page in a `WebView` that shares nothing with the wallet WebView:
 * its own profile (cookies, storage, cache), the provider as its only
 * injected script and one message listener. No `addJavascriptInterface`: it
 * reaches every frame and says nothing about which frame called it.
 *
 * The plugin creates one only after [isSupported], and [clearData] checks
 * MULTI_PROFILE itself, which lint can't follow across the two.
 */
@SuppressLint("RequiresFeature", "SetJavaScriptEnabled")
internal class DappWebView(
    private val activity: AppCompatActivity,
    private val container: ViewGroup,
    private var layout: FrameLayout.LayoutParams,
    private val providerScript: String,
    private val events: Events,
    /** Starts the system picker; its result comes back through [fileChooserResult]. */
    private val launchPicker: (Intent) -> Unit,
) {
    class Events(
        val message: (JSObject) -> Unit,
        val navigation: (JSObject) -> Unit,
        val loadError: (JSObject) -> Unit,
    )

    /** Null after a second renderer crash, until `reload` makes a new one. */
    private var webView: WebView? = null
    /** Catches the URL of a `target=_blank` link or `window.open`. */
    private var popup: WebView? = null
    private var hidden = false
    private var closed = false
    private var loading = false
    /** The main frame's URL, loaded again into the view a crash replaces. */
    private var lastUrl: String? = null
    private var lastNavigation: String? = null
    private var leavePrompt: AlertDialog? = null
    /**
     * Set when the user turns down an app link, until the next http(s) page
     * commits, so a page can't keep asking.
     */
    private var declinedToLeave = false
    /**
     * Set by a renderer crash and cleared when a load finishes, so a page
     * that crashes on every load stops after one retry.
     */
    private var crashedThisLoad = false
    private val deliveries = mutableListOf<Delivery>()
    private var fileChooser: ValueCallback<Array<Uri>>? = null

    init {
        webView = create()
    }

    fun load(url: String) {
        if (!isWeb(Uri.parse(url))) {
            events.loadError(JSObject().put("url", url).put("message", "Only http and https addresses can be opened."))
            return
        }
        lastUrl = url
        webView?.loadUrl(url)
    }

    fun goBack() {
        webView?.let { if (it.canGoBack()) it.goBack() }
    }

    fun reload() {
        if (closed) return
        crashedThisLoad = false
        val view = webView
        if (view != null) {
            view.reload()
            return
        }
        val fresh = create()
        webView = fresh
        lastUrl?.let { fresh.loadUrl(it) }
    }

    fun setLayout(params: FrameLayout.LayoutParams) {
        layout = params
        webView?.layoutParams = params
    }

    fun onPause() {
        webView?.onPause()
    }

    fun onResume() {
        webView?.onResume()
    }

    fun setHidden(hidden: Boolean) {
        this.hidden = hidden
        webView?.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
    }

    fun close() {
        closed = true
        leavePrompt?.dismiss()
        leavePrompt = null
        popup?.let { destroyLater(it) }
        popup = null
        webView?.let { destroy(it) }
        webView = null
        finishDeliveries()
        endFileChooser(null)
    }

    /**
     * `evaluateJavascript` runs in the main frame only, and the origin check
     * runs in the page at delivery, so a reply can't reach a document that
     * replaced the one it was meant for. `location` is unforgeable, so a page
     * can't fake that check. `JavaScriptReplyProxy` isn't used: it answers
     * whichever frame last posted, and checks nothing at delivery.
     */
    fun deliver(data: String, targetOrigin: String, completion: (Boolean) -> Unit) {
        val view = webView
        if (view == null || closed) {
            completion(false)
            return
        }
        val delivery = Delivery(completion)
        deliveries.add(delivery)
        val script = "(function (data, targetOrigin, eventName) {" +
            "if (window.location.origin !== targetOrigin) return false;" +
            "window.dispatchEvent(new CustomEvent(eventName, { detail: data }));" +
            "return true;" +
            "})(${jsString(data)}, ${jsString(targetOrigin)}, ${jsString(PAGE_EVENT)})"
        view.evaluateJavascript(script) { result -> delivery.finish(result == "true") }
    }

    /** A destroyed view never answers its pending `evaluateJavascript` calls. */
    private fun finishDeliveries() {
        deliveries.toList().forEach { it.finish(false) }
    }

    private inner class Delivery(private val completion: (Boolean) -> Unit) {
        private var done = false

        fun finish(delivered: Boolean) {
            if (done) return
            done = true
            deliveries.remove(this)
            completion(delivered)
        }
    }

    /** WebView needs its callback answered exactly once, even with nothing chosen. */
    private fun endFileChooser(files: Array<Uri>?) {
        val callback = fileChooser ?: return
        fileChooser = null
        callback.onReceiveValue(files)
    }

    fun fileChooserResult(resultCode: Int, data: Intent?) {
        endFileChooser(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
    }

    private fun create(): WebView {
        val view = WebView(activity)
        // Has to come before anything else touches the view.
        WebViewCompat.setProfile(view, PROFILE)
        configure(view.settings)
        // The document-start script runs in every frame the origin rules
        // match, and there is no main-frame-only option, so the wrapper skips
        // subframes. `window` and `window.top` are unforgeable, and nothing
        // from the page has run yet.
        WebViewCompat.addDocumentStartJavaScript(view, "if (window === window.top) {\n$providerScript\n}\n", ALL_ORIGINS)
        // Every frame gets the channel; the transport decides what to accept
        // from the origin and frame passed on with each message.
        WebViewCompat.addWebMessageListener(view, HANDLER_NAME, ALL_ORIGINS) { source, message, sourceOrigin, isMainFrame, _ ->
            if (closed || source !== webView) return@addWebMessageListener
            if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            events.message(
                JSObject()
                    .put("origin", origin(sourceOrigin))
                    .put("isMainFrame", isMainFrame)
                    .put("data", data),
            )
        }
        view.webViewClient = Client()
        view.webChromeClient = ChromeClient()
        view.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
        container.addView(view, layout)
        return view
    }

    private fun destroy(view: WebView) {
        container.removeView(view)
        view.stopLoading()
        view.webViewClient = WebViewClient()
        view.webChromeClient = null
        view.destroy()
    }

    /** For a view whose own callback is running, which mustn't destroy it. */
    private fun destroyLater(view: WebView) {
        view.stopLoading()
        Handler(Looper.getMainLooper()).post { view.destroy() }
    }

    private fun emitNavigation() {
        val view = webView ?: return
        val url = view.url ?: return
        val canGoBack = view.canGoBack()
        val key = "$url\n$canGoBack\n$loading"
        if (key == lastNavigation) return
        lastNavigation = key
        events.navigation(JSObject().put("url", url).put("canGoBack", canGoBack).put("loading", loading))
    }

    /**
     * WebView doesn't ask for every navigation (POST requests, a subframe's
     * first load), so this isn't the only guard: `allowFileAccess` and
     * `allowContentAccess` block file: and content:, and WebView itself
     * refuses top-level data: and javascript: navigations from a page.
     */
    private fun allowNavigation(url: Uri, isMainFrame: Boolean): Boolean {
        return when (url.scheme?.lowercase()) {
            null -> false
            "http", "https" -> true
            "about" -> {
                val page = aboutPage(url.toString())
                if (isMainFrame) page == "blank" else page == "blank" || page == "srcdoc"
            }
            // Documents a page builds for its own frames. A top-level one
            // would show content under an origin the address bar can't name.
            "data", "blob" -> !isMainFrame
            "file", "javascript", "content" -> false
            else -> {
                // A frame can't send the user to another app; only the page can.
                if (isMainFrame) askToOpenElsewhere(url.toString())
                false
            }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (view !== webView) return true
            return !allowNavigation(request.url, request.isForMainFrame)
        }

        // Called when a main-frame navigation commits.
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (view !== webView) return
            loading = true
            if (url != null) {
                lastUrl = url
                if (isWeb(Uri.parse(url))) declinedToLeave = false
            }
            emitNavigation()
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (view !== webView) return
            loading = false
            crashedThisLoad = false
            emitNavigation()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            if (view !== webView) return
            if (url != null) lastUrl = url
            emitNavigation()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (view !== webView || !request.isForMainFrame) return
            val description = error.description?.toString() ?: ""
            // A navigation the page or this view replaced or cancelled.
            if (description.contains("ERR_ABORTED")) return
            events.loadError(
                JSObject()
                    .put("url", request.url.toString())
                    .put("message", loadErrorMessage(error.errorCode, description)),
            )
        }

        // onReceivedSslError is left to WebViewClient, which cancels the
        // load; the failure then arrives in onReceivedError.

        /**
         * Returning true keeps the app alive, and the crashed view can't be
         * used again, so a new one takes its place.
         */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view !== webView) {
                if (view === popup) popup = null
                return true
            }
            destroy(view)
            webView = null
            finishDeliveries()
            endFileChooser(null)
            if (closed) return true
            if (crashedThisLoad) {
                events.loadError(JSObject().put("url", lastUrl ?: "").put("message", "The page stopped working."))
                return true
            }
            crashedThisLoad = true
            val fresh = create()
            webView = fresh
            lastUrl?.let { fresh.loadUrl(it) }
            return true
        }
    }

    /**
     * No second view: `target=_blank` links and `window.open` load in this
     * one, and the opener gets a window that closes at once. WebView only
     * reports the new window's URL to a WebView it navigates, so a throwaway
     * one in the same profile, with JavaScript off, catches it and is
     * destroyed before anything loads.
     */
    private inner class ChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            if (closed || view !== webView) {
                filePathCallback.onReceiveValue(null)
                return true
            }
            endFileChooser(null)
            fileChooser = filePathCallback
            try {
                launchPicker(params.createIntent())
            } catch (_: ActivityNotFoundException) {
                endFileChooser(null)
            } catch (_: SecurityException) {
                endFileChooser(null)
            }
            return true
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (closed || view !== webView) return false
            val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
            popup?.let { destroyLater(it) }
            val catcher = WebView(activity)
            WebViewCompat.setProfile(catcher, PROFILE)
            catcher.settings.javaScriptEnabled = false
            catcher.settings.allowFileAccess = false
            catcher.settings.allowContentAccess = false
            catcher.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    takePopup(view, request.url)
                    return true
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                    takePopup(view, url?.let { Uri.parse(it) })
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    if (view === popup) popup = null
                    view.destroy()
                    return true
                }
            }
            popup = catcher
            transport.webView = catcher
            resultMsg.sendToTarget()
            return true
        }
    }

    private fun takePopup(catcher: WebView, url: Uri?) {
        if (catcher !== popup) return
        popup = null
        destroyLater(catcher)
        if (closed || url == null || !isWeb(url)) return
        webView?.loadUrl(url.toString())
    }

    /** One prompt at a time, and none after a Cancel until another page loads. */
    private fun askToOpenElsewhere(url: String) {
        if (closed || leavePrompt != null || declinedToLeave || activity.isFinishing) return
        val intent = externalIntent(url) ?: return
        // For an intent: link, show what will launch rather than the raw link.
        val link = intent.dataString ?: url
        val target = intent.`package`?.let { "$link\n($it)" } ?: link
        val site = webView?.url?.let { Uri.parse(it).host } ?: "This page"
        val shown = if (target.length > 120) target.take(119) + "…" else target
        val dialog = AlertDialog.Builder(activity)
            .setTitle("Open another app?")
            .setMessage("$site wants to open this link outside Gleam:\n\n$shown")
            .setNegativeButton("Cancel") { _, _ -> declinedToLeave = true }
            .setPositiveButton("Open") { _, _ ->
                if (closed) return@setPositiveButton
                try {
                    activity.startActivity(intent)
                } catch (_: ActivityNotFoundException) {
                    // No app handles the link.
                } catch (_: SecurityException) {
                    // The app that would handle it doesn't export that activity.
                }
            }
            .setOnCancelListener { declinedToLeave = true }
            .setOnDismissListener { leavePrompt = null }
            .create()
        leavePrompt = dialog
        dialog.show()
    }

    companion object {
        private const val PROFILE = "gleam-dapp"
        private const val HANDLER_NAME = "gleamDappView"
        private const val PAGE_EVENT = "gleamdappview"
        private val ALL_ORIGINS = setOf("*")

        const val UNSUPPORTED_MESSAGE =
            "The dApp browser needs a newer Android System WebView. Update it from the Play Store."

        /**
         * Without a profile of its own the view would share cookies and
         * storage with the wallet WebView, and `clearData` would wipe the
         * wallet's, so the view doesn't open at all.
         */
        fun isSupported(): Boolean =
            WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) &&
                WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) &&
                WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

        /** Clears only the dApp profile; the wallet WebView's is untouched. */
        fun clearData(activity: AppCompatActivity, done: () -> Unit) {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                // No view ever opened, so there is nothing to clear.
                done()
                return
            }
            val profile = ProfileStore.getInstance().getOrCreateProfile(PROFILE)
            profile.webStorage.deleteAllData()
            // The HTTP cache belongs to the profile but is reached only
            // through a WebView in it.
            val sweeper = WebView(activity)
            WebViewCompat.setProfile(sweeper, PROFILE)
            sweeper.clearCache(true)
            sweeper.destroy()
            val cookies = profile.cookieManager
            cookies.removeAllCookies {
                cookies.flush()
                done()
            }
        }

        /** The same string as the frame's `location.origin`. */
        fun origin(source: Uri): String {
            val scheme = source.scheme
            val text = source.toString().trimEnd('/')
            if (scheme.isNullOrEmpty() || source.host.isNullOrEmpty() || !text.startsWith("$scheme://")) return "null"
            return text
        }

        private fun isWeb(url: Uri): Boolean {
            val scheme = url.scheme?.lowercase()
            return scheme == "http" || scheme == "https"
        }

        /** "about:blank#x" and "about:srcdoc?y" name the same pages. */
        private fun aboutPage(url: String): String =
            url.substring("about:".length).takeWhile { it != '?' && it != '#' }.lowercase()

        /**
         * JSON is valid JavaScript, and the two line separators are escaped
         * too for engines that predate ES2019.
         */
        private fun jsString(value: String): String =
            JSONObject.quote(value).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

        /**
         * A view intent another app can claim only through a browsable
         * filter, the same reach any link in a browser has. For `intent:`
         * links only the data URI and package are kept: the page's component,
         * selector, action, flags (which could grant access to the app's own
         * content) and extras are all dropped.
         */
        private fun externalIntent(url: String): Intent? {
            val uri = Uri.parse(url)
            val target = if (uri.scheme.equals("intent", ignoreCase = true)) {
                val parsed = try {
                    Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                } catch (_: URISyntaxException) {
                    return null
                }
                val data = parsed.data ?: return null
                when (data.scheme?.lowercase()) {
                    null, "intent", "file", "content", "javascript", "data", "blob", "about" -> return null
                }
                Intent(Intent.ACTION_VIEW, data).setPackage(parsed.`package`)
            } else {
                Intent(Intent.ACTION_VIEW, uri)
            }
            target.addCategory(Intent.CATEGORY_BROWSABLE)
            target.component = null
            target.selector = null
            target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return target
        }

        private fun loadErrorMessage(code: Int, description: String): String = when (code) {
            WebViewClient.ERROR_HOST_LOOKUP -> "The site's address couldn't be found."
            WebViewClient.ERROR_CONNECT, WebViewClient.ERROR_TIMEOUT, WebViewClient.ERROR_IO ->
                "The site couldn't be reached."
            WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> "A secure connection to the site couldn't be made."
            WebViewClient.ERROR_UNSAFE_RESOURCE -> "Safe Browsing flagged this site as unsafe."
            else -> if (description.isEmpty()) "The page couldn't be loaded." else "The page couldn't be loaded ($description)."
        }

        private fun configure(settings: WebSettings) {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            // So target=_blank and window.open reach onCreateWindow instead
            // of navigating whichever frame asked; popups still need a tap.
            settings.setSupportMultipleWindows(true)
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.safeBrowsingEnabled = true
            settings.setGeolocationEnabled(false)
            // Remote debugging is process-wide, so it follows Capacitor's
            // setting for the wallet WebView (on only in debug builds).
        }
    }
}
