package com.contextcue.sdk.util

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SharedAnswerDeduperTest {

    @Test
    fun `a null id is never handled`() {
        val deduper = SharedAnswerDeduper()
        assertFalse(deduper.shouldHandle(null))
        assertFalse(deduper.shouldHandle(null))
    }

    @Test
    fun `the first sighting of a non-null id is handled`() {
        val deduper = SharedAnswerDeduper()
        assertTrue(deduper.shouldHandle("q1"))
    }

    @Test
    fun `the same id polled again is not re-handled`() {
        val deduper = SharedAnswerDeduper()
        assertTrue(deduper.shouldHandle("q1"))
        assertFalse(deduper.shouldHandle("q1"))
        assertFalse(deduper.shouldHandle("q1"))
    }

    @Test
    fun `a genuinely new id after a previous one is handled`() {
        val deduper = SharedAnswerDeduper()
        assertTrue(deduper.shouldHandle("q1"))
        assertTrue(deduper.shouldHandle("q2"))
        assertFalse(deduper.shouldHandle("q2"))
    }

    @Test
    fun `reset allows the current id to be handled again`() {
        val deduper = SharedAnswerDeduper()
        assertTrue(deduper.shouldHandle("q1"))
        deduper.reset()
        assertTrue(deduper.shouldHandle("q1"))
    }
}
