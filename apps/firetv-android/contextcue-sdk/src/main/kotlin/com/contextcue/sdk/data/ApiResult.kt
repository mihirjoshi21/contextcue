package com.contextcue.sdk.data

/** Small Result wrapper so UI can render a friendly "backend unreachable" card. */
sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Failure(
        val message: String,
        val cause: Throwable? = null,
        /** The HTTP status code, when the failure was a non-2xx response (null for network-level
         * failures). Used e.g. to detect a 403 from a stale/missing tvToken. */
        val httpCode: Int? = null,
    ) : ApiResult<Nothing>()
}

inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Success -> ApiResult.Success(transform(data))
    is ApiResult.Failure -> this
}
