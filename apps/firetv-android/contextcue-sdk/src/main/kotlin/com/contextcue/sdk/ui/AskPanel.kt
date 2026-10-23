@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package com.contextcue.sdk.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.tv.material3.AssistChip
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.contextcue.sdk.data.model.Citation
import com.contextcue.sdk.theme.CcScrim
import com.contextcue.sdk.theme.CcType
import com.contextcue.sdk.util.QrCodeGenerator
import com.contextcue.sdk.util.TimestampFormatter

/**
 * Right-side (~40% width) Ask panel. The video underneath stays visible but dimmed via [CcScrim].
 */
@Composable
internal fun AskPanel(
    state: ContextCueUiState,
    companionUrl: (String) -> String,
    onSelectChip: (AskChip) -> Unit,
    onSubmitTypedQuestion: (String) -> Unit,
    onOpenTypeQuestion: () -> Unit,
    onCancelTypeQuestion: () -> Unit,
    onSelectCitation: (Citation) -> Unit,
    onReadAloud: (String) -> Unit,
    onStopReadAloud: () -> Unit,
    onShowCompanionQr: () -> Unit,
    onHideCompanionQr: () -> Unit,
    onRetry: () -> Unit,
    onAskSomethingElse: () -> Unit,
) {
    val firstChipFocusRequester = remember { FocusRequester() }

    Box(modifier = Modifier.fillMaxSize().background(CcScrim)) {
        Surface(
            onClick = {},
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .fillMaxWidth(0.4f),
            shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(topStart = 20.dp, bottomStart = 20.dp)),
            colors = ClickableSurfaceDefaults.colors(
                containerColor = MaterialTheme.colorScheme.surface,
                focusedContainerColor = MaterialTheme.colorScheme.surface,
            ),
        ) {
            Column(modifier = Modifier.fillMaxSize().padding(28.dp)) {
                SpoilerSafeBadge(positionMs = state.positionMs)
                Spacer(modifier = Modifier.height(20.dp))

                when {
                    state.showCompanionQr -> CompanionQrContent(
                        companionUrl = companionUrl,
                        sessionCode = state.sessionCode,
                        onBack = onHideCompanionQr,
                    )
                    state.typingQuestion -> TypeQuestionContent(
                        onSubmit = onSubmitTypedQuestion,
                        onCancel = onCancelTypeQuestion,
                    )
                    else -> when (val ask = state.askState) {
                        is AskUiState.Idle -> ChipList(
                            firstChipFocusRequester = firstChipFocusRequester,
                            onSelectChip = onSelectChip,
                            onOpenTypeQuestion = onOpenTypeQuestion,
                            onShowCompanionQr = onShowCompanionQr,
                        )
                        is AskUiState.Loading -> LoadingContent(query = ask.query)
                        is AskUiState.Loaded -> AnswerContent(
                            query = ask.query,
                            response = ask.response,
                            ttsPlaying = state.ttsPlaying,
                            onSelectCitation = onSelectCitation,
                            onReadAloud = onReadAloud,
                            onStopReadAloud = onStopReadAloud,
                            onAskSomethingElse = onAskSomethingElse,
                        )
                        is AskUiState.Error -> ErrorContent(message = ask.message, onRetry = onRetry, onBack = onAskSomethingElse)
                    }
                }
            }
        }
    }

    LaunchedEffect(state.askPanelOpen, state.askState, state.showCompanionQr, state.typingQuestion) {
        if (state.askPanelOpen && state.askState is AskUiState.Idle && !state.showCompanionQr && !state.typingQuestion) {
            firstChipFocusRequester.requestFocus()
        }
    }
}

@Composable
private fun SpoilerSafeBadge(positionMs: Long) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f))
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(
            text = "🔒 Spoiler-safe until ${TimestampFormatter.format(positionMs)}",
            style = CcType.caption,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun ChipList(
    firstChipFocusRequester: FocusRequester,
    onSelectChip: (AskChip) -> Unit,
    onOpenTypeQuestion: () -> Unit,
    onShowCompanionQr: () -> Unit,
) {
    Text(text = "Ask ContextCue", style = CcType.heading)
    Spacer(modifier = Modifier.height(20.dp))
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        AskChip.entries.forEachIndexed { index, chip ->
            AskChipRow(
                label = chip.label,
                modifier = if (index == 0) Modifier.focusRequester(firstChipFocusRequester) else Modifier,
                onClick = { onSelectChip(chip) },
            )
        }
        AskChipRow(
            label = "⌨️ Type or dictate",
            onClick = onOpenTypeQuestion,
        )
        AskChipRow(
            label = "Ask from your phone",
            onClick = onShowCompanionQr,
        )
    }
}

@Composable
private fun AskChipRow(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    AssistChip(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        border = ClickableChipFocusBorder(),
        content = { Text(text = label, style = CcType.body) },
    )
}

@Composable
private fun ClickableChipFocusBorder() = androidx.tv.material3.AssistChipDefaults.border(
    focusedBorder = Border(
        border = androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary),
    ),
)

/** "Type a question…" — the one place besides Settings where the system IME can appear. Many
 * Fire TV remotes support voice dictation through the on-screen keyboard's mic key; this is
 * UNVERIFIED on real hardware, hence the "Type or dictate" wording rather
 * than promising voice input outright. */
