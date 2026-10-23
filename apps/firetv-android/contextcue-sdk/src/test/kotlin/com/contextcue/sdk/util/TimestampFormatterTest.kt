package com.contextcue.sdk.util

import kotlin.test.Test
import kotlin.test.assertEquals

class TimestampFormatterTest {
    @Test
    fun `formats sub-hour durations as m colon ss`() {
        assertEquals("0:00", TimestampFormatter.format(0))
        assertEquals("0:05", TimestampFormatter.format(5_000))
        assertEquals("12:04", TimestampFormatter.format((12 * 60 + 4) * 1000L))
        assertEquals("59:59", TimestampFormatter.format((59 * 60 + 59) * 1000L))
    }

    @Test
    fun `formats hour-plus durations as h colon mm colon ss`() {
        assertEquals("1:00:00", TimestampFormatter.format(60 * 60 * 1000L))
        assertEquals("1:02:03", TimestampFormatter.format((3600 + 2 * 60 + 3) * 1000L))
        assertEquals("2:00:09", TimestampFormatter.format((2 * 3600 + 9) * 1000L))
    }

    @Test
    fun `clamps negative input to zero`() {
        assertEquals("0:00", TimestampFormatter.format(-500))
    }

    @Test
    fun `truncates partial seconds instead of rounding`() {
        assertEquals("0:01", TimestampFormatter.format(1_999))
    }
}
