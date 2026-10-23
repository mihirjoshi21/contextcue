package com.contextcue.sdk

import android.content.Context
import com.contextcue.sdk.data.ApiClient
import com.contextcue.sdk.data.ApiResult
import com.contextcue.sdk.data.model.AskMode
import com.contextcue.sdk.data.model.AskRequest
import com.contextcue.sdk.data.model.AskResponse
import com.contextcue.sdk.data.model.Citation
import com.contextcue.sdk.data.model.SharedAnswer
import com.contextcue.sdk.data.model.SkipRange
import com.contextcue.sdk.ui.AskChip
import com.contextcue.sdk.ui.AskQuery
import com.contextcue.sdk.ui.AskSource
import com.contextcue.sdk.ui.AskUiState
import com.contextcue.sdk.ui.ContextCueUiState
import com.contextcue.sdk.util.HeartbeatThrottle
import com.contextcue.sdk.util.PlaybackSkip
import com.contextcue.sdk.util.SharedAnswerDeduper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * ContextCue SDK entry point: spoiler-safe AI Q&A for any Fire OS video app.
 *
 * The host owns the player. It tells the SDK where the playhead is and how to pause/resume/seek;
 * the SDK owns the session, heartbeat, Ask panel, phone-companion "show on TV" answers, skip
 * ranges, and "welcome back" recap. The spoiler ceiling is enforced SERVER-SIDE from the
 * `positionMs` the SDK sends - the client cannot ask about anything past the playhead.
 */
object ContextCue {
    const val HEARTBEAT_INTERVAL_MS: Long = 2_000L
    const val WELCOME_BACK_THRESHOLD_MS: Long = 5 * 60 * 1000L
    const val SHARED_ANSWER_POLL_INTERVAL_MS: Long = 2_000L

