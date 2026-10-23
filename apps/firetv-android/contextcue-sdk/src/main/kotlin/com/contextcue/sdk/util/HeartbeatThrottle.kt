package com.contextcue.sdk.util

/**
 * Decides when a session-position heartbeat (PUT /v1/sessions/:code) should actually be sent.
 * SPEC.md calls for a heartbeat "every 2s while playing" — this throttle enforces the minimum
 * interval between sends while always allowing an immediate send on a play/pause transition
 * (so the server sees pauses promptly instead of up to 2s late).
 *
 * Pure logic, no clock/IO dependencies, so it is trivially unit-testable with fake timestamps.
 */
class HeartbeatThrottle(private val intervalMs: Long) {

    private var lastSentAtMs: Long? = null
    private var lastPlaying: Boolean? = null

    /** Returns true if a heartbeat should be sent right now, given the current playing state. */
    fun shouldSend(nowMs: Long, playing: Boolean): Boolean {
        val sentBefore = lastSentAtMs
        val stateChanged = lastPlaying != null && lastPlaying != playing
        val intervalElapsed = sentBefore == null || (nowMs - sentBefore) >= intervalMs
        return stateChanged || intervalElapsed
    }

    /** Call after a heartbeat is actually sent, to reset the throttle window. */
    fun markSent(nowMs: Long, playing: Boolean) {
        lastSentAtMs = nowMs
        lastPlaying = playing
    }

    fun reset() {
        lastSentAtMs = null
        lastPlaying = null
    }
}
