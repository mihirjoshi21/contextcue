package com.contextcue.sdk.data

import com.contextcue.sdk.data.model.AskRequest
import com.contextcue.sdk.data.model.AskResponse
import com.contextcue.sdk.data.model.CharacterInfo
import com.contextcue.sdk.data.model.HealthResponse
import com.contextcue.sdk.data.model.SessionCreateResponse
import com.contextcue.sdk.data.model.SessionState
import com.contextcue.sdk.data.model.SessionUpdateRequest
import com.contextcue.sdk.data.model.SpeakRequest
import com.contextcue.sdk.data.model.SpeakResponse
import com.contextcue.sdk.data.model.Title
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Thin client for the HTTP API described in SPEC.md ("HTTP API" section). The base URL is
 * mutable at runtime (Settings screen), so this class is constructed fresh whenever it changes
 * rather than baking the URL into a singleton.
 */
class ApiClient(private val baseUrl: String) {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private fun url(path: String) = baseUrl.trimEnd('/') + path

    private suspend fun <T> execute(
        request: Request,
        parse: (String) -> T,
    ): ApiResult<T> = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext ApiResult.Failure(
                        "HTTP ${response.code} from ${request.url}",
                        httpCode = response.code,
                    )
                }
                ApiResult.Success(parse(body))
            }
        } catch (e: IOException) {
            ApiResult.Failure("Could not reach $baseUrl (${e.message ?: e::class.simpleName})", e)
        } catch (e: Exception) {
            ApiResult.Failure("Unexpected error talking to $baseUrl (${e.message ?: e::class.simpleName})", e)
        }
    }

    suspend fun health(): ApiResult<HealthResponse> {
        val req = Request.Builder().url(url("/health")).get().build()
        return execute(req) { json.decodeFromString(HealthResponse.serializer(), it) }
    }

    suspend fun getTitles(): ApiResult<List<Title>> {
        val req = Request.Builder().url(url("/v1/titles")).get().build()
        return execute(req) { json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(Title.serializer()), it) }
    }

    suspend fun ask(request: AskRequest): ApiResult<AskResponse> {
        val bodyJson = json.encodeToString(AskRequest.serializer(), request)
        val req = Request.Builder()
            .url(url("/v1/ask"))
            .post(bodyJson.toRequestBody(jsonMediaType))
            .build()
        return execute(req) { json.decodeFromString(AskResponse.serializer(), it) }
    }

    suspend fun speak(text: String, voice: String? = null): ApiResult<SpeakResponse> {
        val bodyJson = json.encodeToString(SpeakRequest.serializer(), SpeakRequest(text, voice))
        val req = Request.Builder()
            .url(url("/v1/speak"))
            .post(bodyJson.toRequestBody(jsonMediaType))
            .build()
        return execute(req) { json.decodeFromString(SpeakResponse.serializer(), it) }
    }

    suspend fun createSession(): ApiResult<SessionCreateResponse> {
        val req = Request.Builder()
            .url(url("/v1/sessions"))
            .post("{}".toRequestBody(jsonMediaType))
            .build()
        return execute(req) { json.decodeFromString(SessionCreateResponse.serializer(), it) }
    }

    suspend fun updateSession(
        code: String,
        titleId: String,
        positionMs: Long,
        playing: Boolean,
        tvToken: String? = null,
    ): ApiResult<Unit> {
        val bodyJson = json.encodeToString(
            SessionUpdateRequest.serializer(),
            SessionUpdateRequest(titleId, positionMs, playing),
        )
        val builder = Request.Builder()
            .url(url("/v1/sessions/$code"))
            .put(bodyJson.toRequestBody(jsonMediaType))
        // Security fix: PUT must carry X-TV-Token, or the server 403s. Tolerated as absent so an
        // older server (POST /v1/sessions with no tvToken yet) still works with no header at all.
        tvTokenHeader(tvToken)?.let { (name, value) -> builder.header(name, value) }
        return execute(builder.build()) { }
    }

    suspend fun getSession(code: String): ApiResult<SessionState> {
        val req = Request.Builder().url(url("/v1/sessions/$code")).get().build()
        return execute(req) { json.decodeFromString(SessionState.serializer(), it) }
    }

    suspend fun getCharacters(titleId: String, positionMs: Long): ApiResult<List<CharacterInfo>> {
        val req = Request.Builder()
            .url(url("/v1/titles/$titleId/characters?positionMs=$positionMs"))
            .get()
            .build()
        return execute(req) {
            json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(CharacterInfo.serializer()), it)
        }
    }

    fun companionUrl(sessionCode: String): String = url("/companion/?code=$sessionCode")

    companion object {
        const val TV_TOKEN_HEADER = "X-TV-Token"

        /** Pure so it's unit-testable without a network call: null/blank tvToken -> no header
         * (tolerates an older server that never returned one); otherwise the `X-TV-Token` pair. */
        fun tvTokenHeader(tvToken: String?): Pair<String, String>? =
            tvToken?.takeIf { it.isNotBlank() }?.let { TV_TOKEN_HEADER to it }
    }
}
