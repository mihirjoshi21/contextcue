package com.contextcue.sdk.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Security-fix contract: every PUT /v1/sessions/:code must carry `X-TV-Token: <tvToken>` (403
 * otherwise), but an older server that never returned a tvToken must still be tolerated (no
 * header sent, rather than crashing or sending a blank one).
 */
class ApiClientTvTokenHeaderTest {

    @Test
    fun `attaches the X-TV-Token header when a token is present`() {
        val header = ApiClient.tvTokenHeader("secret-token-123")
        assertEquals("X-TV-Token" to "secret-token-123", header)
    }

    @Test
    fun `sends no header when tvToken is null (older server)`() {
        assertNull(ApiClient.tvTokenHeader(null))
    }

    @Test
    fun `sends no header when tvToken is blank`() {
        assertNull(ApiClient.tvTokenHeader(""))
        assertNull(ApiClient.tvTokenHeader("   "))
    }

    @Test
    fun `header name matches what the backend expects`() {
        assertEquals(ApiClient.TV_TOKEN_HEADER, ApiClient.tvTokenHeader("x")?.first)
    }
}
