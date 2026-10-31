package com.trendlix.people

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

// A FragmentActivity: the fingerprint prompt (local_auth) needs one.
//
// A file People gives the app (a resignation request's letter, owner, 31 October 2026: "on the resignation, the letter is
// auto generated, viewed by the employee but uploaded by the HR"), opened in the phone's own viewer to read and print
// (lib/platform/file_opener.dart, channel "people/files"): the bytes the app read with its session are kept in the app's
// cache, the last one only, and the viewer reads that one file through the app's content link (FileProvider,
// res/xml/shared_files.xml). Answers false when no app on the phone opens it.
class MainActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "people/files").setMethodCallHandler { call, result ->
            if (call.method != "open") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            val bytes = call.argument<ByteArray>("bytes")
            val name = call.argument<String>("name")
            val type = call.argument<String>("mimeType")
            if (bytes == null || name == null || type == null) {
                result.error("no_file", "No file to open.", null)
                return@setMethodCallHandler
            }
            result.success(open(bytes, name, type))
        }
    }

    /** Keeps the file in the cache (the one before it removed) and asks the phone for a viewer of its type. */
    private fun open(bytes: ByteArray, name: String, type: String): Boolean {
        val dir = File(cacheDir, "shared")
        dir.deleteRecursively()
        dir.mkdirs()
        val safe = name.replace(Regex("""[\\/:*?"<>|\p{Cntrl}]"""), "_").trim().ifEmpty { "document" }
        val file = File(dir, safe)
        file.writeBytes(bytes)
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return try {
            startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false
        }
    }
}
