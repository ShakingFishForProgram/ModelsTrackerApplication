from PIL import Image, ImageDraw

SIZE = 512
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

BG = (26, 48, 82, 255)      # 深蓝
WHITE = (255, 255, 255, 255)
CYAN = (0, 212, 255, 255)   # 青色发光

# 背景：深蓝圆角方形
d.rounded_rectangle([0, 0, SIZE, SIZE], radius=110, fill=BG)

# V 型天线（上细下粗，底部相连，顶部尖锐无圆角）
d.polygon([(190, 34), (236, 92), (256, 92)], fill=WHITE)   # 左翼
d.polygon([(322, 34), (256, 92), (276, 92)], fill=WHITE)   # 右翼

# 头
d.rounded_rectangle([172, 92, 340, 214], radius=28, fill=WHITE)

# 眼睛（青色圆形）
d.ellipse([202, 128, 240, 166], fill=CYAN)
d.ellipse([272, 128, 310, 166], fill=CYAN)

# 身体
d.rounded_rectangle([160, 226, 352, 368], radius=24, fill=WHITE)

# 胸口灯（青色）
d.ellipse([236, 262, 276, 302], fill=CYAN)

# 手臂
d.rounded_rectangle([110, 232, 152, 356], radius=18, fill=WHITE)
d.rounded_rectangle([360, 232, 402, 356], radius=18, fill=WHITE)

# 腿
d.rounded_rectangle([184, 364, 238, 462], radius=14, fill=WHITE)
d.rounded_rectangle([274, 364, 328, 462], radius=14, fill=WHITE)

# 脚
d.rounded_rectangle([172, 458, 250, 476], radius=9, fill=WHITE)
d.rounded_rectangle([262, 458, 340, 476], radius=9, fill=WHITE)

out = r"C:\Users\BS-ASUA\Desktop\模型收藏logo预览.png"
img.save(out)
print("saved:", out)