    /**
     * @param apiBaseUrl ContextCue backend, e.g. `https://xyz.execute-api.us-east-1.amazonaws.com`
     * @param titleId the title id the backend knows (`GET /v1/titles`)
     * @param positionProvider current playhead in ms (called on the main thread)
     * @param isPlaying whether the host player is currently playing (main thread)
     * @param onSeek seek the host player to an absolute position (citation replay, skip ranges)
     * @param onPause pause the host player (called when the Ask panel opens)
     * @param onResume resume the host player (called when the Ask panel closes)
     * @param skipRanges optional intervals (e.g. broadcast interludes) to auto-skip
     */
    class Controller internal constructor(
        val apiBaseUrl: String,
        val titleId: String,
        private val positionProvider: () -> Long,
        private val isPlaying: () -> Boolean,
        private val onSeek: (Long) -> Unit,
        private val onPause: () -> Unit,
        private val onResume: () -> Unit,
        private val skipRanges: List<SkipRange>,
        private val apiClient: ApiClient,
        private val tts: TtsPlayer,
        private val scope: CoroutineScope,
        private val clock: () -> Long,
    ) {
        constructor(
            context: Context,
            apiBaseUrl: String,
            titleId: String,
            positionProvider: () -> Long,
            isPlaying: () -> Boolean,
            onSeek: (Long) -> Unit,
            onPause: () -> Unit,
            onResume: () -> Unit,
            skipRanges: List<SkipRange> = emptyList(),
        ) : this(
            apiBaseUrl, titleId, positionProvider, isPlaying, onSeek, onPause, onResume, skipRanges,
            ApiClient(apiBaseUrl), AndroidTtsPlayer(context),
            CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
            System::currentTimeMillis,
        )

        private val _state = MutableStateFlow(ContextCueUiState())
        val state: StateFlow<ContextCueUiState> = _state.asStateFlow()

        private val heartbeatThrottle = HeartbeatThrottle(HEARTBEAT_INTERVAL_MS)
        private val sharedAnswerDeduper = SharedAnswerDeduper()
        /** Sent as `X-TV-Token` on every session PUT. Null tolerated (older server). */
        private var tvToken: String? = null
        private var sessionRecreateInFlight = false
        private var pausedAtMs: Long? = null
        private var backgroundedAtMs: Long? = null
        private var welcomeBackShownForThisPause = false
        private var activeSkipRange: SkipRange? = null
        private var noticeJob: Job? = null
        private val jobs = mutableListOf<Job>()

        init {
            createSession()
            jobs += scope.launch { tickLoop() }
            jobs += scope.launch { heartbeatLoop() }
            jobs += scope.launch { sharedAnswerLoop() }
        }

        // ---- Session / loops ----

        private fun createSession() {
            scope.launch {
                when (val r = apiClient.createSession()) {
                    is ApiResult.Success -> {
                        tvToken = r.data.tvToken
                        _state.update { it.copy(sessionCode = r.data.code) }
                    }
                    is ApiResult.Failure -> Unit // Session is a nice-to-have; ask works without it.
                }
            }
        }

        /** Recreates the session (and token) once per 403 - never loops. */
        private suspend fun recreateSessionAfter403() {
            if (sessionRecreateInFlight) return
            sessionRecreateInFlight = true
            try {
                when (val r = apiClient.createSession()) {
                    is ApiResult.Success -> {
                        tvToken = r.data.tvToken
                        _state.update { it.copy(sessionCode = r.data.code) }
                    }
                    is ApiResult.Failure -> Unit
                }
            } finally {
                sessionRecreateInFlight = false
            }
        }

        private suspend fun tickLoop() {
            var wasPlaying: Boolean? = null
            while (true) {
                val position = positionProvider().coerceAtLeast(0)
                val playing = isPlaying()
                if (playing != wasPlaying) {
                    wasPlaying = playing
                    pausedAtMs = if (playing) null else clock()
                    if (playing) welcomeBackShownForThisPause = false
                }
                _state.update { it.copy(positionMs = position, isPlaying = playing) }
                checkWelcomeBack()
                checkSkipRanges(position)
                delay(500)
            }
        }

        private fun checkSkipRanges(positionMs: Long) {
            val range = PlaybackSkip.findActiveRange(positionMs, skipRanges)
            if (range == null) {
                activeSkipRange = null
                return
            }
            if (range == activeSkipRange) return
            activeSkipRange = range
            onSeek(range.endMs)
            showNotice("Skipped: ${range.label}")
        }

        /** Shows the transient "skipped" chip. Hosts call this for their own skips (e.g. a start offset). */
        fun showNotice(text: String) {
            _state.update { it.copy(skipNoticeText = text) }
            noticeJob?.cancel()
            noticeJob = scope.launch {
                delay(3000)
                _state.update { it.copy(skipNoticeText = null) }
            }
        }

        private fun checkWelcomeBack() {
            val pausedAt = pausedAtMs ?: return
            val s = _state.value
            if (s.askPanelOpen || s.welcomeBackVisible || welcomeBackShownForThisPause) return
            if (clock() - pausedAt >= WELCOME_BACK_THRESHOLD_MS) {
                welcomeBackShownForThisPause = true
                _state.update { it.copy(welcomeBackVisible = true) }
            }
        }

        private suspend fun heartbeatLoop() {
            while (true) {
                val code = _state.value.sessionCode
                val now = clock()
                val playing = isPlaying()
                if (code != null && heartbeatThrottle.shouldSend(now, playing)) {
                    heartbeatThrottle.markSent(now, playing)
                    val result = apiClient.updateSession(code, titleId, positionProvider().coerceAtLeast(0), playing, tvToken)
                    if (result is ApiResult.Failure && result.httpCode == 403) recreateSessionAfter403()
                }
                delay(400)
            }
        }

        private suspend fun sharedAnswerLoop() {
            while (true) {
                delay(SHARED_ANSWER_POLL_INTERVAL_MS)
                val code = _state.value.sessionCode ?: continue
                val r = apiClient.getSession(code)
                if (r is ApiResult.Success) handleSharedAnswer(r.data.sharedAnswer)
            }
        }

        private fun handleSharedAnswer(shared: SharedAnswer?) {
            if (shared == null || !sharedAnswerDeduper.shouldHandle(shared.id)) return
            val query = AskQuery(shared.question, AskMode.fromWire(shared.mode), shared.question, AskSource.PHONE)
            val response = AskResponse(
                answer = shared.answer,
                mode = shared.mode ?: AskMode.ASK.wireValue,
                citations = shared.citations,
                safeUntilMs = _state.value.positionMs,
            )
            onPause()
            _state.update {
                it.copy(
                    askPanelOpen = true, showCompanionQr = false, typingQuestion = false,
                    askState = AskUiState.Loaded(query, response),
                )
            }
        }

        // ---- Host lifecycle (ContextCueOverlay wires these automatically) ----

        fun onHostStopped() { backgroundedAtMs = clock() }

        fun onHostStarted() {
            val at = backgroundedAtMs ?: return
            backgroundedAtMs = null
            if (clock() - at >= WELCOME_BACK_THRESHOLD_MS && !_state.value.askPanelOpen) {
                welcomeBackShownForThisPause = true
                _state.update { it.copy(welcomeBackVisible = true) }
            }
        }

        // ---- Ask panel ----

        val isAskPanelOpen: Boolean get() = _state.value.askPanelOpen

        fun openAskPanel() {
            onPause()
            _state.update {
                it.copy(askPanelOpen = true, askState = AskUiState.Idle, showCompanionQr = false, typingQuestion = false)
            }
        }

        fun closeAskPanel(resume: Boolean = true) {
            stopReadAloud()
            _state.update { it.copy(askPanelOpen = false, showCompanionQr = false, typingQuestion = false) }
            if (resume) onResume()
        }

        fun toggleAskPanel() { if (isAskPanelOpen) closeAskPanel() else openAskPanel() }

        internal fun showCompanionQr() = _state.update { it.copy(showCompanionQr = true, typingQuestion = false) }
        internal fun hideCompanionQr() = _state.update { it.copy(showCompanionQr = false) }
        internal fun openTypeQuestion() = _state.update { it.copy(typingQuestion = true, showCompanionQr = false) }
        internal fun cancelTypeQuestion() = _state.update { it.copy(typingQuestion = false) }
        internal fun companionUrl(code: String): String = apiClient.companionUrl(code)

        fun submitTypedQuestion(text: String) {
            _state.update { it.copy(typingQuestion = false) }
            val q = text.trim()
            if (q.isNotEmpty()) ask(AskQuery(label = q, mode = AskMode.ASK, question = q))
        }

        fun dismissWelcomeBack() = _state.update { it.copy(welcomeBackVisible = false) }

        fun acceptWelcomeBackRecap() {
            _state.update { it.copy(welcomeBackVisible = false) }
            openAskPanel()
            ask(AskChip.RECAP.toQuery())
        }

        fun ask(chip: AskChip) = ask(chip.toQuery())

        fun ask(query: AskQuery) {
            // The ceiling: the server clamps every answer to this playhead.
            val positionMs = positionProvider().coerceAtLeast(0)
            _state.update { it.copy(askState = AskUiState.Loading(query)) }
            scope.launch {
                val request = AskRequest(
                    titleId = titleId,
                    positionMs = positionMs,
                    question = query.question,
                    mode = query.mode.wireValue,
                    sessionCode = _state.value.sessionCode,
                )
                when (val r = apiClient.ask(request)) {
                    is ApiResult.Success -> _state.update { it.copy(askState = AskUiState.Loaded(query, r.data)) }
                    is ApiResult.Failure -> _state.update { it.copy(askState = AskUiState.Error(query, r.message)) }
                }
            }
        }

        fun retryAsk() {
            val s = _state.value.askState
            val q = (s as? AskUiState.Error)?.query ?: (s as? AskUiState.Loading)?.query
            if (q != null) ask(q)
        }

        /** Citation select: seek to 2s before the cited line and resume. */
        fun replayCitation(citation: Citation) {
            onSeek((citation.startMs - 2000).coerceAtLeast(0))
            closeAskPanel(resume = true)
        }

        fun readAloud(text: String) {
            scope.launch {
                _state.update { it.copy(ttsPlaying = true) }
                when (val r = apiClient.speak(text)) {
                    is ApiResult.Success ->
                        if (r.data.audioBase64.isBlank()) {
                            _state.update { it.copy(ttsPlaying = false) } // mock provider: nothing to play
                        } else {
                            tts.play(r.data.audioBase64) { _state.update { s -> s.copy(ttsPlaying = false) } }
                        }
                    is ApiResult.Failure -> _state.update { it.copy(ttsPlaying = false) }
                }
            }
        }

        fun stopReadAloud() {
            tts.stop()
            _state.update { it.copy(ttsPlaying = false) }
        }

        /** Stops all loops and frees audio resources. `rememberContextCueController` calls this for you. */
        fun release() {
            noticeJob?.cancel()
            jobs.forEach { it.cancel() }
            scope.cancel()
            tts.release()
        }
    }
}
