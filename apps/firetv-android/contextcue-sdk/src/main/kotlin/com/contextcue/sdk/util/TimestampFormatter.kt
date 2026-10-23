package com.contextcue.sdk.util

/**
 * Mirrors @contextcue/core's `formatTimestamp(ms): string` ("1:02:03" or "12:04") so citation
 * chips and the "Spoiler-safe until 12:04" badge read identically to the companion web app.
 */
object TimestampFormatter {
    fun format(ms: Long): String {
        val totalSeconds = (ms.coerceAtLeast(0)) / 1000
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val seconds = totalSeconds % 60
        return if (hours > 0) {
            "%d:%02d:%02d".format(hours, minutes, seconds)
        } else {
            "%d:%02d".format(minutes, seconds)
        }
    }
}
