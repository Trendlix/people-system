package com.trendlix.people

import androidx.core.content.FileProvider

// The app's own content link for the file it hands the phone's viewer (MainActivity.kt; a resignation request's letter,
// owner, 31 October 2026): a FileProvider of its own name, so it never clashes with a library's.
class SharedFiles : FileProvider()
