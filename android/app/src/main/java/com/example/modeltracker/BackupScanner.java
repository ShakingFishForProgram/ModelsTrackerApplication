package com.example.modeltracker;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.JsonReader;

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
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;

@CapacitorPlugin(name = "BackupScanner")
public class BackupScanner extends Plugin {

    private static final String PREFIX = "model_checker_";
    private static final int B64_BLOCK = 15360;   // 15KB, 3的倍数, 保证每个 base64 块不对齐破坏

    // 把 base64 图片保存到系统相册(Pictures/ModelTracker)
    @PluginMethod()
    public void saveImageToGallery(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) { call.reject("base64 missing"); return; }
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            saveToMediaStore(bytes);
            call.resolve(new JSObject().put("ok", true));
        } catch (Exception e) {
            call.reject("save error: " + e.getMessage());
        }
    }

    private void saveToMediaStore(byte[] bytes) throws Exception {
        Context ctx = getContext();
        String name = "ModelTracker_" + System.currentTimeMillis() + ".jpg";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ModelTracker");
            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri uri = ctx.getContentResolver().insert(collection, values);
            if (uri == null) throw new Exception("insert fail");
            OutputStream os = ctx.getContentResolver().openOutputStream(uri);
            if (os == null) throw new Exception("open stream fail");
            try { os.write(bytes); } finally { try { os.close(); } catch (Exception ignored) {} }
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "ModelTracker");
            if (!dir.exists()) dir.mkdirs();
            File dst = new File(dir, name);
            FileOutputStream fos = new FileOutputStream(dst);
            try { fos.write(bytes); } finally { try { fos.close(); } catch (Exception ignored) {} }
            MediaScannerConnection.scanFile(ctx, new String[]{ dst.getAbsolutePath() }, null, null);
        }
    }

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

            try {
                // 1) 读 data.json(现在是 {"list":[...],"plans":[...]})，去掉末尾 } 后写入
                if (dataFile.isFile()) {
                    String dataJson = readFile(dataFile);
                    if (dataJson.endsWith("}")) dataJson = dataJson.substring(0, dataJson.length() - 1);
                    os.write(dataJson.getBytes(StandardCharsets.UTF_8));
                } else {
                    os.write("{\"list\":[],\"plans\":[]".getBytes(StandardCharsets.UTF_8));
                }
                // 2) ,"images":{
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

    // 原生流式导入: 从 content uri 逐段解析备份, 图片边读边写私有目录, records 写回 data.json
    @PluginMethod()
    public void importFromUri(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("uri missing"); return; }
        try {
            Context ctx = getContext();
            Uri uri = Uri.parse(uriStr);
            InputStream in = ctx.getContentResolver().openInputStream(uri);
            if (in == null) { call.reject("open fail"); return; }

            File base = ctx.getFilesDir();
            File imagesDir = new File(base, "images");
            if (!imagesDir.exists()) imagesDir.mkdirs();

            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            try {
                String marker = ",\"images\":{";
                StringBuilder records = new StringBuilder();
                boolean hasImages = readUntil(reader, records, marker);

                String recordsJson = hasImages ? (records.toString() + "}") : records.toString();
                validateJsonObject(recordsJson);   // 先校验, 避免写坏 data.json

                int imgCount = hasImages ? parseImages(reader, imagesDir) : 0;

                writeFile(new File(base, "data.json"), recordsJson);

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("images", imgCount);
                call.resolve(ret);
            } finally {
                try { reader.close(); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            call.reject("import error: " + e.getMessage());
        }
    }

    // 读取直到遇到 marker(不含 marker), 返回是否找到
    private boolean readUntil(BufferedReader reader, StringBuilder sb, String marker) throws Exception {
        int m = marker.length();
        while (true) {
            int c = reader.read();
            if (c == -1) return false;
            sb.append((char) c);
            if (sb.length() >= m) {
                boolean match = true;
                for (int i = 0; i < m; i++) {
                    if (sb.charAt(sb.length() - m + i) != marker.charAt(i)) { match = false; break; }
                }
                if (match) {
                    sb.setLength(sb.length() - m);
                    return true;
                }
            }
        }
    }

    // 校验字符串是合法 JSON 对象(能完整解析)
    private void validateJsonObject(String json) throws Exception {
        JsonReader r = new JsonReader(new StringReader(json));
        r.beginObject();
        while (r.hasNext()) { r.nextName(); r.skipValue(); }
        r.endObject();
        r.close();
    }

    // 解析 images 部分(前面已消费 ,"images":{): "name":"base64", ... }
    private int parseImages(BufferedReader reader, File imagesDir) throws Exception {
        int count = 0;
        int c = reader.read();
        if (c == -1) throw new Exception("unexpected EOF");
        if (c == '}') return 0;   // 空 images 对象
        while (c == '"') {
            String name = readQuoted(reader);
            c = reader.read();
            if (c != ':') throw new Exception("bad images format");
            c = reader.read();
            if (c != '"') throw new Exception("bad images format");
            writeImageBase64Stream(reader, new File(imagesDir, name));
            count++;
            c = reader.read();
            if (c == ',') {
                c = reader.read();
            } else if (c == '}') {
                break;
            } else {
                throw new Exception("bad images format");
            }
        }
        return count;
    }

    // 读取引号包裹的字符串(不含闭合引号)
    private String readQuoted(BufferedReader reader) throws Exception {
        StringBuilder sb = new StringBuilder();
        while (true) {
            int c = reader.read();
            if (c == -1) throw new Exception("unexpected EOF");
            if (c == '"') return sb.toString();
            sb.append((char) c);
        }
    }

    // 流式读取 base64 直到闭合引号, 分块解码写入文件
    private void writeImageBase64Stream(BufferedReader reader, File outFile) throws Exception {
        FileOutputStream fos = new FileOutputStream(outFile);
        char[] buf = new char[20480];  // 与导出块一致: 15360 字节 -> 20480 字符
        try {
            while (true) {
                int n = 0;
                while (n < buf.length) {
                    int c = reader.read();
                    if (c == -1) throw new Exception("unexpected EOF in base64");
                    if (c == '"') {
                        if (n > 0) {
                            byte[] bytes = Base64.decode(new String(buf, 0, n), Base64.DEFAULT);
                            fos.write(bytes);
                        }
                        return;
                    }
                    buf[n++] = (char) c;
                }
                byte[] bytes = Base64.decode(new String(buf, 0, n), Base64.DEFAULT);
                fos.write(bytes);
            }
        } finally {
            try { fos.close(); } catch (Exception ignored) {}
        }
    }

    // 覆盖写文件
    private void writeFile(File f, String content) throws Exception {
        FileOutputStream fos = new FileOutputStream(f);
        try { fos.write(content.getBytes(StandardCharsets.UTF_8)); } finally { fos.close(); }
    }
}
