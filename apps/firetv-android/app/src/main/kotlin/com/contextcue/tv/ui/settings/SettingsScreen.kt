@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package com.contextcue.tv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.contextcue.tv.AppConfig
import com.contextcue.sdk.theme.CcBackground
import com.contextcue.sdk.theme.CcSurfaceVariant
import com.contextcue.sdk.theme.CcType

private val OverscanPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 48.dp, vertical = 27.dp)

@Composable
fun SettingsScreen(
    currentBaseUrl: String,
    onSave: (String) -> Unit,
    onBack: () -> Unit,
) {
    var fieldValue by rememberSaveable(currentBaseUrl, stateSaver = androidx.compose.ui.text.input.TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(currentBaseUrl))
    }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(CcBackground)
            .padding(OverscanPadding),
    ) {
        Text(text = "Settings", style = CcType.titleLarge)
        Spacer(modifier = Modifier.height(24.dp))
        Text(text = "API base URL", style = CcType.label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(modifier = Modifier.height(8.dp))

        Box(
            modifier = Modifier
                .widthIn(min = 480.dp)
                .background(CcSurfaceVariant, RoundedCornerShape(8.dp))
                .border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            BasicTextField(
                value = fieldValue,
                onValueChange = { fieldValue = it },
                modifier = Modifier
                    .focusRequester(focusRequester)
                    .fillMaxWidth(),
                singleLine = true,
                textStyle = CcType.body.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            )
        }

        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = com.contextcue.tv.util.DefaultUrlHint.text(AppConfig.DEFAULT_API_BASE_URL),
            style = CcType.caption,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(32.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Button(onClick = { onSave(fieldValue.text) }) {
                Text("Save")
            }
            Button(onClick = onBack) {
                Text("Cancel")
            }
        }
    }
}
