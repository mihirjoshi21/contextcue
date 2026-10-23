package com.contextcue.sdk.util

import com.contextcue.sdk.data.model.SkipRange
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PlaybackSkipTest {

    // ---- resolveInitialPositionMs ----

    @Test
    fun `no playbackStartMs starts at zero`() {
        assertEquals(0L, PlaybackSkip.resolveInitialPositionMs(null, durationMs = 100_000))
    }

    @Test
    fun `valid playbackStartMs is honored`() {
        assertEquals(392_000L, PlaybackSkip.resolveInitialPositionMs(392_000L, durationMs = 6_009_000))
    }

    @Test
    fun `zero or negative playbackStartMs is treated as no skip`() {
        assertEquals(0L, PlaybackSkip.resolveInitialPositionMs(0L, durationMs = 100_000))
        assertEquals(0L, PlaybackSkip.resolveInitialPositionMs(-500L, durationMs = 100_000))
    }

    @Test
    fun `playbackStartMs at or past the end of the title is ignored`() {
        assertEquals(0L, PlaybackSkip.resolveInitialPositionMs(100_000L, durationMs = 100_000))
        assertEquals(0L, PlaybackSkip.resolveInitialPositionMs(150_000L, durationMs = 100_000))
    }

    @Test
    fun `unknown duration (0) does not reject an otherwise valid playbackStartMs`() {
        assertEquals(392_000L, PlaybackSkip.resolveInitialPositionMs(392_000L, durationMs = 0))
    }

    // ---- findActiveRange ----

    private val introRange = SkipRange(startMs = 0, endMs = 392_000, label = "Broadcast intro")
    private val interludeRange = SkipRange(startMs = 1_800_000, endMs = 1_860_000, label = "Station break")

    @Test
    fun `no ranges means never active`() {
        assertNull(PlaybackSkip.findActiveRange(0, emptyList()))
    }

    @Test
    fun `position before any range is not active`() {
        assertNull(PlaybackSkip.findActiveRange(-1, listOf(introRange)))
    }

    @Test
    fun `position at a range's start is active (inclusive lower bound)`() {
        assertEquals(introRange, PlaybackSkip.findActiveRange(0, listOf(introRange)))
        assertEquals(introRange, PlaybackSkip.findActiveRange(391_999, listOf(introRange)))
    }

    @Test
    fun `position at a range's end is NOT active (exclusive upper bound, prevents re-trigger loops)`() {
        assertNull(PlaybackSkip.findActiveRange(392_000, listOf(introRange)))
    }

    @Test
    fun `position between ranges is not active`() {
        val ranges = listOf(introRange, interludeRange)
        assertNull(PlaybackSkip.findActiveRange(500_000, ranges))
    }

    @Test
    fun `position inside a later range is found`() {
        val ranges = listOf(introRange, interludeRange)
        assertEquals(interludeRange, PlaybackSkip.findActiveRange(1_830_000, ranges))
    }

    @Test
    fun `overlapping ranges resolve to the first match in list order`() {
        val a = SkipRange(startMs = 100, endMs = 200, label = "A")
        val b = SkipRange(startMs = 150, endMs = 250, label = "B")
        assertEquals(a, PlaybackSkip.findActiveRange(180, listOf(a, b)))
        assertEquals(b, PlaybackSkip.findActiveRange(180, listOf(b, a)))
    }
}
