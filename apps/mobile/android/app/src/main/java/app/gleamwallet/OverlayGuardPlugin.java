package app.gleamwallet;

import android.annotation.SuppressLint;
import android.os.Build;
import android.view.MotionEvent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps another app's window from passing taps through to the approval
 * sheet while it is up. Android 12 and later hide other apps' overlays
 * outright. On every version, a gesture that starts under another app's
 * window (`FLAG_WINDOW_IS_OBSCURED`, the flag `filterTouchesWhenObscured`
 * reads) is dropped whole and reported as `touchBlocked`, so the sheet can
 * say why the tap did nothing. Off again once the sheet closes, so an app
 * such as a screen dimmer only gets in the way while approving.
 */
@CapacitorPlugin(name = "OverlayGuard")
public class OverlayGuardPlugin extends Plugin {

    private boolean guarded;
    /** Whether the gesture in progress started obscured; every event of it goes the same way. */
    private boolean blockingGesture;

    @SuppressLint("ClickableViewAccessibility")
    @Override
    public void load() {
        // The listener sees the event before WebView does; returning true withholds it.
        getBridge().getWebView().setOnTouchListener((view, event) -> {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                blockingGesture = guarded && (event.getFlags() & MotionEvent.FLAG_WINDOW_IS_OBSCURED) != 0;
                if (blockingGesture) notifyListeners("touchBlocked", new JSObject());
            }
            boolean block = blockingGesture;
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) blockingGesture = false;
            return block;
        });
    }

    @PluginMethod
    public void setGuarded(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("guarded", false));
        getActivity().runOnUiThread(() -> {
            guarded = on;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getActivity().getWindow().setHideOverlayWindows(on);
            }
            call.resolve();
        });
    }
}
