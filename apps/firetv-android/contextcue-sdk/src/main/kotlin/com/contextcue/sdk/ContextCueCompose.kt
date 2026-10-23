@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package com.contextcue.sdk

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.contextcue.sdk.data.model.SkipRange
import com.contextcue.sdk.theme.CcType
import com.contextcue.sdk.theme.ContextCueTheme
import com.contextcue.sdk.ui.AskPanel
import com.contextcue.sdk.ui.WelcomeBackCard

private val OverscanPadding = PaddingValues(horizontal = 48.dp, vertical = 27.dp)

/** Creates a [ContextCue.Controller] tied to the composition (released automatically on leave). */
@Composable
fun rememberContextCueController(
    apiBaseUrl: String,
    titleId: String,
    positionProvider: () -> Long,
    isPlaying: () -> Boolean,
    onSeek: (Long) -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    skipRanges: List<SkipRange> = emptyList(),
): ContextCue.Controller {
    val context = LocalContext.current
    val controller = remember(apiBaseUrl, titleId) {
        ContextCue.Controller(context, apiBaseUrl, titleId, positionProvider, isPlaying, onSeek, onPause, onResume, skipRanges)
    }
    DisposableEffect(controller) { onDispose { controller.release() } }
    return controller
}

/**
 * Draws the Ask panel, phone-answer card, "welcome back" prompt and "skipped" chip over the host's
 * video. Also handles Back (closes the panel) and the host lifecycle. Place it last in a `Box`
 * above the player.
 */
@Composable
fun ContextCueOverlay(controller: ContextCue.Controller, modifier: Modifier = Modifier) {
    val state by controller.state.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner, controller) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> controller.onHostStopped()
                Lifecycle.Event.ON_START -> controller.onHostStarted()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    BackHandler(enabled = state.askPanelOpen) { controller.closeAskPanel(resume = true) }

    ContextCueTheme {
        Box(modifier = modifier.fillMaxSize()) {
            val notice = state.skipNoticeText
            if (notice != null && !state.askPanelOpen) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(OverscanPadding)
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f), RoundedCornerShape(20.dp))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                ) {
                    Text("⏩ $notice", style = CcType.label, color = MaterialTheme.colorScheme.primary)
                }
            }

            if (state.welcomeBackVisible && !state.askPanelOpen) {
                Box(Modifier.fillMaxSize().padding(OverscanPadding), contentAlignment = Alignment.TopEnd) {
                    WelcomeBackCard(
                        onAccept = controller::acceptWelcomeBackRecap,
                        onDismiss = controller::dismissWelcomeBack,
                    )
                }
            }

            if (state.askPanelOpen) {
                AskPanel(
                    state = state,
                    companionUrl = controller::companionUrl,
                    onSelectChip = controller::ask,
                    onSubmitTypedQuestion = controller::submitTypedQuestion,
                    onOpenTypeQuestion = controller::openTypeQuestion,
                    onCancelTypeQuestion = controller::cancelTypeQuestion,
                    onSelectCitation = controller::replayCitation,
                    onReadAloud = controller::readAloud,
                    onStopReadAloud = controller::stopReadAloud,
                    onShowCompanionQr = controller::showCompanionQr,
                    onHideCompanionQr = controller::hideCompanionQr,
                    onRetry = controller::retryAsk,
                    onAskSomethingElse = controller::openAskPanel,
                )
            }
        }
    }
}

/** A focusable "Ask" chip that opens the panel (pausing the host player). */
@Composable
fun ContextCueAskButton(controller: ContextCue.Controller, modifier: Modifier = Modifier, label: String = "❓ Ask") {
    ContextCueTheme {
        Surface(
            onClick = controller::openAskPanel,
            modifier = modifier,
            shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(24.dp)),
            colors = ClickableSurfaceDefaults.colors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                focusedContainerColor = MaterialTheme.colorScheme.primary,
            ),
            scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
        ) {
            Text(label, style = CcType.body, modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
        }
    }
}

/**
 * Optional remote-key helper: Menu toggles the Ask panel. Call from the host's key handler:
 * `Modifier.onKeyEvent { controller.handleKey(it) }`. Returns true if consumed.
 */
fun ContextCue.Controller.handleKey(event: KeyEvent): Boolean {
    if (event.type != KeyEventType.KeyDown || event.key != Key.Menu) return false
    toggleAskPanel()
    return true
}
