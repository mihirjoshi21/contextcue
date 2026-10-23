package com.contextcue.tv

import com.contextcue.sdk.data.model.Title

/**
 * Minimal hand-rolled navigation model — a full nav-compose graph is overkill for 3 screens.
 * Not `rememberSaveable`-backed: the Activity locks `screenOrientation="landscape"` and declares
 * `configChanges` for the cases that would otherwise recreate it, so in practice this only resets
 * to Home on process death, which is an acceptable tradeoff for a hackathon build.
 */
sealed class Screen {
    data object Home : Screen()

    /** [debugSeekMs] is only ever non-null from the debug-only `am start --el seekMs <ms>`
     * deep link (see MainActivity) — a QA/screenshot convenience, never user-triggered. */
    data class Player(val title: Title, val debugSeekMs: Long? = null) : Screen()
    data object Settings : Screen()
}
