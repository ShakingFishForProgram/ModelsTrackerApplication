# 模型收藏（Model Tracker）

一个记录「已购买」和「想要（心愿）」手办模型的 Android 收藏管理 App。

## 技术栈

- **前端**：原生 HTML / CSS / JavaScript（`www/`），无框架
- **容器**：Capacitor 6（Android）
- **原生扩展**：手写 Java 插件（`android/app/src/main/java/com/example/modeltracker/`）

## 功能

- **模型收藏管理**：已买 / 未买（心愿）分类，记录名称、品牌、价格、购买日期、标签
- **图片**：多图管理、缩略图、全屏查看（双指缩放、拖动、双击、左右滑动切换）
- **手动拖拽排序**（全部 / 未买）
- **搜索**：按名称 / 标签搜索
- **数据备份**：导入 / 导出（含图片），备份到公共 Documents 目录
- **沉浸式全屏看图**：打开图片自动隐藏状态栏和底部导航栏

## 目录结构

```
model-tracker/
├── www/                     # 前端（App 全部界面与逻辑）
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── android/                 # 原生 Android 工程（Capacitor）
│   └── app/src/main/
│       ├── java/com/example/modeltracker/   # 手写插件
│       │   ├── MainActivity.java
│       │   ├── BackupScanner.java           # 备份导出/扫描/读取
│       │   ├── FilePicker.java              # 系统文件选择
│       │   ├── Fullscreen.java              # 沉浸式全屏
│       │   └── HeicConvert.java             # HEIC 转 JPEG
│       └── res/                             # 图标、样式、Manifest
├── capacitor.config.json    # Capacitor 配置
├── package.json             # Node 依赖
└── build-apk.ps1            # 打包脚本
```

## 环境要求

- Node.js（含 npm）
- JDK 21
- Android SDK
- Gradle 8.2.1

## 构建 APK

```bash
# 1. 安装依赖
npm install

# 2. 同步前端到 Android
npx cap sync android

# 3. 打包（build-apk.ps1 内部已配置 JAVA_HOME / gradle 路径）
powershell -ExecutionPolicy Bypass -File build-apk.ps1
```

打包产物：`android/app/build/outputs/apk/debug/app-debug.apk`

## 数据说明

- 数据与图片保存在 App 私有目录（`data.json` + `images/`）
- 导出备份文件格式：`model_checker_<时间>.json`，存放在公共 Documents 目录，卸载重装后可恢复
# ModelsTrackerApplication
