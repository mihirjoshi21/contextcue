package com.contextcue.sdk.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import com.contextcue.sdk.theme.CcSurfaceVariant

/** Shimmering placeholder bars shown while an Ask response is loading. */
@Composable
fun ShimmerSkeleton(modifier: Modifier = Modifier, lineCount: Int = 4) {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val shimmerT by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1100, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "shimmerT",
    )

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        repeat(lineCount) { index ->
            val widthFraction = if (index == lineCount - 1) 0.5f else 1f
            ShimmerBar(widthFraction = widthFraction, t = shimmerT)
        }
    }
}

@Composable
private fun ShimmerBar(widthFraction: Float, t: Float) {
    val brush = Brush.horizontalGradient(
        colors = listOf(
            CcSurfaceVariant,
            CcSurfaceVariant.copy(alpha = 0.4f),
            CcSurfaceVariant,
        ),
        startX = -400f + t * 1200f,
        endX = 200f + t * 1200f,
    )
    androidx.compose.foundation.layout.Box(
        modifier = Modifier
            .fillMaxWidth(widthFraction)
            .height(22.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(brush),
    )
}
