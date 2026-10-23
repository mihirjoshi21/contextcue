@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package com.contextcue.tv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.contextcue.sdk.data.model.Title
import com.contextcue.sdk.theme.CcAccent
import com.contextcue.sdk.theme.CcSurfaceVariant
import com.contextcue.sdk.theme.CcType
import com.contextcue.sdk.util.TimestampFormatter

@Composable
fun TitleCard(
    title: Title,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FocusScaleSurface(
        onClick = onClick,
        modifier = modifier.width(240.dp).height(150.dp),
        shape = RoundedCornerShape(10.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                // Fallback gradient, drawn first: if there's no poster URL, or it fails to load,
                // AsyncImage below simply renders nothing and this stays fully visible.
                .background(
                    Brush.verticalGradient(
                        colors = listOf(CcSurfaceVariant, CcAccent.copy(alpha = 0.35f)),
                    ),
                ),
        ) {
            if (!title.poster.isNullOrBlank()) {
                AsyncImage(
                    model = title.poster,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // Scrim so the title/timestamp stay legible over any artwork.
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                androidx.compose.ui.graphics.Color.Transparent,
                                androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.65f),
                            ),
                        ),
                    ),
            )
            Box(modifier = Modifier.align(Alignment.BottomStart).padding(10.dp)) {
                Text(text = title.title, style = CcType.label, maxLines = 2)
            }
            Box(modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)) {
                Text(
                    text = TimestampFormatter.format(title.durationMs),
                    style = CcType.caption,
                )
            }
        }
    }
}
