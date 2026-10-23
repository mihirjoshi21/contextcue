package com.contextcue.sdk.theme

import androidx.compose.runtime.Composable
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

private val CcColorScheme = darkColorScheme(
    primary = CcAccent,
    onPrimary = CcOnBackground,
    secondary = CcAccentGlow,
    onSecondary = CcBackground,
    background = CcBackground,
    onBackground = CcOnBackground,
    surface = CcSurface,
    onSurface = CcOnBackground,
    surfaceVariant = CcSurfaceVariant,
    onSurfaceVariant = CcOnSurfaceMuted,
    error = CcError,
)

@Composable
fun ContextCueTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CcColorScheme,
        content = content,
    )
}
