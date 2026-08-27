package com.example.modeltracker;

import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate() 之前注册自定义插件,
        // 否则 bridge 在 super 内部 create() 时快照 PluginHeaders, 之后注册的插件不会进入 bridge
        registerPlugin(HeicConvert.class);
        registerPlugin(BackupScanner.class);
        registerPlugin(FilePicker.class);
        registerPlugin(Fullscreen.class);

        super.onCreate(savedInstanceState);

        // 禁用 WebView overscroll, 避免固定顶栏在滚动到底部时跳动
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
            }
        } catch (Exception e) {}
    }
}
