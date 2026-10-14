package com.example.modeltracker;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FilePicker")
public class FilePicker extends Plugin {

    @PluginMethod()
    public void openAndRead(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");   // 显示所有类型文件, 包括 .json
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "pickResult");
        } catch (Exception e) {
            call.reject("无法打开文件选择器: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            if (result == null || result.getResultCode() != Activity.RESULT_OK) {
                call.reject("canceled");
                return;
            }
            Intent data = result.getData();
            if (data == null || data.getData() == null) {
                call.reject("no-file");
                return;
            }
            Uri uri = data.getData();
            // 尽量取得持久读权限, 便于 BackupScanner 后续流式读取
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {}
            String name = queryName(uri);
            JSObject ret = new JSObject();
            ret.put("name", name != null ? name : "");
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read error: " + e.getMessage());
        }
    }

    private String queryName(Uri uri) {
        try {
            Cursor c = getContext().getContentResolver().query(
                    uri, new String[]{ OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        return c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME));
                    }
                } finally {
                    c.close();
                }
            }
        } catch (Exception ignored) {}
        return uri.getLastPathSegment();
    }
}
