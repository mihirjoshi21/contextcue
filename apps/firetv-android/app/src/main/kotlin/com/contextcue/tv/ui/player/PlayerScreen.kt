@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package com.contextcue.tv.ui.player

import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.contextcue.tv.BuildConfig
import com.contextcue.sdk.ContextCueAskButton
import com.contextcue.sdk.ContextCueOverlay
import com.contextcue.sdk.data.model.Title
import com.contextcue.sdk.handleKey
import com.contextcue.sdk.rememberContextCueController
import com.contextcue.sdk.theme.CcType
import com.contextcue.sdk.util.TimestampFormatter

private val OverscanPadding = PaddingValues(horizontal = 48.dp, vertical = 27.dp)

@Composable
fun PlayerScreen(
    title: Title,
    apiBaseUrl: String,
    onExit: () -> Unit,
    debugInitialSeekMs: Long? = null,
) {
    val context = LocalContext.current
    val viewModel = remember(title.id) {
        // Debug-only screenshot/QA convenience: `adb shell am start ... --el seekMs 3480000`
        // (read by MainActivity and threaded down here) jumps straight to a meaningful position
        // instead of always starting cold at 0 / playbackStartMs. Never active in a release build.
        val seek = debugInitialSeekMs?.takeIf { BuildConfig.DEBUG }
        PlayerViewModel(context, title, debugInitialSeekMs = seek)
    }
    val state by viewModel.uiState.collectAsState()
    val rootFocusRequester = remember { FocusRequester() }

    DisposableEffect(viewModel) {
        onDispose { viewModel.release() }
    }

    // ---- ContextCue SDK integration: the same ~10 lines a third-party host would write ----
    val contextCue = rememberContextCueController(
        apiBaseUrl = apiBaseUrl,
        titleId = title.id,
        positionProvider = { viewModel.player.currentPosition },
        isPlaying = { viewModel.player.isPlaying },
        onSeek = { viewModel.player.seekTo(it) },
        onPause = { viewModel.player.pause() },
        onResume = { viewModel.player.play() },
        skipRanges = title.skipRanges,
    )
    val ccState by contextCue.state.collectAsState()
    LaunchedEffect(contextCue) {
        if (viewModel.initialPositionMs > 0) contextCue.showNotice("Skipped broadcast intro")
    }

    LaunchedEffect(Unit) { rootFocusRequester.requestFocus() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(androidx.compose.ui.graphics.Color.Black)
            .focusRequester(rootFocusRequester)
            .focusable()
            .onKeyEvent { event ->
                if (contextCue.handleKey(event)) return@onKeyEvent true
                if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (event.key) {
                    Key.DirectionCenter, Key.Enter -> {
                        if (!ccState.askPanelOpen) {
                            if (state.isPlaying) {
                                viewModel.togglePlayPause()
                            } else {
                                contextCue.openAskPanel()
                            }
                            true
                        } else {
                            false
                        }
                    }
                    Key.DirectionLeft -> {
                        if (!ccState.askPanelOpen) {
                            viewModel.seekBy(-10_000)
                            true
                        } else false
                    }
                    Key.DirectionRight -> {
                        if (!ccState.askPanelOpen) {
                            viewModel.seekBy(10_000)
                            true
                        } else false
                    }
                    else -> false
                }
            },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    useController = false
                    player = viewModel.player
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (state.playerError != null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                PlaybackErrorCard(message = state.playerError.orEmpty(), onBack = onExit)
            }
        }

        if (!ccState.askPanelOpen) {
            TransportControls(
                title = title,
                state = state,
                onTogglePlayPause = viewModel::togglePlayPause,
                onSeekBack = { viewModel.seekBy(-10_000) },
                onSeekForward = { viewModel.seekBy(10_000) },
                contextCue = contextCue,
                modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth(),
            )
        }

        ContextCueOverlay(contextCue)
    }
}

@Composable
private fun TransportControls(
    title: Title,
    state: PlayerUiState,
    onTogglePlayPause: () -> Unit,
    onSeekBack: () -> Unit,
    onSeekForward: () -> Unit,
    contextCue: com.contextcue.sdk.ContextCue.Controller,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    colors = listOf(
                        androidx.compose.ui.graphics.Color.Transparent,
                        androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.85f),
                    ),
                ),
            )
            .padding(OverscanPadding),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Title on its own line ABOVE the control row so it can never overlap the buttons.
        Text(
            text = title.title,
            style = CcType.label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ControlChip(label = "⏪ 10s", onClick = onSeekBack)
            ControlChip(label = if (state.isPlaying) "⏸ Pause" else "▶ Play", onClick = onTogglePlayPause)
            ControlChip(label = "10s ⏩", onClick = onSeekForward)
            ContextCueAskButton(contextCue)
            Text(
                text = "${TimestampFormatter.format(state.positionMs)} / ${TimestampFormatter.format(state.durationMs)}",
                style = CcType.body,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ControlChip(label: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = ClickableSurfaceDefaults.shape(shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            focusedContainerColor = MaterialTheme.colorScheme.primary,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
        border = ClickableSurfaceDefaults.border(
            focusedBorder = Border(border = androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary)),
        ),
    ) {
        Text(text = label, style = CcType.body, modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
    }
}

@Composable
private fun SkipNoticeChip(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(
                MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(text = "⏩ $text", style = CcType.label, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun PlaybackErrorCard(message: String, onBack: () -> Unit) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Surface(
        onClick = {},
        shape = ClickableSurfaceDefaults.shape(shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = MaterialTheme.colorScheme.surface,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        androidx.compose.foundation.layout.Column(modifier = Modifier.padding(32.dp)) {
            Text(text = "Playback error", style = CcType.heading)
            androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(6.dp))
            Text(text = message, style = CcType.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
            androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(12.dp))
            ControlChip(label = "Back to titles", onClick = onBack)
        }
    }
}
