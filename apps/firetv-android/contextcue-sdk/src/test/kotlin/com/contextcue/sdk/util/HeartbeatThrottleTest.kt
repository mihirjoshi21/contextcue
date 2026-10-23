package com.contextcue.sdk.util

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HeartbeatThrottleTest {

    @Test
    fun `sends the very first heartbeat immediately`() {
        val throttle = HeartbeatThrottle(intervalMs = 2000)
        assertTrue(throttle.shouldSend(nowMs = 0, playing = true))
    }

    @Test
    fun `does not resend before the interval elapses`() {
        val throttle = HeartbeatThrottle(intervalMs = 2000)
        throttle.markSent(nowMs = 1000, playing = true)
        assertFalse(throttle.shouldSend(nowMs = 1500, playing = true))
        assertFalse(throttle.shouldSend(nowMs = 2999, playing = true))
    }

    @Test
    fun `resends once the interval has fully elapsed`() {
        val throttle = HeartbeatThrottle(intervalMs = 2000)
        throttle.markSent(nowMs = 1000, playing = true)
        assertTrue(throttle.shouldSend(nowMs = 3000, playing = true))
        assertTrue(throttle.shouldSend(nowMs = 5000, playing = true))
    }

    @Test
    fun `sends immediately on a play-pause state transition even mid-interval`() {
        val throttle = HeartbeatThrottle(intervalMs = 2000)
        throttle.markSent(nowMs = 1000, playing = true)
        // Still well inside the 2s window, but playback state flipped -> must not wait.
        assertTrue(throttle.shouldSend(nowMs = 1100, playing = false))
    }

    @Test
    fun `throttle window resets after each send`() {
        val throttle = HeartbeatThrottle(intervalMs = 2000)
        throttle.markSent(nowMs = 0, playing = true)
        throttle.markSent(nowMs = 2000, playing = true)
        assertFalse(throttle.shouldSend(nowMs = 3000, playing = true))
        assertTrue(throttle.shouldSend(nowMs = 4000, playing = true))
    }

    @Test
    fun `reset clears throttle state so next call sends immediately`() {
        val throttle = HeartbeatThrottle(intervalMs = 2000)
        throttle.markSent(nowMs = 0, playing = true)
        throttle.reset()
        assertTrue(throttle.shouldSend(nowMs = 100, playing = true))
    }
}
