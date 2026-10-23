package com.contextcue.sdk.ui

import com.contextcue.sdk.data.model.AskMode
import com.contextcue.sdk.data.model.AskResponse

/** One of the fixed, D-pad-only Ask panel chips (no on-screen keyboard needed to ask). */
enum class AskChip(val label: String, val mode: AskMode, val question: String) {
    RECAP("Catch me up", AskMode.RECAP, "Catch me up on everything that's happened so far."),
    WHO("Who's who so far", AskMode.WHO, "Who's who so far?"),
    SCENE("What just happened?", AskMode.SCENE, "What just happened in this scene?"),
    ASK("Why did they do that?", AskMode.ASK, "Why did they do that?"),
    ;

    fun toQuery(): AskQuery = AskQuery(label = label, mode = mode, question = question)
}

/** Where an [AskQuery] came from, so the answer card can label it appropriately. */
enum class AskSource { TV, PHONE }

/**
 * A resolved "ask" — either one of the fixed [AskChip]s, a free-typed/dictated question, or a
 * question answered on the phone companion and mirrored to the TV ("show on TV").
 */
data class AskQuery(
    val label: String,
    val mode: AskMode,
    val question: String,
    val source: AskSource = AskSource.TV,
)

sealed class AskUiState {
    data object Idle : AskUiState()
    data class Loading(val query: AskQuery) : AskUiState()
    data class Loaded(val query: AskQuery, val response: AskResponse) : AskUiState()
    data class Error(val query: AskQuery?, val message: String) : AskUiState()
}

/** Everything the SDK overlay renders; exposed read-only via `ContextCueController.state`. */
data class ContextCueUiState(
    val isPlaying: Boolean = false,
    val positionMs: Long = 0L,
    val askPanelOpen: Boolean = false,
    val askState: AskUiState = AskUiState.Idle,
    val sessionCode: String? = null,
    val welcomeBackVisible: Boolean = false,
    val ttsPlaying: Boolean = false,
    val showCompanionQr: Boolean = false,
    val typingQuestion: Boolean = false,
    /** Transient "Skipped: <label>" chip text, or null when hidden. */
    val skipNoticeText: String? = null,
)
