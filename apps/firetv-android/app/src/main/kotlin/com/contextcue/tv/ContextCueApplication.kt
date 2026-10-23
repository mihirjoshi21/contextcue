package com.contextcue.tv

import android.app.Application
import com.contextcue.tv.data.SettingsRepository

class ContextCueApplication : Application() {
    lateinit var settingsRepository: SettingsRepository
        private set

    override fun onCreate() {
        super.onCreate()
        settingsRepository = SettingsRepository(this)
    }
}
