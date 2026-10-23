package com.contextcue.sdk.util

/**
 * Tracks which `sharedAnswer.id` (a question answered from the phone companion, polled via
 * `GET /v1/sessions/:code`) has already been shown on the TV, so the same phone question doesn't
 * re-trigger the "show on TV" interruption (pause + open Ask panel) on every 2s poll while it's
 * still the latest one. A `null` id is never "new".
 */
class SharedAnswerDeduper {
    private var lastHandledId: String? = null

    /** Returns true (and remembers it) exactly once per distinct non-null id. */
    fun shouldHandle(id: String?): Boolean {
        if (id == null) return false
        if (id == lastHandledId) return false
        lastHandledId = id
        return true
    }

    fun reset() {
        lastHandledId = null
    }
}
