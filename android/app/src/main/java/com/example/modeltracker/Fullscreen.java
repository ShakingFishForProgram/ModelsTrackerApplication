package com.example.modeltracker;

import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import androidx.core.view.WindowCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 沉浸式全屏控制：
 * enter() 隐藏状态栏 + 底部导航栏（下滑可临时显示，几秒后自动隐藏）
 * exit()  恢复系统栏显示
 */
@CapacitorPlugin(name = "Fullscreen")
public class Fullscreen extends Plugin {

    private void hideBars(Window window, boolean hide) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = window.getInsetsController();
            if (c != null) {
                if (hide) {
                    c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    // 下滑临时显示系统栏，几秒后自动隐藏（图库同款效果）
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    c.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                }
            }
        } else {
            if (hide) {
                window.getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                | View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            } else {
                window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            }
        }
    }

    @PluginMethod()
    public void enter(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window window = getActivity().getWindow();
                    // 状态栏/导航栏透明: 全屏切换时系统栏区域透出 WebView 黑底, 不闪时间电量/白边
                    window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
                    window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
                    // 先让 WebView 铺满全屏（edge-to-edge），再隐藏系统栏，避免底部露白边
                    WindowCompat.setDecorFitsSystemWindows(window, false);
                    hideBars(window, true);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            }
        });
    }

    @PluginMethod()
    public void exit(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window window = getActivity().getWindow();
                    // 先恢复系统栏，再把 WebView 缩回系统栏之间，恢复普通页面布局
                    hideBars(window, false);
                    WindowCompat.setDecorFitsSystemWindows(window, true);
                    // 恢复状态栏/导航栏默认色(深蓝状态栏 + 黑导航栏)
                    window.setStatusBarColor(android.graphics.Color.parseColor("#1A3052"));
                    window.setNavigationBarColor(android.graphics.Color.BLACK);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            }
        });
    }
}
