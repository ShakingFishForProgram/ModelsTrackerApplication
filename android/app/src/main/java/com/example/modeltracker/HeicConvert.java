package com.example.modeltracker;

import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;

@CapacitorPlugin(name = "HeicConvert")
public class HeicConvert extends Plugin {

    @PluginMethod()
    public void toJpeg(PluginCall call) {
        String filePath = call.getString("file");            // 相对路径 images/xxx.heic
        if (filePath == null) {
            call.reject("file missing");
            return;
        }

        try {
            File dir = getContext().getFilesDir();           // /data/user/0/pkg/files
            File in = new File(dir, filePath);

            // 解码为 Bitmap: 优先 ImageDecoder(支持更多HEIC/HEIF变体), 失败回退 BitmapFactory
            Bitmap bmp = decodeImage(in);
            if (bmp == null) {
                call.reject("decode fail");
                return;
            }

            // 压缩为 JPEG 90% 质量
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 90, baos);

            // 生成新文件名 xxx_converted.jpg (存到 images 目录)
            String base = new File(filePath).getName();
            int dot = base.lastIndexOf('.');
            String stem = dot > 0 ? base.substring(0, dot) : base;
            String outName = "conv_" + stem + ".jpg";
            File outFile = new File(dir, "images/" + outName);

            FileOutputStream fos = new FileOutputStream(outFile);
            fos.write(baos.toByteArray());
            fos.flush();
            fos.close();
            if (!bmp.isRecycled()) bmp.recycle();

            JSObject ret = new JSObject();
            ret.put("name", "images/" + outName);
            ret.put("size", baos.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("convert error: " + e.getMessage());
        }
    }

    // 尝试用 ImageDecoder 解码, 失败回退 BitmapFactory; 都失败返回 null
    private Bitmap decodeImage(File file) {
        // ImageDecoder 需要 API 28+; compileSdk 34 支持, 运行时不支持则走 BitmapFactory
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                ImageDecoder.Source src = ImageDecoder.createSource(file);
                return ImageDecoder.decodeBitmap(src, new ImageDecoder.OnHeaderDecodedListener() {
                    @Override
                    public void onHeaderDecoded(ImageDecoder decoder, ImageDecoder.ImageInfo info,
                                                ImageDecoder.Source s) {
                        // 强制软件解码, 避免硬件编码器不支持 HEIC 变体
                        decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                        // 防止超大图 OOM, 限制到 2048px 以内
                        int w = info.getSize().getWidth();
                        int h = info.getSize().getHeight();
                        int target = 2048;
                        if (w > target || h > target) {
                            float scale = Math.min((float) target / w, (float) target / h);
                            decoder.setTargetSize((int)(w * scale), (int)(h * scale));
                        }
                    }
                });
            } catch (Exception e) {
                // 回退到 BitmapFactory
            }
        }
        try {
            return BitmapFactory.decodeFile(file.getAbsolutePath());
        } catch (Exception e) {
            return null;
        }
    }
}
