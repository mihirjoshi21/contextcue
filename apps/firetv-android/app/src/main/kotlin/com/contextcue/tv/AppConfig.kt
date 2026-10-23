package com.contextcue.tv

/**
 * Single place to rename the product. Everything user-facing should read this constant
 * (or the equivalent BuildConfig.APP_DISPLAY_NAME) rather than hardcoding "ContextCue".
 * The product name lives here only, so renaming is a one-line change.
 */
object AppConfig {
    const val APP_NAME: String = BuildConfig.APP_DISPLAY_NAME
    const val DEFAULT_API_BASE_URL: String = BuildConfig.DEFAULT_API_BASE_URL

    /** Heartbeat cadence while a title is playing, per SPEC.md ("Heartbeat PUT ... every 2s"). */
    const val HEARTBEAT_INTERVAL_MS: Long = 2_000L

    /** "Welcome back" recap prompt threshold: paused/backgrounded longer than this offers a recap. */
    const val WELCOME_BACK_THRESHOLD_MS: Long = 5 * 60 * 1000L

    /** How often the TV polls GET /v1/sessions/:code for a phone-companion `sharedAnswer`. */
    const val SHARED_ANSWER_POLL_INTERVAL_MS: Long = 2_000L
}
