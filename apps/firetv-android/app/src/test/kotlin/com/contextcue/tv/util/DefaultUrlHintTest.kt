package com.contextcue.tv.util

import kotlin.test.Test
import kotlin.test.assertEquals

class DefaultUrlHintTest {
    @Test fun emulatorHostGetsSuffix() =
        assertEquals("Default: http://10.0.2.2:8787 (works from the Android emulator only)", DefaultUrlHint.text("http://10.0.2.2:8787"))

    @Test fun localhostGetsSuffix() =
        assertEquals("Default: http://localhost:8787 (works from the Android emulator only)", DefaultUrlHint.text("http://localhost:8787"))

    @Test fun remoteHostHasNoSuffix() =
        assertEquals("Default: https://abc.execute-api.us-east-1.amazonaws.com", DefaultUrlHint.text("https://abc.execute-api.us-east-1.amazonaws.com"))
}
