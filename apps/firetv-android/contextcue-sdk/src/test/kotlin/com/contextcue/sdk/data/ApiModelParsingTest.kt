package com.contextcue.sdk.data

import com.contextcue.sdk.data.model.AskResponse
import com.contextcue.sdk.data.model.HealthResponse
import com.contextcue.sdk.data.model.SessionCreateResponse
import com.contextcue.sdk.data.model.Title
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * These fixtures are copied verbatim from SPEC.md's HTTP API section so a change to the wire
 * contract on the backend side breaks this test rather than silently breaking the app.
 */
class ApiModelParsingTest {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Test
    fun `parses GET slash v1 slash titles response`() {
        val body = """
            [
              {
                "id": "t1",
                "title": "The Last Signal",
                "durationMs": 5400000,
                "poster": "https://example.com/poster.jpg",
                "videoUrl": "https://example.com/video.mp4",
                "hasSubtitles": true,
                "license": "public-domain"
              }
            ]
        """.trimIndent()

        val titles: List<Title> = json.decodeFromString(ListSerializer(Title.serializer()), body)

        assertEquals(1, titles.size)
        val title = titles.first()
        assertEquals("t1", title.id)
        assertEquals("The Last Signal", title.title)
        assertEquals(5_400_000L, title.durationMs)
        assertTrue(title.hasSubtitles)
        assertEquals("https://example.com/video.mp4", title.videoUrl)
    }

    @Test
    fun `parses a title with no poster or license (both nullable)`() {
        val body = """
            [{"id":"t2","title":"No Extras","durationMs":1000,"videoUrl":"https://x/y.mp4","hasSubtitles":false}]
        """.trimIndent()
        val titles: List<Title> = json.decodeFromString(ListSerializer(Title.serializer()), body)
        assertEquals(null, titles.first().poster)
        assertEquals(null, titles.first().license)
    }

    @Test
    fun `parses POST slash v1 slash ask response with citations and guard`() {
        val body = """
            {
              "answer": "She took the letter because she recognized the handwriting. [12:04]",
              "mode": "ask",
              "citations": [
                { "startMs": 724000, "endMs": 731500, "text": "That's her mother's handwriting." }
              ],
              "safeUntilMs": 730000,
              "guard": { "passed": true, "flags": [] },
              "provider": "mock",
              "model": "extractive-v1",
              "latencyMs": 42
            }
        """.trimIndent()

        val response = json.decodeFromString(AskResponse.serializer(), body)

        assertEquals("ask", response.mode)
        assertEquals(1, response.citations.size)
        assertEquals(724_000L, response.citations.first().startMs)
        assertEquals(730_000L, response.safeUntilMs)
        assertTrue(response.guard!!.passed)
        assertTrue(response.guard!!.flags.isEmpty())
        assertEquals("mock", response.provider)
    }

    @Test
    fun `parses ask response even when optional fields are absent`() {
        val body = """{"answer":"Not revealed yet.","mode":"recap","safeUntilMs":0}"""
        val response = json.decodeFromString(AskResponse.serializer(), body)
        assertTrue(response.citations.isEmpty())
        assertEquals(null, response.guard)
        assertEquals(null, response.provider)
    }

    @Test
    fun `parses POST slash v1 slash sessions response`() {
        val body = """{"code":"7F3K9Q"}"""
        val response = json.decodeFromString(SessionCreateResponse.serializer(), body)
        assertEquals("7F3K9Q", response.code)
    }

    @Test
    fun `parses GET slash health response for both providers`() {
        val mock = json.decodeFromString(HealthResponse.serializer(), """{"ok":true,"provider":"mock"}""")
        assertTrue(mock.ok)
        assertEquals("mock", mock.provider)

        val bedrock = json.decodeFromString(HealthResponse.serializer(), """{"ok":true,"provider":"bedrock"}""")
        assertEquals("bedrock", bedrock.provider)
    }

    @Test
    fun `ignores unknown keys the backend might add later`() {
        val body = """{"ok":true,"provider":"mock","futureField":"whatever"}"""
        val health = json.decodeFromString(HealthResponse.serializer(), body)
        assertTrue(health.ok)
    }
}