@Composable
private fun TypeQuestionContent(onSubmit: (String) -> Unit, onCancel: () -> Unit) {
    var fieldValue by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue("")) }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Text(text = "Type or dictate", style = CcType.heading)
    Spacer(modifier = Modifier.height(8.dp))
    Text(
        text = "Use the on-screen keyboard (many remotes support voice dictation via its mic key).",
        style = CcType.caption,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(modifier = Modifier.height(16.dp))

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
        BasicTextField(
            value = fieldValue,
            onValueChange = { fieldValue = it },
            modifier = Modifier
                .focusRequester(focusRequester)
                .fillMaxWidth()
                // BasicTextField otherwise swallows DPAD_DOWN/UP as cursor movement even when
                // single-line, so once the IME is dismissed there'd be no D-pad way out of the
                // field down to the Ask/Cancel chips below. Intercept it ourselves first.
                .onPreviewKeyEvent { event ->
                    if (event.type == KeyEventType.KeyDown && event.key == Key.DirectionDown) {
                        focusManager.moveFocus(FocusDirection.Down)
                        true
                    } else {
                        false
                    }
                },
            singleLine = true,
            textStyle = CcType.body.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        )
    }

    Spacer(modifier = Modifier.height(20.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        AskChipRow(label = "Ask", onClick = { onSubmit(fieldValue.text) })
        AskChipRow(label = "Cancel", onClick = onCancel)
    }
}

@Composable
private fun LoadingContent(query: AskQuery) {
    Text(text = query.label, style = CcType.heading, maxLines = 2)
    Spacer(modifier = Modifier.height(24.dp))
    ShimmerSkeleton(modifier = Modifier.fillMaxWidth())
    Spacer(modifier = Modifier.height(20.dp))
    Text(
        text = "Reading only what you've already seen…",
        style = CcType.body,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun AnswerContent(
    query: AskQuery,
    response: com.contextcue.sdk.data.model.AskResponse,
    ttsPlaying: Boolean,
    onSelectCitation: (Citation) -> Unit,
    onReadAloud: (String) -> Unit,
    onStopReadAloud: () -> Unit,
    onAskSomethingElse: () -> Unit,
) {
    val readAloudFocusRequester = remember { FocusRequester() }
    LaunchedEffect(query) { readAloudFocusRequester.requestFocus() }

    Column(modifier = Modifier.fillMaxSize()) {
        if (query.source == AskSource.PHONE) {
            Text(text = "📱 Asked from phone", style = CcType.label, color = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.height(4.dp))
            Text(text = query.question, style = CcType.body, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        } else {
            Text(text = query.label, style = CcType.label, color = MaterialTheme.colorScheme.primary, maxLines = 2)
        }
        Spacer(modifier = Modifier.height(10.dp))

        // Answer text + citations share ONE scrollable list so a long answer (or many citations)
        // is always D-pad-scrollable within the fixed-height panel, never clipped.
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { Text(text = response.answer, style = CcType.answer) }
            if (response.citations.isNotEmpty()) {
                item {
                    Text(
                        text = "Replay that moment",
                        style = CcType.label,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(response.citations) { citation ->
                    CitationRow(citation = citation, onClick = { onSelectCitation(citation) })
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        AskChipRow(
            label = if (ttsPlaying) "Stop" else "🔊 Read aloud",
            modifier = Modifier.focusRequester(readAloudFocusRequester),
            onClick = { if (ttsPlaying) onStopReadAloud() else onReadAloud(response.answer) },
        )
        Spacer(modifier = Modifier.height(10.dp))
        AskChipRow(label = "Ask something else", onClick = onAskSomethingElse)
    }
}

@Composable
private fun CitationRow(citation: Citation, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(8.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            focusedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.28f),
        ),
        border = ClickableSurfaceDefaults.border(
            focusedBorder = Border(border = androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary)),
        ),
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "[${TimestampFormatter.format(citation.startMs)}]",
                style = CcType.label,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.size(width = 12.dp, height = 1.dp))
            Text(text = citation.text, style = CcType.caption, maxLines = 2)
        }
    }
}

@Composable
private fun ErrorContent(message: String, onRetry: () -> Unit, onBack: () -> Unit) {
    Text(text = "Couldn't get an answer", style = CcType.heading)
    Spacer(modifier = Modifier.height(12.dp))
    Text(text = message, style = CcType.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(modifier = Modifier.height(24.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        AskChipRow(label = "Retry", onClick = onRetry)
        AskChipRow(label = "Back", onClick = onBack)
    }
}

@Composable
private fun CompanionQrContent(companionUrl: (String) -> String, sessionCode: String?, onBack: () -> Unit) {
    Text(text = "Ask from your phone", style = CcType.heading)
    Spacer(modifier = Modifier.height(16.dp))
    if (sessionCode == null) {
        Text(
            text = "Still connecting to the backend session…",
            style = CcType.body,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    } else {
        val qrContent = companionUrl(sessionCode)
        val bitmap = remember(qrContent) { QrCodeGenerator.generate(qrContent) }
        Image(
            bitmap = bitmap,
            contentDescription = "QR code for $qrContent",
            modifier = Modifier
                .size(220.dp)
                .background(Color.White, RoundedCornerShape(8.dp))
                .padding(12.dp),
        )
        Spacer(modifier = Modifier.height(20.dp))
        Text(text = "Session code", style = CcType.label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text = sessionCode, style = CcType.hero, color = MaterialTheme.colorScheme.primary)
    }
    Spacer(modifier = Modifier.height(24.dp))
    AskChipRow(label = "Back", onClick = onBack)
}
