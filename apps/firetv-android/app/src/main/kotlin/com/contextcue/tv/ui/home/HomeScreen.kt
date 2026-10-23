@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package com.contextcue.tv.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.contextcue.tv.AppConfig
import com.contextcue.sdk.data.ApiClient
import com.contextcue.sdk.data.model.Title
import com.contextcue.tv.ui.components.BackendUnreachableCard
import com.contextcue.tv.ui.components.TitleCard
import com.contextcue.sdk.theme.CcAccent
import com.contextcue.sdk.theme.CcBackground
import com.contextcue.sdk.theme.CcType
import androidx.tv.material3.IconButton
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text

/**
 * Overscan-safe margins per SPEC.md: 48dp horizontal / 27dp vertical.
 */
private val OverscanPadding = PaddingValues(horizontal = 48.dp, vertical = 27.dp)

@Composable
fun HomeScreen(
    apiClient: ApiClient,
    apiBaseUrl: String,
    onOpenTitle: (Title) -> Unit,
    onOpenSettings: () -> Unit,
    debugAutoOpenTitleId: String? = null,
    debugLinkNonce: Long? = null,
) {
    val viewModel = remember(apiClient) { HomeViewModel(apiClient) }
    val uiState by viewModel.uiState.collectAsState()

    // Debug-only screenshot/QA convenience: jump straight into a title from an `am start` deep
    // link instead of always landing on Home first. Never active in a release build (the caller
    // only ever passes a non-null id when BuildConfig.DEBUG).
    LaunchedEffect(uiState, debugAutoOpenTitleId, debugLinkNonce) {
        val loaded = uiState as? HomeUiState.Loaded ?: return@LaunchedEffect
        val match = debugAutoOpenTitleId?.let { id -> loaded.titles.firstOrNull { it.id == id } }
        if (match != null) onOpenTitle(match)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(CcBackground)
            .padding(OverscanPadding),
    ) {
        // Settings gear, always reachable top-right.
        IconButton(
            onClick = onOpenSettings,
            modifier = Modifier.align(Alignment.TopEnd),
        ) {
            Text(text = "⚙", style = CcType.heading)
        }

        when (val state = uiState) {
            is HomeUiState.Loading -> {
                Column(modifier = Modifier.align(Alignment.Center)) {
                    Text(text = "Loading titles…", style = CcType.heading)
                }
            }
            is HomeUiState.Error -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    BackendUnreachableCard(
                        apiBaseUrl = apiBaseUrl,
                        onOpenSettings = onOpenSettings,
                        onRetry = { viewModel.load() },
                    )
                }
            }
            is HomeUiState.Loaded -> {
                if (state.titles.isEmpty()) {
                    Text(
                        text = "No titles yet. Add one to content/titles.json on the backend.",
                        style = CcType.body,
                        modifier = Modifier.align(Alignment.Center),
                    )
                } else {
                    HomeContent(titles = state.titles, onOpenTitle = onOpenTitle)
                }
            }
        }
    }
}

@Composable
private fun HomeContent(
    titles: List<Title>,
    onOpenTitle: (Title) -> Unit,
) {
    var focusedTitle by remember(titles) { mutableStateOf(titles.first()) }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(320.dp),
        ) {
            // Blurred/dimmed backdrop of whichever title currently has D-pad focus. Falls back
            // to the plain gradient (drawn underneath, always) if there's no poster or it fails
            // to load — AsyncImage then simply renders nothing on top of it.
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(CcAccent.copy(alpha = 0.28f), CcBackground),
                        ),
                    ),
            )
            if (!focusedTitle.poster.isNullOrBlank()) {
                AsyncImage(
                    model = focusedTitle.poster,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxSize()
                        .blur(28.dp)
                        .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.35f)),
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                androidx.compose.ui.graphics.Color.Transparent,
                                CcBackground,
                            ),
                        ),
                    ),
            )
            Column(modifier = Modifier.align(Alignment.BottomStart)) {
                Text(text = AppConfig.APP_NAME, style = CcType.label, color = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.height(8.dp))
                Text(text = focusedTitle.title, style = CcType.hero)
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Spoiler-safe answers as you watch. Press select to play.",
                    style = CcType.body,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val license = focusedTitle.license
                if (!license.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = license,
                        style = CcType.caption,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))
        Text(text = "Titles", style = CcType.heading)
        Spacer(modifier = Modifier.height(12.dp))

        LazyRow(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            items(titles, key = { it.id }) { title ->
                TitleCard(
                    title = title,
                    onClick = { onOpenTitle(title) },
                    modifier = Modifier.onFocusChanged { focusState ->
                        if (focusState.isFocused) focusedTitle = title
                    },
                )
            }
        }
    }
}
