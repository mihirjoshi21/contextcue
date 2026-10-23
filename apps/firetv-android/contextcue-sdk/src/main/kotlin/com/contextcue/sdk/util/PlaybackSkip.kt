package com.contextcue.sdk.util

import com.contextcue.sdk.data.model.SkipRange

/**
 * Pure logic for the two related "skip the boring/interstitial part" features (round 2):
 *  - `playbackStartMs`: where a title's first-ever open should start (e.g. skip a broadcast
 *    intro on first open).
 *  - `skipRanges`: `[startMs, endMs)` windows that auto-seek to `endMs` whenever the playhead
 *    enters them, at any point during playback (not just on first open) — e.g. Night of the
 *    Living Dead's TV-host interludes mid-film. The two coexist: the backend may express an
 *    intro as *both* a `playbackStartMs` and an equivalent leading `skipRange`.
 *
 * No Android/ExoPlayer dependency here on purpose, so this is trivially JVM-unit-testable.
 */
object PlaybackSkip {

    /**
     * Where playback should start when a title is opened, given its optional `playbackStartMs`.
     * Ignores an out-of-range value (negative, or at/past the end of the title) rather than
     * seeking somewhere nonsensical.
     */
    fun resolveInitialPositionMs(playbackStartMs: Long?, durationMs: Long): Long {
        if (playbackStartMs == null || playbackStartMs <= 0L) return 0L
        if (durationMs > 0 && playbackStartMs >= durationMs) return 0L
        return playbackStartMs
    }

    /**
     * The skip range (if any) whose `[startMs, endMs)` contains `positionMs`. `endMs` is
     * exclusive so that seeking to a range's own `endMs` does not immediately re-trigger it.
     * If ranges overlap, the first match in list order wins.
     */
    fun findActiveRange(positionMs: Long, ranges: List<SkipRange>): SkipRange? =
        ranges.firstOrNull { positionMs >= it.startMs && positionMs < it.endMs }
}
