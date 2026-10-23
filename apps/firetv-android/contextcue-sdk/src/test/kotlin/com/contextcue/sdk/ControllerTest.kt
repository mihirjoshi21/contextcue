package com.contextcue.sdk

import com.contextcue.sdk.data.ApiClient
import com.contextcue.sdk.data.model.Citation
import com.contextcue.sdk.data.model.SkipRange
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Exercises the public host-facing contract of [ContextCue.Controller] with a fake host player. */
@OptIn(ExperimentalCoroutinesApi::class)
class ControllerTest {

    private class FakeTts : TtsPlayer {
        override fun play(audioBase64: String, onDone: () -> Unit) = onDone()
        override fun stop() {}
        override fun release() {}
    }

    private class Host {
        var position = 0L
        var playing = true
        val seeks = mutableListOf<Long>()
        var pauses = 0
        var resumes = 0
    }

    private fun controller(scope: CoroutineScope, host: Host, skipRanges: List<SkipRange> = emptyList()) =
        ContextCue.Controller(
            apiBaseUrl = "http://127.0.0.1:1", // unreachable on purpose: the session is best-effort
            titleId = "t1",
            positionProvider = { host.position },
            isPlaying = { host.playing },
            onSeek = { host.seeks += it },
            onPause = { host.pauses++ },
            onResume = { host.resumes++ },
            skipRanges = skipRanges,
            apiClient = ApiClient("http://127.0.0.1:1"),
            tts = FakeTts(),
            scope = scope,
            clock = { 0L },
        )

    @Test
    fun `opening the panel pauses the host and closing resumes it`() = runTest {
        val host = Host()
        val c = controller(backgroundScope, host)
        c.openAskPanel()
        assertTrue(c.isAskPanelOpen)
        assertEquals(1, host.pauses)
        c.closeAskPanel()
        assertFalse(c.isAskPanelOpen)
        assertEquals(1, host.resumes)
    }

    @Test
    fun `entering a skip range seeks the host to its end once`() = runTest {
        val host = Host()
        val c = controller(backgroundScope, host, listOf(SkipRange(startMs = 1_000, endMs = 5_000, label = "Host segment")))
        host.position = 2_000
        advanceTimeBy(1_200)
        assertEquals(listOf(5_000L), host.seeks)
        assertEquals("Skipped: Host segment", c.state.value.skipNoticeText)
    }

    @Test
    fun `state mirrors the host playhead and playing flag`() = runTest {
        val host = Host()
        val c = controller(backgroundScope, host)
        host.position = 42_000
        host.playing = false
        advanceTimeBy(600)
        assertEquals(42_000L, c.state.value.positionMs)
        assertFalse(c.state.value.isPlaying)
        assertNull(c.state.value.skipNoticeText)
    }

    @Test
    fun `citation replay seeks 2s early and resumes`() = runTest {
        val host = Host()
        val c = controller(backgroundScope, host)
        c.openAskPanel()
        c.replayCitation(Citation(startMs = 60_000, endMs = 65_000, text = "x"))
        assertEquals(listOf(58_000L), host.seeks)
        assertEquals(1, host.resumes)
    }
}
