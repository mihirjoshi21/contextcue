package com.contextcue.tv.util

/** Settings helper text. The "emulator only" caveat is only true for emulator/loopback hosts. */
object DefaultUrlHint {
    private val localHosts = setOf("10.0.2.2", "localhost", "127.0.0.1")

    fun text(defaultUrl: String): String {
        val host = defaultUrl.substringAfter("://").substringBefore('/').substringBefore(':')
        val suffix = if (host in localHosts) " (works from the Android emulator only)" else ""
        return "Default: $defaultUrl$suffix"
    }
}
