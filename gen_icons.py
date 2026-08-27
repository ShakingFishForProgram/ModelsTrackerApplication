from PIL import Image, ImageDraw
import os

BG = (26, 48, 82, 255)      # 深蓝
WHITE = (255, 255, 255, 255)
CYAN = (0, 212, 255, 255)   # 青色发光

RES_DIR = r"C:\Users\BS-ASUA\model-tracker\android\app\src\main\res"

SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def draw_robot(d, cx, cy, s):
    """以 (cx, cy) 为中心、缩放因子 s 绘制机器人全身剪影。
    原始坐标基于 512 画布，机器人包围盒中心约 (256, 253)。"""
    def X(x):
        return cx + (x - 256) * s

    def Y(y):
        return cy + (y - 253) * s

    def R(r):
        return max(1, int(round(r * s)))

    # V 型天线（上细下粗，底部相连，顶部尖锐）
    d.polygon([(X(190), Y(34)), (X(236), Y(92)), (X(256), Y(92))], fill=WHITE)
    d.polygon([(X(322), Y(34)), (X(256), Y(92)), (X(276), Y(92))], fill=WHITE)
    # 头
    d.rounded_rectangle([X(172), Y(92), X(340), Y(214)], radius=R(28), fill=WHITE)
    # 眼睛
    d.ellipse([X(202), Y(128), X(240), Y(166)], fill=CYAN)
    d.ellipse([X(272), Y(128), X(310), Y(166)], fill=CYAN)
    # 身体
    d.rounded_rectangle([X(160), Y(226), X(352), Y(368)], radius=R(24), fill=WHITE)
    # 胸口灯
    d.ellipse([X(236), Y(262), X(276), Y(302)], fill=CYAN)
    # 手臂
    d.rounded_rectangle([X(110), Y(232), X(152), Y(356)], radius=R(18), fill=WHITE)
    d.rounded_rectangle([X(360), Y(232), X(402), Y(356)], radius=R(18), fill=WHITE)
    # 腿
    d.rounded_rectangle([X(184), Y(364), X(238), Y(462)], radius=R(14), fill=WHITE)
    d.rounded_rectangle([X(274), Y(364), X(328), Y(462)], radius=R(14), fill=WHITE)
    # 脚
    d.rounded_rectangle([X(172), Y(458), X(250), Y(476)], radius=R(9), fill=WHITE)
    d.rounded_rectangle([X(262), Y(458), X(340), Y(476)], radius=R(9), fill=WHITE)


def make_square(S):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, S, S], fill=BG)
    draw_robot(d, S / 2, S / 2, 0.82 * S / 446)
    return img


def make_round(S):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, S, S], fill=BG)
    draw_robot(d, S / 2, S / 2, 0.66 * S / 446)
    return img


def make_foreground(S):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_robot(d, S / 2, S / 2, 0.52 * S / 446)
    return img


for dpi, S in SIZES.items():
    folder = os.path.join(RES_DIR, "mipmap-" + dpi)
    make_square(S).save(os.path.join(folder, "ic_launcher.png"))
    make_round(S).save(os.path.join(folder, "ic_launcher_round.png"))
    make_foreground(S).save(os.path.join(folder, "ic_launcher_foreground.png"))
    print("done", dpi, S)

print("all icons generated")
