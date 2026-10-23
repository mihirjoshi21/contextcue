package com.contextcue.sdk.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * 10-foot typography scale. SPEC.md requires a minimum body size of 24sp; the Ask panel's
 * answer text must be 26sp+.
 */
object CcType {
    val hero = TextStyle(fontSize = 44.sp, fontWeight = FontWeight.Bold, lineHeight = 52.sp)
    val titleLarge = TextStyle(fontSize = 32.sp, fontWeight = FontWeight.SemiBold, lineHeight = 38.sp)
    val heading = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.SemiBold, lineHeight = 34.sp)
    val answer = TextStyle(fontSize = 27.sp, fontWeight = FontWeight.Normal, lineHeight = 36.sp)
    val body = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.Normal, lineHeight = 32.sp)
    val label = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Medium, lineHeight = 26.sp)
    val caption = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Normal, lineHeight = 24.sp)
}
