package app.gleamwallet.cloudbackup

import android.app.Activity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.auth.api.identity.AuthorizationClient
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope

/**
 * Access tokens for the Drive app folder. The TypeScript API is
 * `GoogleDriveAuthPlugin` in `src/definitions.ts`.
 *
 * It asks only for authorization, never for sign-in, so no ID token and no
 * Web client id are involved: Google picks the Android OAuth client by this
 * app's package name and signing certificate. Play services keeps the
 * grant and refreshes the token, so a later `authorize` is silent.
 */
@CapacitorPlugin(name = "GoogleDriveAuth")
class GoogleDriveAuthPlugin : Plugin() {
    private var consent: ActivityResultLauncher<IntentSenderRequest>? = null

    /** The interactive call waiting on the consent screen. Only one can be open. */
    private var pending: PluginCall? = null

    override fun load() {
        // Registered in `load`, before the activity starts, as the Activity Result API requires.
        consent = bridge.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            val call = pending ?: return@registerForActivityResult
            pending = null
            if (result.resultCode != Activity.RESULT_OK) {
                call.resolve(token(null))
                return@registerForActivityResult
            }
            try {
                call.resolve(token(client().getAuthorizationResultFromIntent(result.data).accessToken))
            } catch (_: ApiException) {
                call.resolve(token(null))
            }
        }
    }

    @PluginMethod
    fun authorize(call: PluginCall) {
        val interactive = call.getBoolean("interactive", false) == true
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(DRIVE_APPDATA)))
            .build()
        client().authorize(request)
            .addOnSuccessListener { result ->
                val intent = result.pendingIntent
                when {
                    !result.hasResolution() -> call.resolve(token(result.accessToken))
                    !interactive -> call.resolve(token(null))
                    intent == null -> call.reject("Google sent no consent screen", UNREACHABLE)
                    pending != null -> call.reject("A Google sign-in is already open")
                    else -> {
                        pending = call
                        consent?.launch(IntentSenderRequest.Builder(intent.intentSender).build())
                    }
                }
            }
            .addOnFailureListener { call.reject("Couldn't reach Google", UNREACHABLE, it) }
    }

    @PluginMethod
    fun clearToken(call: PluginCall) {
        val value = call.getString("token")
        if (value.isNullOrEmpty()) {
            call.reject("token is required")
            return
        }
        client().clearToken(ClearTokenRequest.builder().setToken(value).build())
            .addOnSuccessListener { call.resolve() }
            .addOnFailureListener { call.reject("Couldn't clear the Google token", UNREACHABLE, it) }
    }

    private fun client(): AuthorizationClient = Identity.getAuthorizationClient(activity)

    private fun token(value: String?): JSObject = JSObject().apply {
        if (!value.isNullOrEmpty()) put("accessToken", value)
    }

    companion object {
        const val DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata"
        const val UNREACHABLE = "UNREACHABLE"
    }
}
