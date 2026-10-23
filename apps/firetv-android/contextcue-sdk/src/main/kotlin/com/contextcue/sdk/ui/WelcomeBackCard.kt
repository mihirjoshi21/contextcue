@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package com.contextcue.sdk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.contextcue.sdk.theme.CcType

/** "Welcome back — want a 20-second recap?" toast-like card. One press accepts. */
@Composable
internal fun WelcomeBackCard(onAccept: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Surface(
        onClick = {},
        modifier = modifier.widthIn(max = 520.dp),
        shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(16.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = MaterialTheme.colorScheme.surface,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
        ),
        border = ClickableSurfaceDefaults.border(
            border = Border(border = androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary)),
        ),
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Text(text = "Welcome back", style = CcType.heading)
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Want a 20-second recap of what you missed?",
                style = CcType.body,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Button(onClick = onAccept, modifier = Modifier.focusRequester(focusRequester)) {
                    Text("Yes, recap me")
                }
                Button(onClick = onDismiss) {
                    Text("Dismiss")
                }
            }
        }
    }
}
