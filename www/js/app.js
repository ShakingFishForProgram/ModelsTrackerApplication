(function () {
  "use strict";

  // ------------------------------------------------------------------
  // 环境判断
  // ------------------------------------------------------------------
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  var Filesystem = null;
  if (isNative) {
    try { Filesystem = window.Capacitor.Plugins.Filesystem; } catch (e) { Filesystem = null; }
  }
  var DATA_DIR = "DATA";
  var MAX_IMAGES = 30;

  // ------------------------------------------------------------------
  // 原生插件声明(确保 JS 端能桥接到手写的原生插件)
  // Capacitor 6: 用 Capacitor.registerPlugin 显式声明, 拿到的对象可直接调用 @PluginMethod 方法
  // ------------------------------------------------------------------
  function makeNativePlugin(name) {
    try {
      if (window.Capacitor && window.Capacitor.registerPlugin) {
        return window.Capacitor.registerPlugin(name);
      }
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) {
        return window.Capacitor.Plugins[name];
      }
    } catch (e) {}
    return null;
  }
  var BackupScannerPlugin = makeNativePlugin("BackupScanner");
  var HeicConvertPlugin = makeNativePlugin("HeicConvert");
  var FilePickerPlugin = makeNativePlugin("FilePicker");
  var FullscreenPlugin = makeNativePlugin("Fullscreen");

  // ------------------------------------------------------------------
  // 数据
  // ------------------------------------------------------------------
  var store = { list: [] };
  var imageCache = {};   // 图片 data URL 内存缓存(文件名 -> data URL)

  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    cardList: $("cardList"),
    emptyState: $("emptyState"),
    emptyText: $("emptyText"),
    countAll: $("countAll"),
    countBought: $("countBought"),
    countWish: $("countWish"),
    searchWrap: $("searchWrap"),
    searchInput: $("searchInput"),
    searchScope: $("searchScope"),
    btnSearchSubmit: $("btnSearchSubmit"),
    searchSug: $("searchSug"),
    btnSearch: $("btnSearch"),
    btnEdit: $("btnEdit"),
    editMenu: $("editMenu"),
    btnSort: $("btnSort"),
    btnExitSort: $("btnExitSort"),
    btnExport: $("btnExport"),
    btnImport: $("btnImport"),
    sortSelect: $("sortSelect"),
    tabs: document.querySelectorAll(".tab"),
    modalMask: $("modalMask"),
    modalTitle: $("modalTitle"),
    btnModalClose: $("btnModalClose"),
    inpName: $("inpName"),
    inpBrand: $("inpBrand"),
    btnAddBrand: $("btnAddBrand"),
    brandChips: $("brandChips"),
    kindBought: $("kindBought"),
    kindWish: $("kindWish"),
    priceGroup: $("priceGroup"),
    inpPrice: $("inpPrice"),
    dateGroup: $("dateGroup"),
    inpDate: $("inpDate"),
    imgGrid: $("imgGrid"),
    imgCount: $("imgCount"),
    inpTag: $("inpTag"),
    btnAddTag: $("btnAddTag"),
    tagChips: $("tagChips"),
    btnAddImg: $("btnAddImg"),
    fileInput: $("fileInput"),
    btnCancel: $("btnCancel"),
    btnSave: $("btnSave"),
    confirmMask: $("confirmMask"),
    confirmName: $("confirmName"),
    btnYes: $("btnYes"),
    btnNo: $("btnNo"),
    btnAdd: $("btnAdd"),
    bakMask: $("bakMask"),
    bakClose: $("bakClose"),
    bakEmpty: $("bakEmpty"),
    bakList: $("bakList"),
    exportMask: $("exportMask"),
    btnExportYes: $("btnExportYes"),
    btnExportNo: $("btnExportNo"),
    exportStatus: $("exportStatus"),
    exportDoneWrap: $("exportDoneWrap"),
    btnExportDone: $("btnExportDone"),
    importInput: $("importInput"),
    viewerMask: $("viewerMask"),
    viewerStage: $("viewerStage"),
    viewerImg: $("viewerImg"),
    viewerImg2: $("viewerImg2"),
    viewerTrack: $("viewerTrack"),
    detailView: $("detailView"),
    toast: $("toast"),
    alertMask: $("alertMask"),
    alertTitle: $("alertTitle"),
    alertText: $("alertText"),
    btnAlertOk: $("btnAlertOk")
  };

  var currentFilter = "all";
  var editingId = null;           // null=新增
  var pendingImages = [];         // 当前弹窗中待保存的图片 [{name(已存文件名)|null, base64|null}]
  var pendingTags = [];           // 当前弹窗中待保存的自定义标签
  var pendingBrands = [];         // 当前弹窗中待保存的品牌/厂商(多个)
  var deletingId = null;
  var viewingId = null;           // 当前查看详情中的 id
  var savedListScroll = 0;        // 进入详情前记录的列表滚动位置
  var savedSearchVisible = false; // 进入详情前搜索栏是否展开

  // ------------------------------------------------------------------
  // 工具
  // ------------------------------------------------------------------
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { ui.toast.classList.remove("show"); }, 1800);
  }
  function showAlert(msg, title) {
    if (!ui.alertMask) { toast(msg); return; }
    ui.alertText.textContent = msg;
    ui.alertTitle.textContent = title || "提示";
    ui.alertMask.classList.remove("hidden");
  }
  function getKind() {
    return ui.kindBought.classList.contains("active") ? "bought" : "wish";
  }
  function setKind(kind) {
    ui.kindBought.classList.toggle("active", kind === "bought");
    ui.kindWish.classList.toggle("active", kind === "wish");
    ui.priceGroup.classList.toggle("hidden", kind !== "bought");
    ui.dateGroup.classList.toggle("hidden", kind !== "bought");
  }

  // ------------------------------------------------------------------
  // 存储层
  // ------------------------------------------------------------------
  var storage = {
    async init() {
      if (!isNative) {
        try {
          var raw = localStorage.getItem("model_tracker_data");
          if (raw) store.list = JSON.parse(raw);
        } catch (e) {}
        return;
      }
      await this.ensureImageDir();
      try {
        var r = await Filesystem.readFile({ path: "data.json", directory: DATA_DIR, encoding: "utf8" });
        var list = JSON.parse(r.data);
        // 归一化任意版本的数据, 保证兼容
        store.list = normalizeList(list);
      } catch (e) {
        store.list = [];
      }
    },

    async save() {
      if (!isNative) {
        try { localStorage.setItem("model_tracker_data", JSON.stringify(store.list)); } catch (e) {}
        return;
      }
      try {
        await Filesystem.writeFile({
          path: "data.json", directory: DATA_DIR, data: JSON.stringify(store.list), encoding: "utf8", recursive: true
        });
      } catch (e) {
        try {
          await Filesystem.writeFile({
            path: "data.json", directory: DATA_DIR, data: JSON.stringify(store.list), encoding: "utf8"
          });
        } catch (e2) { console.error("save data failed", e2); }
      }
    },

    // ---------- 图片存储: 私有目录文件 + convertFileSrc 显示 ----------
    async ensureImageDir() {
      try { await Filesystem.mkdir({ path: "images", directory: DATA_DIR, recursive: true }); } catch (e) {}
    },

    // dataUrl(原始data URL) -> 存为私有目录文件, 写入后回读校验, 失败自动重写, 确保数据完整
    async saveImage(dataUrl) {
      var ext = "jpg";
      var m = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64/);
      if (m) ext = m[1].replace(/[^a-zA-Z0-9]/g, "") || "jpg";
      var pure = dataUrl.indexOf(",") >= 0 ? dataUrl.split(",")[1] : dataUrl;
      if (!pure || pure.length < 30) return null;

      for (var attempt = 0; attempt < 3; attempt++) {
        var name = "img_" + genId() + "." + ext;
        try {
          await Filesystem.writeFile({ path: "images/" + name, directory: DATA_DIR, data: pure });
          // 回读校验
          var check = await Filesystem.readFile({ path: "images/" + name, directory: DATA_DIR });
          var cb = check ? check.data : "";
          if (cb === pure) {
            // 数据完整: 生成小缩略图, 加速列表/启动加载
            try {
              var thumb = await tryToJpeg(dataUrl, 128, 0.7);
              if (thumb) {
                var thumbPure = thumb.indexOf(",") >= 0 ? thumb.split(",")[1] : thumb;
                var thumbName = name.replace(/\.[^.]+$/, "") + "_thumb.jpg";
                await Filesystem.writeFile({ path: "images/" + thumbName, directory: DATA_DIR, data: thumbPure });
              }
            } catch (e) {}
            return name;
          }
          // 数据不一致 -> 删除, 下次循环重写新文件
          try { await Filesystem.deleteFile({ path: "images/" + name, directory: DATA_DIR }); } catch (e2) {}
          // 记录诊断
          window.__imgDiag = (window.__imgDiag||"") + " 重写(w=" + pure.length + ",r=" + cb.length + ");";
        } catch (e) {
          // 写入异常, 重试
        }
      }
      return null;
    },

    async deleteImage(name) {
      if (!name) return;
      try { await Filesystem.deleteFile({ path: "images/" + name, directory: DATA_DIR }); } catch (e) {}
      // 同时删除缩略图
      try {
        var thumbName = name.replace(/\.[^.]+$/, "") + "_thumb.jpg";
        await Filesystem.deleteFile({ path: "images/" + thumbName, directory: DATA_DIR });
      } catch (e) {}
    },

    // 文件名或内联dataURL -> 可显示的 data URL
    // 兼容两种数据格式: 以 data: 开头的直接用; 否则当作文件名 readFile 读取
    async imageUrl(name) {
      if (!name) return null;
      // 兼容旧版本内联存储: images 元素本身是 data URL
      if (name.indexOf("data:image/") === 0 || name.indexOf("data:") === 0) {
        return name;
      }
      // 内存缓存命中, 直接返回, 避免重复原生 readFile
      if (imageCache[name]) return imageCache[name];
      try {
        var r = await Filesystem.readFile({ path: "images/" + name, directory: DATA_DIR });
        var raw = r ? r.data : null;
        if (!raw) return null;

        // 兼容已带 data: 前缀
        var b64 = raw.indexOf("data:") === 0 ? raw.slice(raw.indexOf(",") + 1) : raw;

        // 内容头检测: jpeg=/9j/, png=iVBORw0K, gif=R0lGOD, webp=UklGR
        var headOk = b64.indexOf("/9j/") === 0 || b64.indexOf("iVBORw0KG") === 0 ||
                     b64.indexOf("R0lGOD") === 0 || b64.indexOf("UklGR") === 0;
        if (!headOk) {
          window.__imgDiag = (window.__imgDiag||"") + " corrupt[" + (b64.slice(0,12)) + " len=" + b64.length + "];";
          return null;
        }

        var ext = (name.split(".").pop() || "jpg").toLowerCase();
        var mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" }[ext] || "image/jpeg";
        var url = "data:" + mime + ";base64," + b64;
        imageCache[name] = url;
        return url;
      } catch (e) {
        return null;
      }
    },

    // 列表/启动用的小缩略图: 优先读 _thumb 小图, 失败回退原图
    async thumbUrl(name) {
      if (!name) return null;
      if (name.indexOf("data:") === 0) return name;
      var thumbName = name.replace(/\.[^.]+$/, "") + "_thumb.jpg";
      var cacheKey = "thumb:" + name;
      if (imageCache[cacheKey]) return imageCache[cacheKey];
      try {
        var r = await Filesystem.readFile({ path: "images/" + thumbName, directory: DATA_DIR });
        var raw = r ? r.data : null;
        if (raw) {
          var b64 = raw.indexOf("data:") === 0 ? raw.slice(raw.indexOf(",") + 1) : raw;
          var url = "data:image/jpeg;base64," + b64;
          imageCache[cacheKey] = url;
          return url;
        }
      } catch (e) {}
      // 无缩略图(旧数据), 回退读原图
      return this.imageUrl(name);
    },

    // ---------- 备份 / 恢复 ----------
    // 备份到公共 Documents 目录 (卸载 APP 后文件仍在, 重装可恢复)
    // 方案3: 完全由原生流式生成备份(含图片base64分块编码), 不经过 JS 大字符串, 彻底避免 OOM 闪退
    async exportBackup() {
      var publicName = genBackupName();
      var bs = BackupScannerPlugin;
      if (bs && bs.exportToDocuments) {
        var r = await bs.exportToDocuments({ publicName: publicName });
        if (r && r.name) return r.name;
        throw new Error("导出未返回文件名");
      }
      // 原生插件不可用
      throw new Error("当前环境不支持原生导出");
    },

    // 列出备份文件(model_checker_*.json), 优先用原生 MediaStore 扫描(重装后也能看到), 失败则回退 Capacitor readdir
    async listBackups() {
      var out = [];
      var bs = BackupScannerPlugin;
      if (bs && bs.scan) {
        try {
          var rr = await bs.scan();
          if (rr && rr.files && rr.files.length) {
            for (var i = 0; i < rr.files.length; i++) {
              var n = rr.files[i];
              if (typeof n === "object" && n != null) out.push(n.name);
              else out.push(n);
            }
            return out;
          }
        } catch (e) {}
      }
      // 兜底: Capacitor readdir(Documents)
      try {
        var r = await Filesystem.readdir({ path: "", directory: "DOCUMENTS" });
        (r.files || []).forEach(function (f) {
          if (f.name && f.name.indexOf("model_checker_") === 0) out.push(f.name);
        });
      } catch (e) {}
      return out;
    },

    // 从指定备份文件恢复: fileName 是 Documents 下的 json
    async importBackup(fileName) {
      var json = null;
      // 优先用原生 MediaStore 读取(重装后也能读到公共目录文件)
      var bs = BackupScannerPlugin;
      if (bs && bs.read) {
        try {
          var rr = await bs.read({ name: fileName });
          if (rr && rr.content) json = rr.content;
        } catch (e) {}
      }
      // 原生失败则回退 Capacitor readFile
      if (json == null) {
        var r = await Filesystem.readFile({ path: fileName, directory: "DOCUMENTS", encoding: "utf8" });
        json = r.data;
      }
      return this.importFromJson(json);
    },

    // 从已读取到的 JSON 字符串恢复记录与图片
    async importFromJson(json) {
      var backup = JSON.parse(json);
      if (!backup || !backup.list) throw new Error("bad backup");

      // 恢复图片文件
      var imgNames = Object.keys(backup.images || {});
      for (var i = 0; i < imgNames.length; i++) {
        try {
          await Filesystem.writeFile({ path: "images/" + imgNames[i], directory: DATA_DIR, data: backup.images[imgNames[i]] });
        } catch (e) {}
      }
      // 恢复记录
      store.list = normalizeList(backup.list);
      await this.save();
      return store.list.length;
    }
  };

  // 品牌字段兼容: 旧版为字符串, 新版为字符串数组
  function normalizeBrands(b) {
    if (Array.isArray(b)) return b.filter(function (x) { return typeof x === "string" && x.length > 0; });
    if (typeof b === "string" && b.length > 0) return [b];
    return [];
  }

  // 归一化任意版本的数据, 确保字段完整、可正确渲染(跨版本兼容)
  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (it) {
      if (!it || typeof it !== "object") return null;
      var r = {
        id: it.id || genId(),
        name: typeof it.name === "string" ? it.name : "",
        brand: normalizeBrands(it.brand),
        kind: it.kind === "bought" ? "bought" : "wish",
        price: (it.kind === "bought" && it.price != null) ? it.price : null,
        date: typeof it.date === "string" ? it.date : "",
        images: Array.isArray(it.images) ? it.images : [],
        tags: Array.isArray(it.tags) ? it.tags.filter(function (t) { return typeof t === "string" && t.length > 0; }) : [],
        createdAt: it.createdAt || 0,
        sortOrder: (typeof it.sortOrder === "number") ? it.sortOrder : null
      };
      // 图片数组过滤: 保留非空字符串(文件名或内联dataURL)
      r.images = r.images.filter(function (x) { return typeof x === "string" && x.length > 0; });
      return r;
    }).filter(Boolean);
  }

  // 生成备份文件名: model_checker_年-月-日_时-分-秒.json
  function genBackupName() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return "model_checker_" +
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".json";
  }

  // ------------------------------------------------------------------
  // 图片处理：先按规则压缩，不支持(canvas失败/heic等)则回退原始图
  // ------------------------------------------------------------------
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      var timer = setTimeout(function () {
        reader.abort();
        reject(new Error("file-timeout"));
      }, 15000);
      reader.onload = function (e) { clearTimeout(timer); resolve(e.target.result); };
      reader.onerror = function () { clearTimeout(timer); reject(new Error("file-read-fail")); };
      reader.readAsDataURL(file);
    });
  }

  // 尝试 canvas 压缩/转码为 JPEG; 返回 null 表示失败
  function tryToJpeg(dataUrl, maxW, quality) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; img.onload = img.onerror = null; resolve(null); }
      }, 15000);
      img.onload = function () {
        if (done) return; done = true; clearTimeout(timer);
        try {
          var w = img.width, h = img.height;
          if (!w || !h) { resolve(null); return; }
          var scale = w > maxW ? maxW / w : 1;
          var tw = Math.max(1, Math.floor(w * scale));
          var th = Math.max(1, Math.floor(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = tw; canvas.height = th;
          var ctx = canvas.getContext("2d");
          // 铺白色底，避免透明 PNG 变黑
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, tw, th);
          ctx.drawImage(img, 0, 0, tw, th);
          var out = canvas.toDataURL("image/jpeg", quality);
          resolve(out && out.length > 50 ? out : null);
        } catch (e) { resolve(null); }
      };
      img.onerror = function () {
        if (done) return; done = true; clearTimeout(timer); resolve(null);
      };
      img.src = dataUrl;
    });
  }

  // 判断 base64 内容是否为 HEIC/HEIF (文件头 ftyp heic/mif1/heix/hevc/heve/avif)
  function isHeicBase64(body) {
    // JPEG=/9j/ PNG=iVBORw0KG GIF=R0lGOD WebP=UklGR → 不是 HEIC
    if (body.indexOf("/9j/") === 0 || body.indexOf("iVBORw0KG") === 0 ||
        body.indexOf("R0lGOD") === 0 || body.indexOf("UklGR") === 0) {
      return false;
    }
    // HEIC/HEIF: base64 解出含 "ftyp" + (heic|heix|mif1|hevc|heve|avif)
    // 特征前缀常见 "AAAAGGZ0eXBo..." (AAB=0, GZ0eXBo... = \0\0\0xxftyp...)
    return body.indexOf("Z0eXBo") !== -1 || body.indexOf("Z0eXBq") !== -1 ||
           body.indexOf("Z0eXBtaWYx") !== -1 || body.indexOf("Z0eXBoZWl4") !== -1 ||
           body.indexOf("Z0eXBoZWlj") !== -1 || body.indexOf("Z0eXBoZWlj") !== -1 ||
           body.indexOf("Z0eXBhdmlm") !== -1;
  }

  // 处理单张图片: 读回 data URL, 若内容是 HEIC 则用原生转成 JPEG, 否则原样返回
  async function processImage(file, maxW, quality, index) {
    var dataUrl = await readFileAsDataURL(file);
    if (!dataUrl || dataUrl.length < 50) throw new Error("no-data");

    var body = dataUrl.indexOf(",") >= 0 ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;

    if (isHeicBase64(body)) {
      // HEIC → 原生转 JPEG
      window.__imgDiag = (window.__imgDiag||"") + " heic;" + (index+1) + ";";
      var conv = await tryNativeHeicToJpeg(dataUrl, file);
      if (conv && conv.data) return conv;
      window.__imgDiag = (window.__imgDiag||"") + " heicconvfail;";
      throw new Error("heic-convert-fail");
    }

    return { data: dataUrl, src: "raw", raw: dataUrl.length };
  }

  // 用原生 HeicConvert 把 base64 图片转成 JPEG data URL
  async function tryNativeHeicToJpeg(dataUrl, file) {
    try {
      var heic = HeicConvertPlugin;
      if (!heic) { window.__imgDiag = (window.__imgDiag||"") + " noplugin;"; return null; }
      var tmpName = "tmp_" + genId() + ".heic";
      var pure = dataUrl.indexOf(",") >= 0 ? dataUrl.split(",")[1] : dataUrl;
      await Filesystem.writeFile({ path: "images/" + tmpName, directory: DATA_DIR, data: pure });
      // 原生转码 -> 返回 { name, size }
      var r = await heic.toJpeg({ file: "images/" + tmpName });
      // 清理临时 HEIC 文件
      try { await Filesystem.deleteFile({ path: "images/" + tmpName, directory: DATA_DIR }); } catch (e) {}
      if (r && r.name) {
        var url = await storage.imageUrl(r.name.replace("images/", ""));
        // 清理转码产生的 conv_ 中间文件(JPEG data URL 已读回, 不再需要它)
        try { await Filesystem.deleteFile({ path: r.name, directory: DATA_DIR }); } catch (e) {}
        if (url) return { data: url, src: "native(" + (r.size||0) + ")" };
        window.__imgDiag = (window.__imgDiag||"") + " nativereadfail:" + r.name + ";";
      } else {
        window.__imgDiag = (window.__imgDiag||"") + " nativeret:" + JSON.stringify(r) + ";";
      }
      return null;
    } catch (e) {
      window.__imgDiag = (window.__imgDiag||"") + " nativeerr:" + (e&&e.message||e) + ";";
      return null;
    }
  }

  // 用 createImageBitmap(Blob) 解码(对 HEIC 更友好), 画到 canvas 转成 JPEG data URL
  function tryBitmapToJpeg(file, maxW, quality) {
    return new Promise(function (resolve) {
      if (typeof window.createImageBitmap !== "function") { resolve(null); return; }
      // createImageBitmap 对 Blob 支持最稳; File 是 Blob 子类, 直接用 file
      window.createImageBitmap(file).then(function (bmp) {
        try {
          var w = bmp.width, h = bmp.height;
          if (!w || !h) { if (bmp.close) bmp.close(); resolve(null); return; }
          var scale = w > maxW ? maxW / w : 1;
          var tw = Math.max(1, Math.floor(w * scale));
          var th = Math.max(1, Math.floor(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = tw; canvas.height = th;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, tw, th);
          ctx.drawImage(bmp, 0, 0, tw, th);
          if (bmp.close) bmp.close();
          var out = canvas.toDataURL("image/jpeg", quality);
          if (out && out.length > 50) resolve({ data: out, src: "bitmap" });
          else resolve(null);
        } catch (e) {
          if (bmp && bmp.close) bmp.close();
          resolve(null);
        }
      }, function () { resolve(null); });
    });
  }

  // 生成一个灰色小占位 JPEG
  function makePlaceholder() {
    var c = document.createElement("canvas");
    c.width = 300; c.height = 300;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#e8ecf2"; ctx.fillRect(0, 0, 300, 300);
    return c.toDataURL("image/jpeg", 0.9);
  }

  // 图片加载失败时的固定占位图(灰色底, 内置"图片不可用")
  // 挂到 window 供内联 onerror 使用
  window.IMG_FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
    '<rect width="100%" height="100%" fill="#e8ecf2"/>' +
    '<text x="150" y="148" font-size="60" text-anchor="middle" fill="#9aa3b2">🖼️</text>' +
    '<text x="150" y="190" font-size="22" text-anchor="middle" fill="#9aa3b2">图片不可用</text>' +
    '</svg>'
  );

  // 图片项即文件名, 直接返回数组(过滤掉空/非字符串)
  function validImages(it) {
    if (!it || !Array.isArray(it.images)) return [];
    return it.images.filter(function (v) { return typeof v === "string" && v.length > 0; });
  }

  // ------------------------------------------------------------------
  // 排序
  // ------------------------------------------------------------------
  function getSort() { return ui.sortSelect.value; }

  // 已买词条的新→旧规则: 先看日期(新日期在上), 同日期看添加时间(新添加上)
  function byDateThenCreated(a, b) {
    var da = a.date || "";
    var db = b.date || "";
    if (da !== db) return db.localeCompare(da);
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  function sortRecords(arr) {
    // 已买: 按用户选择的排序(时间/价格); 全部/未买: 按添加时间(新→旧)
    var s = currentFilter === "bought" ? getSort() : "time";
    return arr.slice().sort(function (a, b) {
      if (currentFilter === "bought") {
        if (s === "priceAsc" || s === "priceDesc") {
          var pa = (a.price != null && a.price !== "") ? parseFloat(a.price) : Infinity;
          var pb = (b.price != null && b.price !== "") ? parseFloat(b.price) : Infinity;
          if (pa !== pb) {
            if (s === "priceAsc") return pa - pb;
            return pb - pa;
          }
          // 同价格按新→旧(日期→添加时间)
          return byDateThenCreated(a, b);
        }
        // 已买"时间"排序: 日期新→旧, 同日期添加时间新→旧
        return byDateThenCreated(a, b);
      }
      // 全部/未买: 有 sortOrder 的按手动顺序排上面, 没有的按添加时间(新→旧)排下面
      var aHas = typeof a.sortOrder === "number";
      var bHas = typeof b.sortOrder === "number";
      if (aHas && bHas) return a.sortOrder - b.sortOrder;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  // ============ 手动排序（拖拽） ============
  var sortMode = false;
  var sortItems = [];
  var sortPrevSearchVisible = false;
  var dragState = { active: false, id: null, el: null, startY: 0, clientY: 0, fromIndex: 0, targetIndex: 0, step: 0, grabOffset: 0, startTop: 0, scrollComp: 0, autoScrollDir: 0, autoScrolling: false, longPressTimer: null, debounceTimer: null };
  var shiftMap = {};

  function enterSortMode() {
    sortMode = true;
    sortPrevSearchVisible = ui.searchWrap ? !ui.searchWrap.classList.contains("hidden") : false;
    if (ui.editMenu) ui.editMenu.classList.add("hidden");
    if (ui.btnSearch) ui.btnSearch.classList.add("hidden");
    if (ui.btnEdit) ui.btnEdit.classList.add("hidden");
    if (ui.btnExitSort) ui.btnExitSort.classList.remove("hidden");
    var sw = document.getElementById("searchWrap");
    var tb = document.getElementById("toolbar");
    if (sw) sw.classList.add("hidden");
    if (tb) tb.classList.add("hidden");
    currentFilter = "all";
    ui.tabs.forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-filter") === "all"); });
    renderList();
    refreshTopBar();
  }

  function exitSortMode() {
    sortMode = false;
    sortItems = [];
    if (ui.btnSearch) ui.btnSearch.classList.remove("hidden");
    if (ui.btnEdit) ui.btnEdit.classList.remove("hidden");
    if (ui.btnExitSort) ui.btnExitSort.classList.add("hidden");
    var tb = document.getElementById("toolbar");
    if (tb) tb.classList.remove("hidden");
    var sw = document.getElementById("searchWrap");
    if (sw) sw.classList.toggle("hidden", !sortPrevSearchVisible);
    renderList();
    refreshTopBar();
    storage.save();
  }

  function bindDragEvents(card, it, items) {
    card.addEventListener("touchstart", function (e) {
      if (!sortMode) return;
      var t = e.touches[0];
      dragState.startY = t.clientY;
      dragState.clientY = t.clientY;
      dragState.id = it.id;
      dragState.el = card;
      dragState.fromIndex = indexOfItem(items, it.id);
      dragState.targetIndex = dragState.fromIndex;
      dragState.longPressTimer = setTimeout(function () {
        dragState.active = true;
        dragState.el.classList.add("dragging");
        dragState.el.style.zIndex = 100;
        // 新拖拽开始, 清理累计位移 + 记录基准
        shiftMap = {};
        dragState.scrollComp = 0;
        dragState.autoScrollDir = 0;
        dragState.autoScrolling = false;
        var rect = dragState.el.getBoundingClientRect();
        dragState.startTop = rect.top;
        dragState.grabOffset = dragState.clientY - rect.top;
        // 计算卡片间距(高度 + gap), 让位移动用
        var allCards = ui.cardList.querySelectorAll(".card");
        if (allCards.length >= 2) {
          dragState.step = allCards[1].getBoundingClientRect().top - allCards[0].getBoundingClientRect().top;
        } else {
          dragState.step = dragState.el.offsetHeight + 12;
        }
      }, 300);
    }, { passive: true });

    card.addEventListener("touchmove", function (e) {
      if (!sortMode) return;
      if (!dragState.active) {
        var t = e.touches[0];
        if (Math.abs(t.clientY - dragState.startY) > 10) {
          clearTimeout(dragState.longPressTimer);
        }
        return;
      }
      e.preventDefault();
      var t = e.touches[0];
      dragState.clientY = t.clientY;
      // dragEl 跟随手指(clamp 到列表范围), 含滚动补偿
      updateDragTransform();
      // 边缘检测 + 自动滚动
      updateAutoScroll(t.clientY);
      var newTarget = detectTargetIndex(t.clientY);
      if (newTarget !== dragState.targetIndex) {
        dragState.targetIndex = newTarget;
        clearTimeout(dragState.debounceTimer);
        dragState.debounceTimer = setTimeout(function () { applyLiveReorder(); }, 500);
      }
    }, { passive: false });

    function endDrag() {
      clearTimeout(dragState.longPressTimer);
      clearTimeout(dragState.debounceTimer);
      if (!dragState.active) return;
      dragState.active = false;
      dragState.autoScrollDir = 0;
      dragState.autoScrolling = false;
      applyDragResult();       // 先算落点(让位布局还在, 避免向下插偏一格)
      resetCardTransforms();   // 再清动画(renderList 已重建 DOM, 这里兜底)
    }
    card.addEventListener("touchend", endDrag);
    card.addEventListener("touchcancel", endDrag);
  }

  function updateAutoScroll(clientY) {
    var topEdge = 120;
    var bottomEdge = window.innerHeight - 80;
    if (clientY > bottomEdge) {
      dragState.autoScrollDir = 1;
    } else if (clientY < topEdge) {
      dragState.autoScrollDir = -1;
    } else {
      dragState.autoScrollDir = 0;
    }
    if (dragState.autoScrollDir !== 0 && !dragState.autoScrolling) {
      dragState.autoScrolling = true;
      autoScrollLoop();
    }
  }

  function autoScrollLoop() {
    if (!dragState.active || dragState.autoScrollDir === 0) {
      dragState.autoScrolling = false;
      return;
    }
    var before = window.pageYOffset || 0;
    var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    var target;
    if (dragState.autoScrollDir > 0) {
      target = Math.min(before + 12, maxScroll);
    } else {
      target = Math.max(0, before - 12);
    }
    window.scrollTo(0, target);
    var after = window.pageYOffset || 0;
    var deltaScroll = after - before;
    if (deltaScroll !== 0) {
      dragState.scrollComp += deltaScroll;
      updateDragTransform();
      var newTarget = detectTargetIndex(dragState.clientY);
      if (newTarget !== dragState.targetIndex) {
        dragState.targetIndex = newTarget;
        clearTimeout(dragState.debounceTimer);
        dragState.debounceTimer = setTimeout(function () { applyLiveReorder(); }, 500);
      }
    }
    requestAnimationFrame(autoScrollLoop);
  }

  function updateDragTransform() {
    if (!dragState.el) return;
    var targetTop = dragState.clientY - dragState.grabOffset;
    var currentTop = dragState.startTop - dragState.scrollComp;
    // clamp: 最多拖到最后一个词条下面一个词条高度, 最少拖到第一个词条上面一个词条高度
    var cards = ui.cardList.querySelectorAll(".card:not(.dragging)");
    if (cards.length > 0) {
      var firstRect = cards[0].getBoundingClientRect();
      var lastRect = cards[cards.length - 1].getBoundingClientRect();
      var minTop = firstRect.top - dragState.el.offsetHeight;
      var maxTop = lastRect.bottom + dragState.el.offsetHeight;
      targetTop = Math.max(minTop, Math.min(targetTop, maxTop));
    }
    dragState.el.style.transform = "translateY(" + (targetTop - currentTop) + "px)";
  }

  function indexOfItem(items, id) {
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) return i; }
    return -1;
  }

  function detectTargetIndex(clientY) {
    var cards = ui.cardList.querySelectorAll(".card:not(.dragging)");
    var target = 0;
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) { target = i; break; }
      target = i + 1;
    }
    return target;
  }

  // 实时让位: 只让其他卡片 transform 让位(累计位移), 被拖拽卡片保持跟随手指, 松手后再落位
  function applyLiveReorder() {
    var fromIndex = dragState.fromIndex;
    var toIndex = dragState.targetIndex;
    if (toIndex === fromIndex) return;
    var dragEl = dragState.el;
    var step = dragState.step || (dragEl.offsetHeight + 12);

    var moved = sortItems.splice(fromIndex, 1)[0];
    sortItems.splice(toIndex, 0, moved);
    sortItems.forEach(function (it, idx) { it.sortOrder = idx; });

    var otherItems = sortItems.filter(function (it) { return it.id !== dragState.id; });
    var lo = Math.min(fromIndex, toIndex);
    var hi = Math.max(fromIndex, toIndex);
    var dir = fromIndex < toIndex ? -1 : 1;

    // 累计位移: 让位范围内的卡片, 追加移动(已让位的保持不动)
    otherItems.forEach(function (it, idx) {
      if (idx >= lo && idx < hi) {
        shiftMap[it.id] = (shiftMap[it.id] || 0) + dir * step;
      }
    });

    ui.cardList.querySelectorAll(".card").forEach(function (c) {
      if (c === dragEl) return;
      var id = c.getAttribute("data-id");
      var shift = shiftMap[id] || 0;
      c.style.transition = "transform 0.2s ease";
      c.style.transform = shift !== 0 ? ("translateY(" + shift + "px)") : "";
    });

    dragState.fromIndex = toIndex;
  }

  function resetCardTransforms() {
    ui.cardList.querySelectorAll(".card").forEach(function (c) {
      c.style.transition = "";
      c.style.transform = "";
      c.style.zIndex = "";
      c.classList.remove("dragging");
    });
  }

  function applyDragResult() {
    // 松手时重新计算: 不依赖让位累积的 fromIndex/targetIndex, 避免落位错
    var id = dragState.id;
    var fromIndex = indexOfItem(sortItems, id);
    if (fromIndex < 0) { renderList(); storage.save(); return; }
    var toIndex = detectTargetIndex(dragState.clientY);
    if (toIndex !== fromIndex) {
      var moved = sortItems.splice(fromIndex, 1)[0];
      sortItems.splice(toIndex, 0, moved);
      sortItems.forEach(function (it, idx) { it.sortOrder = idx; });
    }
    renderList();
    storage.save();
  }

  // 按当前筛选更新排序控件的显隐（仅"已买"Tab显示排序）
  function updateSortVisibility() {
    var sw = document.getElementById("sortWrap");
    if (sw) sw.classList.toggle("hidden", currentFilter !== "bought");
    refreshTopBar();
  }

  // UI 状态持久化: 记住搜索方式/当前tab/排序选择, 杀进程重启保持
  var UI_STATE_KEY = "mt_ui_state";
  function saveUiState() {
    try {
      var st = {
        scope: ui.searchScope ? ui.searchScope.value : "all",
        filter: currentFilter,
        sort: ui.sortSelect ? ui.sortSelect.value : "time"
      };
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(st));
    } catch (e) {}
  }
  function loadUiState() {
    try {
      var raw = localStorage.getItem(UI_STATE_KEY);
      if (!raw) return;
      var st = JSON.parse(raw);
      // scope 不恢复, 冷启动默认回到"全部", 避免按"名称"搜索时搜不到品牌/标签
      if (st.sort && ui.sortSelect) ui.sortSelect.value = st.sort;
      if (st.filter === "all" || st.filter === "bought" || st.filter === "wish") {
        currentFilter = st.filter;
        ui.tabs.forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-filter") === st.filter); });
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------
  // 列表渲染
  // ------------------------------------------------------------------
  function filteredList() {
    var kw = ui.searchInput.value.trim().toLowerCase();
    var scope = ui.searchScope ? ui.searchScope.value : "all";
    return store.list.filter(function (it) {
      var ok = currentFilter === "all" || it.kind === currentFilter;
      if (!ok) return false;
      if (kw) {
        var nameHit = (it.name || "").toLowerCase().indexOf(kw) >= 0;
        var brandHit = (it.brand || []).some(function (b) {
          return String(b || "").toLowerCase().indexOf(kw) >= 0;
        });
        var tagHit = (it.tags || []).some(function (t) {
          return String(t || "").toLowerCase().indexOf(kw) >= 0;
        });
        var hit;
        if (scope === "name") hit = nameHit;
        else if (scope === "tag") hit = brandHit || tagHit;
        else hit = nameHit || brandHit || tagHit;
        if (!hit) return false;
      }
      return true;
    });
  }

  // 搜索提示: 统计匹配关键词的 brand/tag 数量, 按数量降序
  function buildSuggestions(kw) {
    var kwLower = kw.trim().toLowerCase();
    if (!kwLower) return [];
    var counter = {};
    store.list.forEach(function (it) {
      var keys = [];
      (it.brand || []).forEach(function (b) { keys.push(String(b)); });
      (it.tags || []).forEach(function (t) { keys.push(String(t)); });
      var seen = {};
      keys.forEach(function (k) {
        if (!k || seen[k]) return;
        seen[k] = true;
        if (k.toLowerCase().indexOf(kwLower) >= 0) {
          counter[k] = (counter[k] || 0) + 1;
        }
      });
    });
    var arr = [];
    Object.keys(counter).forEach(function (k) { arr.push({ text: k, count: counter[k] }); });
    arr.sort(function (a, b) { return b.count - a.count; });
    return arr;
  }

  function renderSuggestions() {
    var box = ui.searchSug;
    if (!box) return;
    box.innerHTML = "";
    var kw = ui.searchInput ? ui.searchInput.value.trim() : "";
    if (!kw) { box.classList.add("hidden"); return; }
    var sugs = buildSuggestions(kw);
    if (sugs.length === 0) { box.classList.add("hidden"); return; }
    sugs.slice(0, 20).forEach(function (s) {
      var item = document.createElement("button");
      item.className = "search-sug-item";
      item.type = "button";
      item.textContent = s.text;
      item.addEventListener("click", function () {
        ui.searchInput.value = s.text;
        if (ui.searchScope) ui.searchScope.value = "all";
        renderSuggestions();
        renderList();
      });
      box.appendChild(item);
    });
    box.classList.remove("hidden");
  }

  function updateCounts() {
    var b = store.list.filter(function (i) { return i.kind === "bought"; }).length;
    var w = store.list.filter(function (i) { return i.kind === "wish"; }).length;
    ui.countAll.textContent = store.list.length;
    ui.countBought.textContent = b;
    ui.countWish.textContent = w;
  }

  function renderList() {
    updateSortVisibility();
    updateCounts();
    var items = sortRecords(filteredList());
    if (sortMode) sortItems = items;
    ui.cardList.innerHTML = "";

    if (items.length === 0) {
      ui.emptyState.classList.remove("hidden");
      if (store.list.length === 0) ui.emptyText.textContent = "还没有记录，点下方 ＋ 添加第一个模型吧";
      else if (currentFilter === "bought") ui.emptyText.textContent = "已买列表为空";
      else if (currentFilter === "wish") ui.emptyText.textContent = "未买(心愿单)列表为空";
      else ui.emptyText.textContent = "没有找到匹配的记录";
      return;
    }
    ui.emptyState.classList.add("hidden");

    items.forEach(function (it) {
      var card = document.createElement("div");
      card.className = "card";
      card.setAttribute("data-id", it.id);

      var vImgs = validImages(it);
      var hasImg = vImgs.length > 0;
      var thumbHtml = hasImg
        ? '<div class="card-thumb"><img data-idx="0" alt="" onerror="this.onerror=null;this.src=window.IMG_FALLBACK;"></div>'
        : '<div class="card-thumb">📦</div>';

      var badge = it.kind === "bought" ? '<span class="badge bought">已买</span>' : '<span class="badge wish">心愿</span>';

      var meta = '';
      if (it.kind === "bought") {
        if (it.price != null && it.price !== "") {
          meta += '<span class="price">' + esc(it.price) + '元</span>';
        }
        if (it.date) meta += '<span class="date">' + esc(it.date) + '</span>';
      }

      var brandHtml = (it.brand && it.brand.length)
        ? '<div class="card-brand">' + esc(it.brand.join("/")) + '</div>' : '';

      var metaHtml = meta
        ? '<div class="card-meta">' + meta + '</div>' : '';

      card.innerHTML = thumbHtml +
        '<div class="card-info">' +
          '<div class="card-name">' + esc(it.name) + '</div>' +
          brandHtml +
          metaHtml +
        '</div>' +
        '<span class="card-status">' + badge + '</span>';

      card.addEventListener("click", function () { if (!sortMode) openDetail(it.id, true); });
      if (sortMode) bindDragEvents(card, it, items);
      ui.cardList.appendChild(card);

      // 封面缩略图: 异步取小缩略图 URL(失败回退原图)
      if (hasImg && vImgs[0]) {
        var t0 = card.querySelector('img[data-idx="0"]');
        if (t0) storage.thumbUrl(vImgs[0]).then(function (u) { if (u) t0.src = u; });
      }
    });
  }

  // ------------------------------------------------------------------
  // 详情（淘宝式）
  // ------------------------------------------------------------------

  // 进入详情: 隐藏列表工具条(筛选/排序/搜索/悬浮按钮, 顶栏保留标题)
  function enterDetailView(isEnter) {
    var tb = document.getElementById("toolbar");
    var sw = document.getElementById("searchWrap");
    var fab = document.getElementById("btnAdd");
    if (tb) tb.classList.toggle("hidden", isEnter);
    if (sw && isEnter) sw.classList.add("hidden");
    if (fab) fab.classList.toggle("hidden", isEnter);
    refreshTopBar();
  }

  // 回到列表视图: 恢复工具条
  function exitDetailView() {
    var tb = document.getElementById("toolbar");
    var sw = document.getElementById("searchWrap");
    var fab = document.getElementById("btnAdd");
    if (tb) tb.classList.remove("hidden");
    if (sw) sw.classList.toggle("hidden", !savedSearchVisible);
    if (ui.searchSug) ui.searchSug.classList.add("hidden");
    if (fab) fab.classList.remove("hidden");
    refreshTopBar();
  }

  // 从详情返回列表, 并恢复到进入详情前的滚动位置(保留词条位置)
  function goBackToList() {
    viewingId = null;
    // 隐藏并清空详情容器
    if (ui.detailView) {
      ui.detailView.classList.add("hidden");
      ui.detailView.innerHTML = "";
    }
    // 恢复 window 滚动(详情已独立滚动, 不会污染列表滚动位置)
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    exitDetailView();
    // 列表 DOM 在详情期间保留, 直接恢复到进入详情前的滚动位置
    var target = savedListScroll || 0;
    window.scrollTo(0, target);
    document.documentElement.scrollTop = target;
    document.body.scrollTop = target;
    requestAnimationFrame(function () {
      window.scrollTo(0, target);
      document.documentElement.scrollTop = target;
      document.body.scrollTop = target;
    });
  }

  function openDetail(id, fromList) {
    var it = store.list.find(function (x) { return x.id === id; });
    if (!it) return;
    viewingId = id;
    // 从列表进入时记录列表滚动位置; 编辑保存后重开详情时不覆盖
    if (fromList) {
      savedListScroll = (window.pageYOffset || document.documentElement.scrollTop || 0);
      savedSearchVisible = ui.searchWrap ? !ui.searchWrap.classList.contains("hidden") : false;
    }
    // 锁定 window 滚动, 详情改用独立滚动容器
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    enterDetailView(true);
    var dv = ui.detailView || ui.cardList;
    dv.innerHTML = "";
    if (ui.detailView) ui.detailView.classList.remove("hidden");

    // 顶部标题栏: 返回 + App 标题(✦ 模型收藏), 位置与主页顶栏一致
    var topbar = document.createElement("div");
    topbar.className = "detail-topbar";

    var backBtn = document.createElement("button");
    backBtn.className = "btn-back-circle";
    backBtn.innerHTML = "‹";
    backBtn.setAttribute("aria-label", "返回");
    backBtn.addEventListener("click", goBackToList);
    topbar.appendChild(backBtn);

    var title = document.createElement("div");
    title.className = "detail-topbar-title";
    title.innerHTML = '<span class="logo">✦</span><span>模型收藏</span>';
    topbar.appendChild(title);

    dv.appendChild(topbar);

    // 名称行: 词条名 + 状态徽标, 长按显示完整名称
    var nameRow = document.createElement("div");
    nameRow.className = "detail-name-row";
    var nameText = document.createElement("span");
    nameText.className = "detail-name-text";
    nameText.textContent = it.name || "详情";
    nameRow.appendChild(nameText);
    var badge = it.kind === "bought" ? '<span class="badge bought">已买</span>' : '<span class="badge wish">心愿</span>';
    var badgeWrap = document.createElement("span");
    badgeWrap.className = "detail-name-badge";
    badgeWrap.innerHTML = badge;
    nameRow.appendChild(badgeWrap);
    // 长按显示完整名称
    var pressTimer = null;
    nameText.addEventListener("touchstart", function () {
      pressTimer = setTimeout(function () {
        pressTimer = null;
        showAlert(nameText.textContent, "完整名称");
      }, 500);
    });
    nameText.addEventListener("touchend", function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    nameText.addEventListener("touchmove", function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    dv.appendChild(nameRow);

    // 详情内容
    var detail = document.createElement("div");
    detail.className = "detail";

    // 上下分行的信息区：品牌 / 价格 / 日期，各占一行（纯文字, 用 innerHTML 无压力）
    var info = '<div class="detail-info">';

    // 第1行：品牌 / 厂商 / 系列（多个用斜杠连接）
    if (it.brand && it.brand.length) {
      info += '<div class="detail-row"><span class="detail-label">品牌</span><span class="detail-value">' + esc(it.brand.join("/")) + '</span></div>';
    }

    if (it.kind === "bought") {
      // 第2行：购买价格
      if (it.price != null && it.price !== "") {
        info += '<div class="detail-row"><span class="detail-label">价格</span><span class="detail-price">' + esc(it.price) + '元</span></div>';
      }
      // 第3行：购买日期
      if (it.date) {
        info += '<div class="detail-row"><span class="detail-label">日期</span><span class="detail-buydate">' + esc(it.date) + '</span></div>';
      }
    } else {
      info += '<div class="detail-row"><span class="detail-label">状态</span><span class="detail-wish">尚未购买 · 心愿收藏</span></div>';
    }
    info += '</div>';

    detail.innerHTML = info;
    dv.appendChild(detail);

    // 标签区: 详情页展示自定义标签(品牌已在上方信息区显示)
    var vTags = (it.tags || []).filter(function (t) { return typeof t === "string" && t.length > 0; });
    if (vTags.length > 0) {
      var tagBox = document.createElement("div");
      tagBox.className = "detail-tags";
      vTags.forEach(function (t) {
        var chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = t;
        tagBox.appendChild(chip);
      });
      detail.appendChild(tagBox);
    }

    // 图片区：逐张创建元素并直接赋 data URL, 避免超长字符串 innerHTML 截断
    var vImgs = validImages(it);
    var imgBox = document.createElement("div");
    imgBox.className = "detail-images";
    if (vImgs.length === 0) {
      var noimg = document.createElement("div");
      noimg.className = "detail-noimg";
      noimg.textContent = "暂无图片";
      imgBox.appendChild(noimg);
    } else {
      var urlList = [];
      vImgs.forEach(function (fname, idx) {
        var item = document.createElement("div");
        item.className = "detail-img-item";
        var img = document.createElement("img");
        img.alt = "图" + (idx + 1);
        item.appendChild(img);

        imgBox.appendChild(item);
        storage.imageUrl(fname).then(function (u) {
          urlList[idx] = u || null;
          if (u) {
            img.src = u;
            // 点击打开全屏查看器(传入图片列表和索引, 支持左右滑动切换)
            img.addEventListener("click", function () { openViewer(urlList, idx); });
          }
        });
      });
    }
    detail.appendChild(imgBox);

    // 底部操作栏: 编辑 / 删除 两个大按钮, 层次分明
    var actbar = document.createElement("div");
    actbar.className = "detail-actbar";
    var editBtn = document.createElement("button");
    editBtn.className = "btn-edit-detail";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", function () { openEdit(id); });
    var delBtn = document.createElement("button");
    delBtn.className = "btn-del-detail";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", function () { openConfirm(id); });
    actbar.appendChild(editBtn);
    actbar.appendChild(delBtn);
    dv.appendChild(actbar);

    // 同步加载所有大图(data URL 已内联)
    var allImgs = detail.querySelectorAll('img[data-idx]');
    (it.images || []).forEach(function (data, i) {
      var el = allImgs[i];
      if (el && data) el.src = data;
    });

    // 详情从顶部开始显示
    dv.scrollTop = 0;
  }

  // ------------------------------------------------------------------
  // 弹窗：新增 / 编辑
  // ------------------------------------------------------------------
  function resetModal() {
    ui.inpName.value = "";
    ui.inpBrand.value = "";
    ui.inpPrice.value = "";
    ui.inpDate.value = "";
    setKind("wish");
    pendingImages = [];
    pendingTags = [];
    pendingBrands = [];
    renderImgGrid();
    renderTagChips();
    renderBrandChips();
  }

  function openModal(title) {
    ui.modalTitle.textContent = title;
    ui.modalMask.classList.remove("hidden");
  }
  function closeModal() {
    ui.modalMask.classList.add("hidden");
  }

  function openAdd() {
    editingId = null;
    resetModal();
    openModal("添加模型");
  }

  async function openEdit(id) {
    var it = store.list.find(function (x) { return x.id === id; });
    if (!it) return;
    editingId = id;
    ui.inpName.value = it.name || "";
    ui.inpBrand.value = "";
    setKind(it.kind === "bought" ? "bought" : "wish");
    ui.inpPrice.value = it.price != null && it.price !== "" ? it.price : "";
    ui.inpDate.value = it.date || "";

    // pendingImages: 已存在的图片文件名填入(显示时异步取URL)
    pendingImages = validImages(it).map(function (d) { return { name: d }; });
    renderImgGrid();
    pendingTags = (it.tags || []).slice();
    renderTagChips();
    pendingBrands = (it.brand || []).slice();
    renderBrandChips();
    openModal("编辑模型");
  }

  // ---- 图片网格渲染 ----
  function renderImgGrid() {
    ui.imgGrid.innerHTML = "";
    ui.imgCount.textContent = pendingImages.length;

    pendingImages.forEach(function (p, idx) {
      var cell = document.createElement("div");
      cell.className = "img-cell";

      var img = document.createElement("img");
      img.alt = "图" + (idx + 1);
      img.onerror = function () { img.onerror = null; img.src = window.IMG_FALLBACK; };
      cell.appendChild(img);

      var idxTag = document.createElement("span");
      idxTag.className = "cell-idx";
      idxTag.textContent = (idx + 1);
      cell.appendChild(idxTag);

      var del = document.createElement("span");
      del.className = "del-tag";
      del.textContent = "✕";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        pendingImages.splice(idx, 1);
        renderImgGrid();
      });
      cell.appendChild(del);

      var moves = document.createElement("div");
      moves.className = "move-btns";
      function mkBtn(txt, fn, dis) {
        var b = document.createElement("button");
        b.textContent = txt;
        b.disabled = dis;
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          fn();
        });
        return b;
      }
      moves.appendChild(mkBtn("↑", function () {
        if (idx > 0) { var t = pendingImages[idx - 1]; pendingImages[idx - 1] = pendingImages[idx]; pendingImages[idx] = t; renderImgGrid(); }
      }, idx === 0));
      moves.appendChild(mkBtn("↓", function () {
        if (idx < pendingImages.length - 1) { var t = pendingImages[idx + 1]; pendingImages[idx + 1] = pendingImages[idx]; pendingImages[idx] = t; renderImgGrid(); }
      }, idx === pendingImages.length - 1));
      cell.appendChild(moves);

      ui.imgGrid.appendChild(cell);

      // 加载显示: 新图(dataUrl)直接赋值; 已有图(name)异步取URL
      if (p.dataUrl) {
        img.src = p.dataUrl;
      } else if (p.name) {
        storage.imageUrl(p.name).then(function (u) {
          if (u && ui.imgGrid.contains(img)) img.src = u;
        });
      }
    });
  }

  // ---- 标签 chips 渲染 ----
  function renderTagChips() {
    if (!ui.tagChips) return;
    ui.tagChips.innerHTML = "";
    pendingTags.forEach(function (t, idx) {
      var chip = document.createElement("span");
      chip.className = "tag-chip";
      var txt = document.createElement("span");
      txt.className = "tag-chip-text";
      txt.textContent = t;
      var del = document.createElement("span");
      del.className = "tag-chip-del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        pendingTags.splice(idx, 1);
        renderTagChips();
      });
      chip.appendChild(txt);
      chip.appendChild(del);
      ui.tagChips.appendChild(chip);
    });
  }

  function addTagFromInput() {
    if (!ui.inpTag) return;
    var v = ui.inpTag.value.trim();
    if (!v) { toast("请输入标签内容"); return; }
    if (pendingTags.indexOf(v) >= 0) { toast("标签已存在"); return; }
    pendingTags.push(v);
    ui.inpTag.value = "";
    renderTagChips();
  }

  // ---- 品牌 chips 渲染 ----
  function renderBrandChips() {
    if (!ui.brandChips) return;
    ui.brandChips.innerHTML = "";
    pendingBrands.forEach(function (b, idx) {
      var chip = document.createElement("span");
      chip.className = "tag-chip";
      var txt = document.createElement("span");
      txt.className = "tag-chip-text";
      txt.textContent = b;
      var del = document.createElement("span");
      del.className = "tag-chip-del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        pendingBrands.splice(idx, 1);
        renderBrandChips();
      });
      chip.appendChild(txt);
      chip.appendChild(del);
      ui.brandChips.appendChild(chip);
    });
  }

  function addBrandFromInput() {
    if (!ui.inpBrand) return;
    var v = ui.inpBrand.value.trim();
    if (!v) { toast("请输入品牌 / 厂商"); return; }
    if (pendingBrands.indexOf(v) >= 0) { toast("该品牌已存在"); return; }
    pendingBrands.push(v);
    ui.inpBrand.value = "";
    renderBrandChips();
  }

  // 添加图片（多个）
  ui.btnAddImg.addEventListener("click", function () { ui.fileInput.click(); });

  ui.fileInput.addEventListener("change", async function () {
    var files = Array.prototype.slice.call(ui.fileInput.files || []);
    ui.fileInput.value = "";
    if (files.length === 0) return;

    var remain = MAX_IMAGES - pendingImages.length;
    if (remain <= 0) { toast("最多只能选 " + MAX_IMAGES + " 张"); return; }
    var take = files.slice(0, remain);
    var added = 0;
    var failed = 0;
    var srcLog = [];
    window.__imgDiag = (window.__imgDiag || "") + " 选图" + take.length + "张;";

    for (var i = 0; i < take.length; i++) {
      if (pendingImages.length >= MAX_IMAGES) break;
      try {
        var r = await processImage(take[i], 640, 0.72, i);
        if (!r || !r.data) throw new Error("empty");
        pendingImages.push({ name: null, dataUrl: r.data });
        added++;
        srcLog.push((i + 1) + ":" + r.src);
        window.__imgDiag += (i + 1) + "->" + r.src + ";";
      } catch (e) {
        failed++;
        srcLog.push((i + 1) + ":fail");
        window.__imgDiag += (i + 1) + "->fail;";
      }
    }
    renderImgGrid();
    // 若有图未能添加, 明确提示用户
    if (failed > 0) toast(failed + " 张图片未能添加(编码不支持)，已跳过");
  });

  // 状态切换
  ui.kindBought.addEventListener("click", function () { setKind("bought"); });
  ui.kindWish.addEventListener("click", function () { setKind("wish"); });

  // 保存（带防抖: 保存中禁止重复提交, 防止连点产生多个词条）
  var saving = false;
  ui.btnSave.addEventListener("click", async function () {
    if (saving) return;          // 保存中, 忽略重复点击
    var name = ui.inpName.value.trim();
    if (!name) { toast("请输入模型名称"); return; }
    // 自动把 brand/tag 输入框里残留的文字加进去(用户没点"添加"就点保存)
    if (ui.inpBrand && ui.inpBrand.value.trim()) {
      var bv = ui.inpBrand.value.trim();
      if (pendingBrands.indexOf(bv) < 0) pendingBrands.push(bv);
      ui.inpBrand.value = "";
    }
    if (ui.inpTag && ui.inpTag.value.trim()) {
      var tv = ui.inpTag.value.trim();
      if (pendingTags.indexOf(tv) < 0) pendingTags.push(tv);
      ui.inpTag.value = "";
    }
    if (pendingBrands.length === 0) { showAlert("请输入品牌 / 厂商"); return; }

    // 已买商品强制校验价格与日期(不能为空), 校验失败弹窗提示
    var kind = getKind();
    if (kind === "bought") {
      var pv = ui.inpPrice.value.trim();
      if (pv === "") { showAlert("已买商品请填写购买价格"); return; }
      var priceVal = parseFloat(pv);
      if (isNaN(priceVal) || priceVal < 0) { showAlert("购买价格格式不正确"); return; }
      if (!ui.inpDate.value) { showAlert("已买商品请填写购买日期"); return; }
    }

    saving = true;
    ui.btnSave.disabled = true;
    ui.btnSave.textContent = "保存中…";
    try {

    var record = { name: name, brand: pendingBrands.slice(), kind: kind, price: null, date: "", tags: pendingTags.slice() };
    if (record.kind === "bought") {
      record.price = parseFloat(ui.inpPrice.value.trim());
      record.date = ui.inpDate.value;
    }

    // 图片处理: 新图写文件, 旧图沿用文件名, 移除的旧图删除文件
    var oldImages = [];
    if (editingId) {
      var ex0 = store.list.find(function (x) { return x.id === editingId; });
      oldImages = ex0 ? (ex0.images || []) : [];
    }
    var keep = oldImages.slice();        // 当前仍保留的旧图片
    var newImages = [];                  // 最终顺序的文件名
    var saveFail = 0;

    for (var i = 0; i < pendingImages.length; i++) {
      var pimg = pendingImages[i];
      if (pimg && pimg.dataUrl) {
        // 新选图: 写入文件
        var fname = await storage.saveImage(pimg.dataUrl);
        if (fname) {
          newImages.push(fname);
        } else {
          saveFail++;
          newImages.push(null); // 保留占位标记以维持顺序; 显示时会过滤
        }
      } else if (pimg && pimg.name) {
        // 已有图: 沿用文件名
        newImages.push(pimg.name);
        var ki = keep.indexOf(pimg.name);
        if (ki >= 0) keep.splice(ki, 1);
      }
    }

    // 删除已不再保留的旧图文件
    for (var j = 0; j < keep.length; j++) {
      await storage.deleteImage(keep[j]);
    }

    // 过滤掉写入失败的空位
    record.images = newImages.filter(function (n) { return !!n; });

    if (saveFail > 0) {
      toast(saveFail + " 张图片保存失败");
    }

    if (editingId) {
      var idx = store.list.findIndex(function (x) { return x.id === editingId; });
      if (idx >= 0) {
        record.id = editingId;
        record.createdAt = store.list[idx].createdAt || Date.now();
        store.list[idx] = record;
      }
      toast("已保存");
    } else {
      record.id = genId();
      record.createdAt = Date.now();
      // 新词条默认排最上面: 取当前最小 sortOrder - 1, 保证新词条顶到列表最前
      var minOrder = null;
      store.list.forEach(function (x) {
        if (typeof x.sortOrder === "number") {
          if (minOrder === null || x.sortOrder < minOrder) minOrder = x.sortOrder;
        }
      });
      record.sortOrder = (minOrder === null) ? 0 : (minOrder - 1);
      store.list.push(record);
      toast("已添加");
    }

    await storage.save();
    closeModal();
    // 若来自详情编辑，返回详情；否则返回列表
    if (viewingId) openDetail(viewingId);
    else renderList();
    } catch (err) {
      toast("保存出错");
      console.error(err);
    } finally {
      saving = false;
      ui.btnSave.disabled = false;
      ui.btnSave.textContent = "保存";
    }
  });

  // ------------------------------------------------------------------
  // 删除
  // ------------------------------------------------------------------
  function openConfirm(id) {
    var it = store.list.find(function (x) { return x.id === id; });
    if (!it) return;
    deletingId = id;
    ui.confirmName.textContent = it.name || "";
    ui.confirmMask.classList.remove("hidden");
  }

  async function doDelete() {
    var it = store.list.find(function (x) { return x.id === deletingId; });
    if (it && it.images) {
      for (var i = 0; i < it.images.length; i++) {
        await storage.deleteImage(it.images[i]);
      }
    }
    store.list = store.list.filter(function (x) { return x.id !== deletingId; });
    await storage.save();
    ui.confirmMask.classList.add("hidden");
    deletingId = null;
    if (viewingId) {
      goBackToList();
      renderList();
      window.scrollTo(0, savedListScroll || 0);
    }
    else { renderList(); }
    toast("已删除");
  }

  // ------------------------------------------------------------------
  // 事件绑定
  // ------------------------------------------------------------------
  function bindEvents() {
    bindImportInput();
    bindViewer();
    ui.btnAdd.addEventListener("click", openAdd);
    if (ui.btnAddTag) ui.btnAddTag.addEventListener("click", addTagFromInput);
    if (ui.inpTag) ui.inpTag.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.keyCode === 13) { e.preventDefault(); addTagFromInput(); }
    });
    if (ui.btnAddBrand) ui.btnAddBrand.addEventListener("click", addBrandFromInput);
    if (ui.inpBrand) ui.inpBrand.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.keyCode === 13) { e.preventDefault(); addBrandFromInput(); }
    });
    ui.btnModalClose.addEventListener("click", closeModal);
    ui.btnCancel.addEventListener("click", closeModal);
    ui.modalMask.addEventListener("click", function (e) { if (e.target === ui.modalMask) closeModal(); });

    if (ui.btnAlertOk) ui.btnAlertOk.addEventListener("click", function () { ui.alertMask.classList.add("hidden"); });
    if (ui.alertMask) ui.alertMask.addEventListener("click", function (e) { if (e.target === ui.alertMask) ui.alertMask.classList.add("hidden"); });

    ui.btnYes.addEventListener("click", doDelete);
    ui.btnNo.addEventListener("click", function () { ui.confirmMask.classList.add("hidden"); deletingId = null; });
    ui.confirmMask.addEventListener("click", function (e) {
      if (e.target === ui.confirmMask) { ui.confirmMask.classList.add("hidden"); deletingId = null; }
    });

    if (ui.btnEdit) ui.btnEdit.addEventListener("click", function (e) {
      e.stopPropagation();
      if (ui.editMenu) ui.editMenu.classList.toggle("hidden");
    });
    if (ui.btnSort) ui.btnSort.addEventListener("click", function () { enterSortMode(); });
    if (ui.btnExitSort) ui.btnExitSort.addEventListener("click", function () { exitSortMode(); });
    if (ui.editMenu) ui.editMenu.addEventListener("click", function () {
      ui.editMenu.classList.add("hidden");
    });
    document.addEventListener("click", function (e) {
      if (ui.editMenu && !ui.editMenu.classList.contains("hidden")) {
        if (!ui.editMenu.contains(e.target) && e.target !== ui.btnEdit) ui.editMenu.classList.add("hidden");
      }
    });

    ui.btnSearch.addEventListener("click", function () {
      ui.searchWrap.classList.toggle("hidden");
      if (!ui.searchWrap.classList.contains("hidden")) {
        ui.searchInput.focus();
      } else {
        // 关闭搜索栏时清空输入框和提示
        if (ui.searchInput) ui.searchInput.value = "";
        if (ui.searchSug) ui.searchSug.classList.add("hidden");
        renderList();
      }
      refreshTopBar();
    });
    // 点搜索框外部时隐藏提示浮层
    document.addEventListener("click", function (e) {
      if (ui.searchSug && !ui.searchSug.classList.contains("hidden")) {
        var t = e.target;
        var inside = ui.searchSug.contains(t) || t === ui.searchInput || t === ui.searchScope || t === ui.btnSearchSubmit;
        if (!inside) ui.searchSug.classList.add("hidden");
      }
    });
    ui.searchInput.addEventListener("input", function () { renderSuggestions(); renderList(); });
    if (ui.btnSearchSubmit) ui.btnSearchSubmit.addEventListener("click", function () {
      renderList();
      if (ui.searchSug) ui.searchSug.classList.add("hidden");
    });
    // 滚动列表时隐藏提示浮层
    window.addEventListener("scroll", function () {
      if (ui.searchSug && !ui.searchSug.classList.contains("hidden")) {
        ui.searchSug.classList.add("hidden");
      }
    }, { passive: true });
    if (ui.searchScope) ui.searchScope.addEventListener("change", function () { saveUiState(); renderList(); });

    // 导出备份: 先弹确认, 确认后才导出
    // 导出备份: 打开确认弹窗
    ui.btnExport.addEventListener("click", function () {
      if (!isNative) { toast("备份仅在真机可用"); return; }
      // 每次打开重置状态
      ui.exportStatus.textContent = "";
      ui.exportStatus.className = "export-status";
      ui.exportDoneWrap.classList.add("hidden");
      ui.btnExportYes.classList.remove("hidden");
      ui.btnExportNo.classList.remove("hidden");
      ui.btnExportYes.disabled = false;
      ui.btnExportYes.textContent = "导出";
      ui.btnExportNo.disabled = false;
      window.__exporting = false;
      ui.exportMask.classList.remove("hidden");
    });
    // 取消: 仅在非导出中允许关闭
    ui.btnExportNo.addEventListener("click", function () {
      if (window.__exporting) return;
      ui.exportMask.classList.add("hidden");
    });
    // 全宽大"完成"按钮: 导出成功后显示, 点击关闭
    ui.btnExportDone.addEventListener("click", function () {
      ui.exportMask.classList.add("hidden");
    });
    // 确认: 首次点击=执行导出; 导出中忽略
    ui.btnExportYes.addEventListener("click", async function () {
      if (window.__exporting) return;
      // 开始导出: 不关弹窗, 显示导出中, 禁用两键
      window.__exporting = true;
      ui.exportStatus.className = "export-status run";
      ui.exportStatus.textContent = "导出中…";
      ui.btnExportYes.disabled = true;
      ui.btnExportNo.disabled = true;
      try {
        var fn = await storage.exportBackup();
        // 成功: 隐藏两个小按钮, 只显示全宽大"完成"按钮
        ui.exportStatus.className = "export-status ok";
        ui.exportStatus.textContent = "导出成功";
        ui.btnExportYes.classList.add("hidden");
        ui.btnExportNo.classList.add("hidden");
        ui.exportDoneWrap.classList.remove("hidden");
        window.__exporting = false;
      } catch (e) {
        // 失败: 恢复两个小按钮(取消/重试)
        ui.exportStatus.className = "export-status err";
        ui.exportStatus.textContent = "导出失败：" + (e && e.message || e);
        ui.btnExportYes.disabled = false;
        ui.btnExportYes.textContent = "重试";
        ui.btnExportNo.disabled = false;
        window.__exporting = false;
      }
    });
    // 导出确认弹窗点击空白: 导出中不允许关闭, 否则可关闭
    ui.exportMask.addEventListener("click", function (e) {
      if (e.target === ui.exportMask && !window.__exporting) ui.exportMask.classList.add("hidden");
    });

    // 导入备份: 弹出备份文件选择
    ui.btnImport.addEventListener("click", pickAndImport);
    ui.bakClose.addEventListener("click", function () { ui.bakMask.classList.add("hidden"); });
    // 备份弹窗点击空白关闭
    ui.bakMask.addEventListener("click", function (e) {
      if (e.target === ui.bakMask) ui.bakMask.classList.add("hidden");
    });

    ui.sortSelect.addEventListener("change", function () { saveUiState(); renderList(); });

    ui.tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        ui.tabs.forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        currentFilter = tab.getAttribute("data-filter");
        updateSortVisibility();
        saveUiState();
        renderList();
      });
    });

    // 系统返回键/侧滑返回支持
    var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && App.addListener) {
      App.addListener('backButton', function () {
        // 0) 提示弹窗 -> 关闭
        if (ui.alertMask && !ui.alertMask.classList.contains("hidden")) {
          ui.alertMask.classList.add("hidden");
          return;
        }
        // 0) 图片查看器打开 -> 优先关闭查看器
        if (ui.viewerMask && !ui.viewerMask.classList.contains("hidden")) {
          closeViewer();
          return;
        }
        // 1) 确认删除弹窗 -> 关闭
        if (!ui.confirmMask.classList.contains("hidden")) {
          ui.confirmMask.classList.add("hidden");
          deletingId = null;
          return;
        }
        // 1.5) 备份选择/导出确认弹窗 -> 关闭
        if (ui.bakMask && !ui.bakMask.classList.contains("hidden")) {
          ui.bakMask.classList.add("hidden");
          return;
        }
        if (ui.exportMask && !ui.exportMask.classList.contains("hidden")) {
          if (window.__exporting) return;   // 导出中不允许通过返回关闭
          ui.exportMask.classList.add("hidden");
          return;
        }
        // 2) 编辑/添加弹窗 -> 关闭
        if (!ui.modalMask.classList.contains("hidden")) {
          closeModal();
          return;
        }
        // 3) 详情页 -> 返回列表(并恢复之前滚动位置)
        if (viewingId) {
          goBackToList();
          return;
        }
        // 4) 列表首页 -> 退出(返回桌面)
        if (App.minimizeApp) { App.minimizeApp(); }
        else if (App.exitApp) { App.exitApp(); }
      });
    }

    // 顶栏高度可能随屏幕旋转/窗口变化, 实时刷新列表 padding
    window.addEventListener("resize", refreshTopBar);
  }

  // 导入备份: 弹出系统文件选择器让用户选 json(通过隐藏 file input, 在 WebView 里可直接调用系统选择器)
  function pickAndImport() {
    if (!isNative) { toast("导入仅在真机可用"); return; }
    if (!ui.importInput) { toast("系统选择器不可用"); return; }
    ui.importInput.value = "";   // 允许重新选择同一文件
    ui.importInput.click();
  }

  // 绑定导入文件 input 的 change
  function bindImportInput() {
    if (!ui.importInput) return;
    ui.importInput.removeEventListener("change", onImportFileChange);
    ui.importInput.addEventListener("change", onImportFileChange);
  }

  function onImportFileChange() {
    var file = ui.importInput && ui.importInput.files && ui.importInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function () {
      try {
        var content = reader.result;
        toast("正在恢复…");
        var cnt = await storage.importFromJson(content);
        renderList();
        toast("已恢复 " + cnt + " 条记录");
      } catch (e) {
        toast("导入失败: " + (e && e.message || "文件格式错误"));
      }
    };
    reader.onerror = function () { toast("读取文件失败"); };
    reader.readAsText(file);
  }

  // ==============================================================
  // 全屏图片查看器(双指缩放/拖动/双击/左右滑动切换/关闭聚焦)
  // ==============================================================
  var viewer = { scale: 1, tx: 0, ty: 0, dist: 0, mtx: 0, mty: 0, pinch: false, down: false, lastTap: 0, swipeStartX: 0, swipeStartY: 0 };
  var viewerImages = [];   // 当前查看器的图片 URL 列表
  var viewerIndex = 0;     // 当前图片索引

  function viewerReset() {
    viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
    viewerApply();
  }

  function viewerApply() {
    ui.viewerImg.style.transform = "translate(" + viewer.tx + "px," + viewer.ty + "px) scale(" + viewer.scale + ")";
  }

  function viewerStageCenter() {
    var r = ui.viewerStage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // scale=1 时图片 contain 适配后的显示尺寸
  function viewerNaturalSize() {
    var img = ui.viewerImg;
    if (!img.naturalWidth || !img.naturalHeight) return null;
    var r = ui.viewerStage.getBoundingClientRect();
    var ratio = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    return { w: img.naturalWidth * ratio, h: img.naturalHeight * ratio };
  }

  // 边界钳制: 某方向小于屏幕则居中, 大于屏幕则限制拖出范围
  function viewerClamp() {
    var r = ui.viewerStage.getBoundingClientRect();
    var ns = viewerNaturalSize();
    if (!ns) return;
    var dw = ns.w * viewer.scale, dh = ns.h * viewer.scale;
    if (dw <= r.width) viewer.tx = 0;
    else { var mx = (dw - r.width) / 2; viewer.tx = Math.max(-mx, Math.min(mx, viewer.tx)); }
    if (dh <= r.height) viewer.ty = 0;
    else { var my = (dh - r.height) / 2; viewer.ty = Math.max(-my, Math.min(my, viewer.ty)); }
  }

  // 以屏幕点 (px,py) 为中心计算新 scale 后的位移(不直接 apply)
  function viewerZoomAt(px, py, newScale) {
    var c = viewerStageCenter();
    var pcx = px - c.x, pcy = py - c.y;
    var fx = newScale / viewer.scale;
    viewer.tx = pcx - (pcx - viewer.tx) * fx;
    viewer.ty = pcy - (pcy - viewer.ty) * fx;
    viewer.scale = newScale;
  }

  // 双击: 放大到 2.5 倍(以双击点为中心) / 缩小回 1 倍并居中
  function viewerZoomToggle(px, py) {
    var img = ui.viewerImg;
    img.style.transition = "transform 0.2s ease-out";
    if (viewer.scale > 1) {
      viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
    } else {
      viewerZoomAt(px, py, 2.5);
      viewerClamp();
    }
    viewerApply();
    setTimeout(function () { img.style.transition = ""; }, 200);
  }

  // 单格宽度 = 一屏宽 + 两张图之间的小缝隙(16px)
  function cellWidth() {
    var w = 0;
    if (ui.viewerStage) w = ui.viewerStage.getBoundingClientRect().width;
    return (w || window.innerWidth) + 16;
  }

  // 设置 track 的水平位移(滑动用)
  function setTrack(x, animate) {
    var t = ui.viewerTrack;
    if (!t) return;
    t.style.transition = animate ? "transform 0.18s ease-out" : "none";
    t.style.transform = "translateX(" + x + "px)";
  }

  // 显示当前索引的图片(当前图 + 预加载下一张), 并重置缩放和 track
  function showViewerImage() {
    viewerReset();
    ui.viewerImg.src = viewerImages[viewerIndex] || "";
    ui.viewerImg2.src = viewerImages[viewerIndex + 1] || "";
    setTrack(0, false);
  }

  // 关闭后, 让详情页聚焦到当前查看的图片(尽量居中)
  function focusDetailImage(index) {
    var items = document.querySelectorAll(".detail-images .detail-img-item");
    if (items && items[index]) {
      try {
        items[index].scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) {
        items[index].scrollIntoView();
      }
    }
  }

  function openViewer(images, index) {
    viewerImages = (images || []).filter(function (u) { return !!u; });
    var clickedUrl = images && images[index];
    var ni = viewerImages.indexOf(clickedUrl);
    if (ni < 0) ni = 0;
    viewerIndex = ni;
    showViewerImage();
    ui.viewerMask.classList.remove("hidden");
    if (FullscreenPlugin) { try { FullscreenPlugin.enter(); } catch (e) {} }
  }

  function closeViewer() {
    ui.viewerMask.classList.add("hidden");
    viewerReset();
    if (FullscreenPlugin) { try { FullscreenPlugin.exit(); } catch (e) {} }
    focusDetailImage(viewerIndex);
  }

  function bindViewer() {
    var mask = ui.viewerMask, img = ui.viewerImg;
    var pointers = {};   // pointerId -> {x, y}

    // 点图片外(遮罩背景)关闭, 不管是否放大过
    mask.addEventListener("click", function (e) {
      if (e.target === mask) closeViewer();
    });

    // 双击放大/缩小(桌面兜底)
    mask.addEventListener("dblclick", function (e) {
      viewerZoomToggle(e.clientX, e.clientY);
    });

    var swipeActive = false;   // 是否正在跟手左右滑动
    var swipeDir = 0;          // 滑动方向: -1 左滑(看下一张), +1 右滑(看上一张)
    var swipeBase = 0;         // 跟手滑动时 track 的基准位移

    mask.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      img.style.transition = "";   // 拖动/缩放/滑动要即时跟手, 去掉过渡
      var count = Object.keys(pointers).length;
      if (count === 1) {
        viewer.pinch = false;
        viewer.mtx = e.clientX;
        viewer.mty = e.clientY;
        viewer.swipeStartX = e.clientX;
        viewer.swipeStartY = e.clientY;
        swipeActive = false;
      } else if (count === 2) {
        viewer.pinch = true;
        swipeActive = false;   // 双指时取消跟手滑动
        var ids = Object.keys(pointers);
        var p0 = pointers[ids[0]], p1 = pointers[ids[1]];
        viewer.dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      }
    });

    mask.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      var count = ids.length;
      if (count >= 2 && viewer.pinch) {
        var p0 = pointers[ids[0]], p1 = pointers[ids[1]];
        var d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (viewer.dist <= 0) { viewer.dist = d; return; }
        var oldScale = viewer.scale;
        var newScale = Math.max(1, Math.min(5, oldScale * (d / viewer.dist)));
        // 围绕两指中点缩放, 手指下的图片点保持不动
        var c = viewerStageCenter();
        var midx = (p0.x + p1.x) / 2 - c.x;
        var midy = (p0.y + p1.y) / 2 - c.y;
        var fx = newScale / oldScale;
        viewer.tx = midx - (midx - viewer.tx) * fx;
        viewer.ty = midy - (midy - viewer.ty) * fx;
        viewer.scale = newScale;
        viewerApply();
        viewer.dist = d;
      } else if (count === 1 && viewer.scale > 1) {
        var dx = e.clientX - viewer.mtx;
        var dy = e.clientY - viewer.mty;
        viewer.tx += dx; viewer.ty += dy;
        viewer.mtx = e.clientX;
        viewer.mty = e.clientY;
        viewerClamp();
        viewerApply();
      } else if (count === 1 && viewer.scale <= 1 && viewerImages.length > 1) {
        // 跟手左右滑动: 两张图并排, 整体跟随手指水平移动
        var dx = e.clientX - viewer.swipeStartX;
        var dy = e.clientY - viewer.swipeStartY;
        if (Math.abs(dx) > Math.abs(dy)) {
          if (!swipeActive) {
            swipeActive = true;
            if (dx < 0) {
              // 左滑看下一张: 当前图在左, 下一张在右
              swipeDir = -1;
              swipeBase = 0;
              ui.viewerImg.src = viewerImages[viewerIndex] || "";
              ui.viewerImg2.src = viewerImages[viewerIndex + 1] || "";
            } else {
              // 右滑看上一张: 上一张在左, 当前图在右
              swipeDir = 1;
              swipeBase = -cellWidth();
              ui.viewerImg.src = viewerImages[viewerIndex - 1] || "";
              ui.viewerImg2.src = viewerImages[viewerIndex] || "";
            }
          }
          setTrack(swipeBase + dx, false);
        }
      }
    });

    function endPointer(e) {
      var wasPinch = viewer.pinch;
      var count = Object.keys(pointers).length;
      var didSwipe = false;

      if (count === 1 && !wasPinch) {
        if (swipeActive && viewer.scale <= 1) {
          // 跟手滑动结束: 距离够则切换, 不够则回弹
          didSwipe = true;
          var dx = e.clientX - viewer.swipeStartX;
          var switched = false;
          if (Math.abs(dx) > 80) {
            if (swipeDir === -1 && viewerIndex + 1 < viewerImages.length) {
              viewerIndex++;
              switched = true;
            } else if (swipeDir === 1 && viewerIndex - 1 >= 0) {
              viewerIndex--;
              switched = true;
            }
          }
          if (switched) {
            // 滑到目标位置(相邻图居中), 然后换图复位
            var targetX = swipeBase + swipeDir * cellWidth();
            setTrack(targetX, true);
            setTimeout(function () { showViewerImage(); }, 180);
          } else {
            // 回弹到原位
            setTrack(swipeBase, true);
            setTimeout(function () { showViewerImage(); }, 180);
          }
          swipeActive = false;
        } else if (!swipeActive) {
          // 未滑动(点击): 双击检测
          var now = Date.now();
          if (now - viewer.lastTap < 300) {
            viewerZoomToggle(e.clientX, e.clientY);
            viewer.lastTap = 0;
          } else {
            viewer.lastTap = now;
          }
        }
      }

      delete pointers[e.pointerId];
      if (Object.keys(pointers).length === 0) {
        viewer.pinch = false;
        viewer.dist = 0;
        viewer.down = false;
        if (!didSwipe) {
          viewerClamp();
          viewerApply();
        }
      }
    }
    mask.addEventListener("pointerup", endPointer);
    mask.addEventListener("pointercancel", endPointer);
  }

  // ==============================================================
  // 弹窗打开时锁定背景滚动
  // ==============================================================
  var SCROLL_MASKS = ["modalMask", "confirmMask", "exportMask", "bakMask", "viewerMask"];

  function refreshScrollLock() {
    var anyOpen = SCROLL_MASKS.some(function (key) {
      var m = ui[key];
      return m && m.classList && !m.classList.contains("hidden");
    });
    if (anyOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
  }

  // 顶栏改为 fixed 容器后, 计算其实际高度并给列表补 padding-top, 避免内容被固定顶栏遮挡
  function refreshTopBar() {
    var topBar = document.getElementById("topFixed");
    if (topBar) {
      ui.cardList.style.paddingTop = topBar.offsetHeight + "px";
    }
  }

  // 用 MutationObserver 自动监听所有 .modal-mask 的显隐, 防止背景列表滚动
  function setupScrollLock() {
    if (!window.MutationObserver) return;
    var observer = new MutationObserver(function (mutations) {
      var changed = false;
      for (var i = 0; i < mutations.length; i++) {
        var t = mutations[i].target;
        if (t && t.classList && t.classList.contains("modal-mask")) { changed = true; break; }
      }
      if (changed) refreshScrollLock();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  // 弹出备份选择列表并执行恢复
  async function showBackupList() {
    if (!isNative) { toast("备份仅在真机可用"); return; }
    try {
      var baks = await storage.listBackups();
      ui.bakList.innerHTML = "";
      ui.bakEmpty.classList.toggle("hidden", baks.length > 0);
      if (!baks.length) { ui.bakMask.classList.remove("hidden"); return; }
      // 最新在前
      baks.sort().reverse().forEach(function (name) {
        var row = document.createElement("button");
        row.className = "bak-row";
        row.textContent = name;
        row.addEventListener("click", async function () {
          ui.bakList.innerHTML = "";
          row.disabled = true;
          row.textContent = "恢复中…";
          try {
            var cnt = await storage.importBackup(name);
            ui.bakMask.classList.add("hidden");
            renderList();
            toast("已恢复 " + cnt + " 条记录");
          } catch (e) {
            toast("导入失败: " + (e && e.message || e));
            ui.bakMask.classList.add("hidden");
          }
        });
        ui.bakList.appendChild(row);
      });
      ui.bakMask.classList.remove("hidden");
    } catch (e) {
      toast("读取备份列表失败");
    }
  }

  // ------------------------------------------------------------------
  // 启动
  // ------------------------------------------------------------------
  var booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    try {
      // 确保 Capacitor/bridge 就绪后刷新原生插件引用
      BackupScannerPlugin = makeNativePlugin("BackupScanner");
      HeicConvertPlugin = makeNativePlugin("HeicConvert");
      FilePickerPlugin = makeNativePlugin("FilePicker");
      FullscreenPlugin = makeNativePlugin("Fullscreen");
      bindEvents();
      setupScrollLock();
      refreshTopBar();
      await storage.init();
      loadUiState();
      renderList();
    } catch (e) {
      toast("初始化失败，将以空数据模式运行");
      renderList();
      console.error(e);
    }
  }

  function scheduleBoot() {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      if (window.Capacitor.isReady) { boot(); }
      else {
        window.addEventListener('capacitor:init', boot);
        setTimeout(boot, 2000);
      }
    } else {
      if (document.readyState === "loading") { window.addEventListener("DOMContentLoaded", boot); }
      else { boot(); }
    }
  }

  scheduleBoot();
})();
