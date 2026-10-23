package com.contextcue.tv.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.contextcue.tv.AppConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "contextcue_settings")

/** Persists the API base URL override (Settings screen) across app restarts. */
class SettingsRepository(private val context: Context) {

    private object Keys {
        val API_BASE_URL = stringPreferencesKey("api_base_url")
    }

    val apiBaseUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.API_BASE_URL] ?: AppConfig.DEFAULT_API_BASE_URL
    }

    suspend fun setApiBaseUrl(url: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.API_BASE_URL] = url.trim().ifBlank { AppConfig.DEFAULT_API_BASE_URL }
        }
    }
}
