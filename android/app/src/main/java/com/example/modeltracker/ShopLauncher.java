package com.example.modeltracker;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URLEncoder;

@CapacitorPlugin(name = "ShopLauncher")
public class ShopLauncher extends Plugin {

    // 打开淘宝 / 拼多多 App 并搜索:
    // 1) 深链直达 App 搜索页 -> 2) 按包名把 App 拉起来 -> 3) 回退网页搜索
    @PluginMethod()
    public void openSearch(PluginCall call) {
        String platform = call.getString("platform", "taobao");
        String keyword = call.getString("keyword", "");
        if (keyword == null) keyword = "";
        String enc;
        try {
            // 空格用 %20, 避免部分 App 不识别 '+'
            enc = URLEncoder.encode(keyword, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            enc = keyword;
        }

        String deepLink, pkg, webUrl;
        if ("pinduoduo".equals(platform)) {
            // 与淘宝同理: 用网页域名当 host
            deepLink = "pinduoduo://mobile.yangkeduo.com/search_result.html?search_key=" + enc;
            pkg = "com.xunmeng.pinduoduo";
            webUrl = "https://mobile.yangkeduo.com/search_result.html?search_key=" + enc;
        } else {
            deepLink = "taobao://s.taobao.com/search?q=" + enc;
            pkg = "com.taobao.taobao";
            webUrl = "https://s.taobao.com/search?q=" + enc;
        }

        Context ctx = getContext();

        // 1) 深链直达 App 搜索页
        if (startView(ctx, deepLink)) { call.resolve(via("app")); return; }
        // 2) 按包名启动 App(至少进 App 首页)
        if (launchPackage(ctx, pkg)) { call.resolve(via("app-home")); return; }
        // 3) 没装 App -> 回退网页搜索
        if (startView(ctx, webUrl)) { call.resolve(via("web")); return; }

        call.reject("no-handler");
    }

    private JSObject via(String v) {
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("via", v);
        return r;
    }

    private boolean startView(Context ctx, String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean launchPackage(Context ctx, String pkg) {
        try {
            Intent i = ctx.getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) return false;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
