package com.contextcue.sdk

import android.content.Context
import android.media.MediaPlayer
import android.util.Base64
import java.io.File
import java.io.FileOutputStream

/** "Read aloud" playback seam. Uses the platform [MediaPlayer] so the SDK has no ExoPlayer dependency. */
internal interface TtsPlayer {
    /** Plays base64 MP3 audio; [onDone] fires on completion or failure. */
    fun play(audioBase64: String, onDone: () -> Unit)
    fun stop()
    fun release()
}

internal class AndroidTtsPlayer(context: Context) : TtsPlayer {
    private val cacheDir = context.applicationContext.cacheDir
    private var player: MediaPlayer? = null
    private var tempFile: File? = null

    override fun play(audioBase64: String, onDone: () -> Unit) {
        try {
            release()
            val file = File.createTempFile("cc_speak_", ".mp3", cacheDir)
            FileOutputStream(file).use { it.write(Base64.decode(audioBase64, Base64.DEFAULT)) }
            tempFile = file
            player = MediaPlayer().apply {
                setDataSource(file.absolutePath)
                setOnCompletionListener { onDone() }
                setOnErrorListener { _, _, _ -> onDone(); true }
                setOnPreparedListener { it.start() }
                prepareAsync()
            }
        } catch (e: Exception) {
            onDone()
        }
    }

    override fun stop() {
        try { player?.pause() } catch (_: IllegalStateException) { }
    }

    override fun release() {
        try { player?.release() } catch (_: Exception) { }
        player = null
        tempFile?.delete()
        tempFile = null
    }
}
