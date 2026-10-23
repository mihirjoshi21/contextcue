package com.contextcue.tv.ui.player

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.contextcue.sdk.data.model.Title
import com.contextcue.sdk.util.PlaybackSkip
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Transport-only state for the sample host's own controls. Everything Ask-related lives in the SDK. */
data class PlayerUiState(
    val isPlaying: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val playerError: String? = null,
)

/**
 * The HOST's player wrapper: owns the ExoPlayer and nothing else. ContextCue (the SDK) is given
 * lambdas over this player (position, isPlaying, seek, pause, resume) in PlayerScreen. Plain
 * class with explicit [release] so native decoders are freed deterministically.
 *
 * @param debugInitialSeekMs debug-build-only override for screenshots, bypassing playbackStartMs.
 */
class PlayerViewModel(
    context: Context,
    val title: Title,
    debugInitialSeekMs: Long? = null,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _uiState = MutableStateFlow(PlayerUiState(durationMs = title.durationMs))
    val uiState: StateFlow<PlayerUiState> = _uiState.asStateFlow()

    val initialPositionMs: Long = debugInitialSeekMs
        ?: PlaybackSkip.resolveInitialPositionMs(title.playbackStartMs, title.durationMs)

    val player: ExoPlayer = ExoPlayer.Builder(context.applicationContext).build().apply {
        setMediaItem(MediaItem.fromUri(title.videoUrl))
        prepare()
        if (initialPositionMs > 0) seekTo(initialPositionMs)
        playWhenReady = true
        addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _uiState.update { it.copy(isPlaying = isPlaying) }
            }

            override fun onPlayerError(error: PlaybackException) {
                _uiState.update { it.copy(playerError = error.message ?: "Playback error") }
            }
        })
    }

    init {
        scope.launch {
            while (true) {
                val duration = player.duration.let { if (it > 0) it else title.durationMs }
                _uiState.update { it.copy(positionMs = player.currentPosition.coerceAtLeast(0), durationMs = duration) }
                delay(500)
            }
        }
    }

    fun togglePlayPause() {
        if (player.isPlaying) player.pause() else player.play()
    }

    fun seekBy(deltaMs: Long) {
        player.seekTo((player.currentPosition + deltaMs).coerceIn(0, player.duration.coerceAtLeast(0)))
    }

    fun release() {
        scope.cancel()
        player.release()
    }
}
