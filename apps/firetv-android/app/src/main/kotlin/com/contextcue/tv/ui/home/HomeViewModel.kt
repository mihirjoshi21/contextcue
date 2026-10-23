package com.contextcue.tv.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.contextcue.sdk.data.ApiClient
import com.contextcue.sdk.data.ApiResult
import com.contextcue.sdk.data.model.Title
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class HomeUiState {
    data object Loading : HomeUiState()
    data class Loaded(val titles: List<Title>) : HomeUiState()
    data class Error(val message: String) : HomeUiState()
}

class HomeViewModel(private val apiClient: ApiClient) : ViewModel() {
    private val _uiState = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        _uiState.value = HomeUiState.Loading
        viewModelScope.launch {
            when (val result = apiClient.getTitles()) {
                is ApiResult.Success -> _uiState.value = HomeUiState.Loaded(result.data)
                is ApiResult.Failure -> _uiState.value = HomeUiState.Error(result.message)
            }
        }
    }
}
