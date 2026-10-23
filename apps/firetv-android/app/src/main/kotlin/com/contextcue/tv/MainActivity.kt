package com.contextcue.tv

import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.SurfaceDefaults
import com.contextcue.sdk.data.ApiClient
import com.contextcue.tv.ui.home.HomeScreen
import com.contextcue.tv.ui.player.PlayerScreen
import com.contextcue.tv.ui.settings.SettingsScreen
import com.contextcue.sdk.theme.ContextCueTheme
import kotlinx.coroutines.launch

/** Debug-only deep link payload. [nonce] makes repeated identical links distinct. */
data class DebugLink(val titleId: String, val seekMs: Long?, val nonce: Long = System.nanoTime())

class MainActivity : ComponentActivity() {
    private var debugLink by mutableStateOf<DebugLink?>(null)

    private fun parseDebugLink(intent: android.content.Intent?): DebugLink? {
        if (!BuildConfig.DEBUG || intent == null) return null
        val id = intent.getStringExtra("titleId") ?: return null
        val seek = intent.getLongExtra("seekMs", -1L).takeIf { it >= 0 }
        return DebugLink(id, seek)
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as ContextCueApplication
        // Debug-only screenshot/QA deep link, e.g.:
        //   adb shell am start -n com.contextcue.tv/.MainActivity \
        //       --es titleId night-of-the-living-dead-1968 --el seekMs 3480000
        // Works cold (here) and warm (onNewIntent). Never read in a release build.
        debugLink = parseDebugLink(intent)
        setContent {
            ContextCueTheme {
                ContextCueApp(app, debugLink) { debugLink = null }
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        parseDebugLink(intent)?.let { debugLink = it }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ContextCueApp(
    app: ContextCueApplication,
    debugLink: DebugLink? = null,
    onDebugLinkConsumed: () -> Unit = {},
) {
    val apiBaseUrl by app.settingsRepository.apiBaseUrl.collectAsState(initial = AppConfig.DEFAULT_API_BASE_URL)
    val apiClient = remember(apiBaseUrl) { ApiClient(apiBaseUrl) }
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    val scope = rememberCoroutineScope()

    // Warm deep link while a title/settings screen is up: drop back to Home so HomeScreen
    // (which owns the title list) re-opens the requested title with the new seek.
    androidx.compose.runtime.LaunchedEffect(debugLink) {
        if (debugLink != null && screen !is Screen.Home) screen = Screen.Home
    }

    // A plain (non-clickable) Surface establishes LocalContentColor for every Text below that
    // doesn't specify an explicit color — without it, Text defaults to black-on-black.
    Surface(
        modifier = Modifier.fillMaxSize(),
        colors = SurfaceDefaults.colors(
            containerColor = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onBackground,
        ),
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
        when (val current = screen) {
            is Screen.Home -> HomeScreen(
                apiClient = apiClient,
                apiBaseUrl = apiBaseUrl,
                onOpenTitle = { title ->
                    screen = Screen.Player(title, debugLink?.takeIf { it.titleId == title.id }?.seekMs)
                    onDebugLinkConsumed()
                },
                onOpenSettings = { screen = Screen.Settings },
                debugAutoOpenTitleId = debugLink?.titleId,
                debugLinkNonce = debugLink?.nonce,
            )
            is Screen.Player -> {
                BackHandler { screen = Screen.Home }
                PlayerScreen(
                    title = current.title,
                    apiBaseUrl = apiBaseUrl,
                    onExit = { screen = Screen.Home },
                    debugInitialSeekMs = current.debugSeekMs,
                )
            }
            is Screen.Settings -> {
                BackHandler { screen = Screen.Home }
                SettingsScreen(
                    currentBaseUrl = apiBaseUrl,
                    onSave = { newUrl ->
                        scope.launch {
                            app.settingsRepository.setApiBaseUrl(newUrl)
                        }
                        screen = Screen.Home
                    },
                    onBack = { screen = Screen.Home },
                )
            }
        }
        }
    }
}
