package com.contextcue.sdk.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One broadcast interlude to auto-skip (e.g. Night of the Living Dead's TV-host segments).
 * `[startMs, endMs)` — when playback position enters this range, the player auto-seeks to
 * `endMs` and a small "Skipped: <label>" chip is shown briefly.
 */
@Serializable
data class SkipRange(
    val startMs: Long,
    val endMs: Long,
    val label: String,
)

/**
 * Mirrors GET /v1/titles item shape from SPEC.md, plus two round-2 optional fields the backend is
 * adding concurrently: `playbackStartMs` (first-open start position, e.g. to skip a broadcast
 * intro on a title like Night of the Living Dead) and `skipRanges` (the same idea generalized to
 * mid-film interludes; the intro is *also* sent as a
 * skipRange, so the two features coexist rather than one replacing the other). Both are entirely
 * optional/absent-tolerant — first-open just starts at 0 with nothing to skip.
 */
@Serializable
data class Title(
    val id: String,
    val title: String,
    val durationMs: Long,
    val poster: String? = null,
    val videoUrl: String,
    val hasSubtitles: Boolean = false,
    val license: String? = null,
    val playbackStartMs: Long? = null,
    val skipRanges: List<SkipRange> = emptyList(),
)

/** AskMode mirrors @contextcue/core's AskMode union exactly. */
enum class AskMode {
    @SerialName("ask") ASK,
    @SerialName("recap") RECAP,
    @SerialName("who") WHO,
    @SerialName("scene") SCENE,
    ;

    val wireValue: String
        get() = when (this) {
            ASK -> "ask"
            RECAP -> "recap"
            WHO -> "who"
            SCENE -> "scene"
        }

    companion object {
        fun fromWire(value: String?): AskMode = when (value) {
            "recap" -> RECAP
            "who" -> WHO
            "scene" -> SCENE
            else -> ASK
        }
    }
}

@Serializable
data class AskRequest(
    val titleId: String,
    val positionMs: Long,
    val question: String,
    val mode: String? = null,
    val sessionCode: String? = null,
    val audience: String? = null,
    val locale: String? = null,
)

@Serializable
data class Citation(
    val startMs: Long,
    val endMs: Long,
    val text: String,
)

@Serializable
data class Guard(
    val passed: Boolean,
    val flags: List<String> = emptyList(),
)

@Serializable
data class AskResponse(
    val answer: String,
    val mode: String,
    val citations: List<Citation> = emptyList(),
    val safeUntilMs: Long,
    val guard: Guard? = null,
    val provider: String? = null,
    val model: String? = null,
    val latencyMs: Long? = null,
)

@Serializable
data class SpeakRequest(
    val text: String,
    val voice: String? = null,
)

@Serializable
data class SpeakResponse(
    val audioBase64: String,
    val contentType: String = "audio/mpeg",
)

@Serializable
data class SessionCreateResponse(
    val code: String,
    /** Round-3 security fix: required on every PUT as the `X-TV-Token` header. Nullable so an
     * older server (no tvToken support yet) is tolerated — PUT then just omits the header. */
    val tvToken: String? = null,
)

@Serializable
data class SessionUpdateRequest(
    val titleId: String,
    val positionMs: Long,
    val playing: Boolean,
)

/**
 * A question answered from the phone companion app, surfaced to the TV via the session so it can
 * "show on TV" (round-2 feature). Optional/absent until a companion actually asks something.
 */
@Serializable
data class SharedAnswer(
    val id: String,
    val question: String,
    val answer: String,
    val citations: List<Citation> = emptyList(),
    val mode: String? = null,
    val createdAt: Long? = null,
)

@Serializable
data class SessionState(
    val code: String? = null,
    val titleId: String? = null,
    val positionMs: Long = 0,
    val playing: Boolean = false,
    val sharedAnswer: SharedAnswer? = null,
)

@Serializable
data class CharacterInfo(
    val name: String,
    val firstSeenMs: Long,
    val mentions: Int,
)

@Serializable
data class HealthResponse(
    val ok: Boolean,
    val provider: String? = null,
)
