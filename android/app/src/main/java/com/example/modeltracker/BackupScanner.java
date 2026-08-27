package com.example.modeltracker;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;

@CapacitorPlugin(name = "BackupScanner")
public class BackupScanner extends Plugin {

    private static final String PREFIX = "model_checker_";
    private static final int B64_BLOCK = 15360;   // 15KB, 3的倍数, 保证每个 base64 块不对齐破坏

    @PluginMethod()
    public void scan(PluginCall call) {
        try {
            JSArray arr = new JSArray();
            scanViaMediaStore(arr);
            scanViaFileDirs(arr);
            call.resolve(new JSObject().put("files", arr));
        } catch (Exception e) {
            call.reject("scan error: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void read(PluginCall call) {
        String fileName = call.getString("name");
        if (fileName == null) {
            call.reject("name missing");
            return;
        }
        try {
            String content = readViaMediaStore(fileName);
            if (content == null) {
                content = readFromPublicDir(fileName);
            }
            if (content == null) {
                call.reject("backup not readable: " + fileName);
                return;
            }
            call.resolve(new JSObject().put("content", content));
        } catch (Exception e) {
            call.reject("read error: " + e.getMessage());
        }
    }

    // 完全在原生产生成备份 JSON(记录+图片base64)并存到公共 Documents.
    // 全程流式分块(base64 块=15KB, data.json 也分块), 内存峰值=一个块, 与图片大小/数量无关, 不会OOM.
    @PluginMethod()
    public void exportToDocuments(PluginCall call) {
        String publicName = call.getString("publicName");
        if (publicName == null) { call.reject("publicName missing"); return; }
        try {
            Context ctx = getContext();
            File base = ctx.getFilesDir();               // /data/user/0/.../files
            File dataFile = new File(base, "data.json"); // 记录数组 JSON
            File imagesDir = new File(base, "images");

            OutputStream os = openPublicOutputStream(publicName);
            if (os == null) throw new Exception("open output fail");

            byte[] buf = new byte[64 * 1024];
            int n;
            try {
                // 1) {"list":
                os.write("{\"list\":".getBytes(StandardCharsets.UTF_8));
                // 2) data.json 内容(分块流式, data.json 可能是大数组)
                if (dataFile.isFile()) {
                    FileInputStream dfin = new FileInputStream(dataFile);
                    try {
                        while ((n = dfin.read(buf)) != -1) os.write(buf, 0, n);
                    } finally { try { dfin.close(); } catch (Exception ignored) {} }
                } else {
                    os.write("[]".getBytes(StandardCharsets.UTF_8));
                }
                // 3) ,"images":{
                os.write(",\"images\":{".getBytes(StandardCharsets.UTF_8));

                // 4) 遍历 images/ 目录, 逐张图流式 base64 写入
                boolean first = true;
                if (imagesDir.isDirectory()) {
                    File[] imgs = imagesDir.listFiles();
                    if (imgs != null) {
                        for (File img : imgs) {
                            if (!img.isFile()) continue;
                            if (!first) os.write(",".getBytes(StandardCharsets.UTF_8));
                            first = false;
                            // "文件名":
                            os.write(("\"" + escapeJson(img.getName()) + "\":\"").getBytes(StandardCharsets.UTF_8));
                            // base64 分块写入
                            writeImageBase64(os, img);
                            os.write("\"".getBytes(StandardCharsets.UTF_8));
                        }
                    }
                }
                // 5) }}
                os.write("}}".getBytes(StandardCharsets.UTF_8));
                os.flush();
            } finally {
                try { os.close(); } catch (Exception ignored) {}
            }
            call.resolve(new JSObject().put("name", publicName));
        } catch (Exception e) {
            call.reject("export error: " + e.getMessage());
        }
    }

    // 打开公共 Documents 的输出流(Android10+ MediaStore, 否则 File)
    private OutputStream openPublicOutputStream(String publicName) {
        Context ctx = getContext();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Files.FileColumns.DISPLAY_NAME, publicName);
                values.put(MediaStore.Files.FileColumns.MIME_TYPE, "application/json");
                values.put(MediaStore.Files.FileColumns.RELATIVE_PATH, Environment.DIRECTORY_DOCUMENTS);
                Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri uri = ctx.getContentResolver().insert(collection, values);
                if (uri != null) return ctx.getContentResolver().openOutputStream(uri);
            } else {
                File dst = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), publicName);
                return new FileOutputStream(dst);
            }
        } catch (Exception ignored) {}
        return null;
    }

    // 图片 -> 分块 base64 写入输出流(核心: 每块独立编码, 3字节对齐, 内存峰值=1块)
    private void writeImageBase64(OutputStream os, File img) throws Exception {
        FileInputStream fis = new FileInputStream(img);
        byte[] chunk = new byte[B64_BLOCK];
        int n;
        try {
            while ((n = fis.read(chunk)) != -1) {
                // 取有效长度, Base64.NO_WRAP 不换行
                byte[] in = (n == chunk.length) ? chunk : java.util.Arrays.copyOf(chunk, n);
                byte[] enc = Base64.encode(in, Base64.NO_WRAP);
                os.write(enc);
                if (n == chunk.length) java.util.Arrays.fill(chunk, (byte) 0); // 覆盖残留
            }
        } finally {
            try { fis.close(); } catch (Exception ignored) {}
        }
    }

    // 简易 JSON 字符串转义(文件名用)
    private String escapeJson(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\');
            sb.append(c);
        }
        return sb.toString();
    }

    // 把私有 DATA 目录下的文件(私有名)复制到公共 Documents 目录(公共名).
    private void copyToDocumentsFile(File src, String publicName) throws Exception {
        OutputStream os = openPublicOutputStream(publicName);
        if (os == null) throw new Exception("open output fail");
        FileInputStream fis = new FileInputStream(src);
        byte[] buf = new byte[64 * 1024];
        int n;
        try {
            while ((n = fis.read(buf)) != -1) {
                os.write(buf, 0, n);
            }
        } finally {
            try { os.flush(); } catch (Exception ignored) {}
            try { os.close(); } catch (Exception ignored) {}
            try { fis.close(); } catch (Exception ignored) {}
        }
    }

    private HashSet<String> collectSeen(JSArray arr) {
        HashSet<String> seen = new HashSet<String>();
        for (int i = 0; i < arr.length(); i++) {
            try {
                Object o = arr.get(i);
                if (o != null) seen.add(String.valueOf(o));
            } catch (Exception ignored) {}
        }
        return seen;
    }

    private void scanViaMediaStore(JSArray arr) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        Context ctx = getContext();
        try {
            HashSet<String> seen = collectSeen(arr);
            Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL);
            String[] projection = { MediaStore.Files.FileColumns.DISPLAY_NAME };
            String sel = MediaStore.Files.FileColumns.DISPLAY_NAME + " LIKE ?";
            String[] selArgs = new String[]{ PREFIX + "%" };
            Cursor c = ctx.getContentResolver().query(collection, projection, sel, selArgs, null);
            if (c != null) {
                try {
                    int nameIdx = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME);
                    while (c.moveToNext()) {
                        String name = c.getString(nameIdx);
                        if (name != null && name.endsWith(".json") && !seen.contains(name)) {
                            seen.add(name);
                            arr.put(name);
                        }
                    }
                } finally {
                    c.close();
                }
            }
        } catch (Exception ignored) {}
    }

    private void scanViaFileDirs(JSArray arr) {
        try {
            HashSet<String> seen = collectSeen(arr);
            String[] roots = {
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).getAbsolutePath(),
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).getAbsolutePath()
            };
            for (String root : roots) {
                File dir = new File(root);
                if (!dir.isDirectory()) continue;
                File[] files = dir.listFiles();
                if (files == null) continue;
                for (File f : files) {
                    if (f.isFile() && f.getName().startsWith(PREFIX) && f.getName().endsWith(".json")
                            && !seen.contains(f.getName())) {
                        seen.add(f.getName());
                        arr.put(f.getName());
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private String readViaMediaStore(String fileName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
        Context ctx = getContext();
        try {
            Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL);
            String[] projection = { MediaStore.Files.FileColumns._ID };
            String sel = MediaStore.Files.FileColumns.DISPLAY_NAME + " = ?";
            String[] selArgs = new String[]{ fileName };
            Cursor c = ctx.getContentResolver().query(collection, projection, sel, selArgs, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        long id = c.getLong(c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID));
                        Uri fileUri = Uri.withAppendedPath(collection, String.valueOf(id));
                        InputStream in = ctx.getContentResolver().openInputStream(fileUri);
                        if (in != null) return readStream(in);
                    }
                } finally {
                    c.close();
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String readFromPublicDir(String fileName) {
        try {
            String[] roots = {
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).getAbsolutePath(),
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).getAbsolutePath()
            };
            for (String root : roots) {
                File f = new File(root, fileName);
                if (f.isFile()) return readFile(f);
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String readStream(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String line;
        while ((line = br.readLine()) != null) sb.append(line).append("\n");
        try { br.close(); } catch (Exception ignored) {}
        return sb.toString();
    }

    private String readFile(File f) throws Exception {
        DataInputStream dis = new DataInputStream(new FileInputStream(f));
        byte[] bytes = new byte[(int) f.length()];
        dis.readFully(bytes);
        dis.close();
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
