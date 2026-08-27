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

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FilePicker")
public class FilePicker extends Plugin {

    @PluginMethod()
    public void openAndRead(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");   // 显示所有类型文件, 包括 .json
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
            String name = queryName(uri);
            String content = readUri(uri);
            if (content == null) {
                call.reject("read-fail");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("name", name != null ? name : "");
            ret.put("content", content);
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

    private String readUri(Uri uri) {
        try {
            InputStream in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) return null;
            StringBuilder sb = new StringBuilder();
            BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            char[] buf = new char[8192];
            int n;
            while ((n = br.read(buf)) != -1) sb.append(buf, 0, n);
            try { br.close(); } catch (Exception ignored) {}
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }
}
