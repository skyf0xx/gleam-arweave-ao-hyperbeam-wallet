package app.gleamwallet.dappview

import android.content.ActivityNotFoundException
import android.content.Intent
import android.view.Gravity
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.WebViewListener
import com.getcapacitor.annotation.CapacitorPlugin
import kotlin.math.roundToInt

/**
 * Bridges [DappWebView] to the wallet WebView. The plugin name, method names
 * and event names are the TypeScript API in `src/definitions.ts`.
 */
@CapacitorPlugin(name = "DappView")
class DappViewPlugin : Plugin() {
    private var dappView: DappWebView? = null

    /**
     * A file input has no PluginCall, so this can't use `startActivityForResult`
     * with `@ActivityCallback`. Registered in `load`, before the activity
     * starts, as the Activity Result API requires.
     */
    private var filePicker: ActivityResultLauncher<Intent>? = null

    override fun load() {
        filePicker = bridge.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            dappView?.fileChooserResult(it.resultCode, it.data)
        }
        // A reload or crash of the wallet WebView loses the JS that owns the
        // dApp view, so either closes it. The listener stays registered for
        // the plugin's life: the bridge iterates its listener list while
        // calling them, so removing one from inside a callback would throw.
        bridge.addWebViewListener(object : WebViewListener() {
            override fun onPageStarted(webView: WebView) {
                closeView()
            }

            override fun onRenderProcessGone(webView: WebView, detail: RenderProcessGoneDetail): Boolean {
                closeView()
                return false
            }
        })
    }

    override fun handleOnPause() {
        dappView?.onPause()
    }

    override fun handleOnResume() {
        dappView?.onResume()
    }

    override fun handleOnDestroy() {
        closeView()
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrEmpty()) {
            call.reject("A valid url is required")
            return
        }
        val providerScript = call.getString("providerScript")
        if (providerScript == null) {
            call.reject("providerScript is required")
            return
        }
        val frame = rect(call.getObject("frame"))
        if (frame == null) {
            call.reject("frame needs x, y, width and height")
            return
        }
        bridge.executeOnMainThread {
            closeView()
            if (!DappWebView.isSupported()) {
                notifyListeners("loadError", JSObject().put("url", url).put("message", DappWebView.UNSUPPORTED_MESSAGE))
                call.resolve()
                return@executeOnMainThread
            }
            val container = activity.findViewById<FrameLayout>(android.R.id.content)
            val view = DappWebView(
                activity,
                container,
                layoutFor(frame),
                providerScript,
                DappWebView.Events(
                    message = { notifyListeners("message", it) },
                    navigation = { notifyListeners("navigation", it) },
                    loadError = { notifyListeners("loadError", it) },
                ),
                launchPicker = { filePicker?.launch(it) ?: throw ActivityNotFoundException() },
            )
            dappView = view
            view.load(url)
            call.resolve()
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        bridge.executeOnMainThread {
            closeView()
            call.resolve()
        }
    }

    @PluginMethod
    fun goBack(call: PluginCall) {
        bridge.executeOnMainThread {
            dappView?.goBack()
            call.resolve()
        }
    }

    @PluginMethod
    fun reload(call: PluginCall) {
        bridge.executeOnMainThread {
            dappView?.reload()
            call.resolve()
        }
    }

    @PluginMethod
    fun clearData(call: PluginCall) {
        // An open page could write its in-memory state straight back.
        bridge.executeOnMainThread {
            closeView()
            DappWebView.clearData(activity) { call.resolve() }
        }
    }

    @PluginMethod
    fun postMessage(call: PluginCall) {
        val data = call.getString("data")
        val targetOrigin = call.getString("targetOrigin")
        if (data == null || targetOrigin == null) {
            call.reject("data and targetOrigin are required")
            return
        }
        bridge.executeOnMainThread {
            val view = dappView
            if (view == null) {
                call.resolve(JSObject().put("delivered", false))
                return@executeOnMainThread
            }
            view.deliver(data, targetOrigin) { delivered ->
                call.resolve(JSObject().put("delivered", delivered))
            }
        }
    }

    @PluginMethod
    fun setFrame(call: PluginCall) {
        val frame = rect(call.getObject("frame"))
        if (frame == null) {
            call.reject("frame needs x, y, width and height")
            return
        }
        bridge.executeOnMainThread {
            dappView?.setLayout(layoutFor(frame))
            call.resolve()
        }
    }

    @PluginMethod
    fun setHidden(call: PluginCall) {
        val hidden = call.getBoolean("hidden")
        if (hidden == null) {
            call.reject("hidden is required")
            return
        }
        bridge.executeOnMainThread {
            dappView?.setHidden(hidden)
            call.resolve()
        }
    }

    private fun closeView() {
        dappView?.close()
        dappView = null
    }

    /**
     * The rectangle is in the wallet WebView's CSS pixels, relative to its
     * viewport. The dApp view sits in the activity's content frame, so the
     * offset is the wallet WebView's position in that frame plus the
     * rectangle scaled to physical pixels.
     */
    private fun layoutFor(frame: Rect): FrameLayout.LayoutParams {
        val host = bridge.webView
        val container = activity.findViewById<View>(android.R.id.content)
        val density = host.resources.displayMetrics.density
        val hostAt = IntArray(2)
        val containerAt = IntArray(2)
        host.getLocationInWindow(hostAt)
        container.getLocationInWindow(containerAt)
        val params = FrameLayout.LayoutParams(
            (frame.width * density).roundToInt(),
            (frame.height * density).roundToInt(),
        )
        params.gravity = Gravity.TOP or Gravity.LEFT
        params.leftMargin = hostAt[0] - containerAt[0] + (frame.x * density).roundToInt()
        params.topMargin = hostAt[1] - containerAt[1] + (frame.y * density).roundToInt()
        return params
    }

    private data class Rect(val x: Double, val y: Double, val width: Double, val height: Double)

    private fun rect(objectValue: JSObject?): Rect? {
        val o = objectValue ?: return null
        val x = number(o, "x") ?: return null
        val y = number(o, "y") ?: return null
        val width = number(o, "width") ?: return null
        val height = number(o, "height") ?: return null
        if (width < 0 || height < 0) return null
        return Rect(x, y, width, height)
    }

    private fun number(o: JSObject, key: String): Double? {
        val value = o.opt(key) as? Number ?: return null
        val double = value.toDouble()
        return if (double.isFinite()) double else null
    }
}
