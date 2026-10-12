"""Images for the manual tests v2: masks (same scale, context covered with white), a context substitution,
meaning-free crops and a processed crop. Boxes are pixel boxes on the original photos."""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

OUT = r'C:\Users\kosti\Desktop\Тест на бесплатном DeepSeek'


def save(im, name, scale=1):
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.png'))
    print(name, im.size)


def masked(src, box):
    im = Image.open(src).convert('RGB')
    ImageDraw.Draw(im).rectangle(box, fill='white')
    return im


# 2: the line x1 = −13π/4 covered; 3: the line cos²x = 1/2 covered
save(masked('cases/13.2.3/solution.png', (230, 362, 410, 405)), '5a 13.2.3 маска на строке x1')
save(masked('cases/500366.1/solution.png', (75, 78, 155, 100)), '5b 500366.1 маска на строке cos²x')

# 3: cos²x = 1/2 changed to cos²x = 1/16 (synthetic digits, so ±1/4 follows from it)
im = Image.open('cases/500366.1/solution.png').convert('RGB')
draw = ImageDraw.Draw(im)
draw.rectangle((135, 90, 150, 101), fill='white')
font = ImageFont.truetype(r'C:\Windows\Fonts\segoepr.ttf', 10)
draw.text((134, 87), '16', font=font, fill='black')
save(im, '6a 500366.1 подмена 1 на 16 (синтетика)')

# 4: meaning-free crops: the denominator 14 alone, the sign from 4sinx alone, the sign from x ≠ πn alone
src = Image.open('cases/13.2.3/solution.png').convert('RGB')
save(src.crop((201, 506, 218, 521)), '7a 13.2.3 только знаменатель', 8)
src = Image.open('cases/13.6.3/solution-01.png').convert('RGB')
save(src.crop((474, 16, 490, 31)), '7b 13.6.3 только знак из 4sinx', 8)
save(src.crop((432, 46, 452, 60)), '7c 13.6.3 только знак из x≠πn', 8)

# 5: the denominator crop processed by code: black and white, stroke thickened by one pixel, digit ~50 px high
src = Image.open('cases/13.2.3/solution.png').convert('L').crop((196, 500, 222, 522))
big = src.resize((src.width * 6, src.height * 6), Image.LANCZOS)
bw = big.point(lambda v: 0 if v < 170 else 255)
thick = bw.filter(ImageFilter.MinFilter(3))
save(ImageOps.expand(thick, border=20, fill=255).convert('RGB'), '8a 13.2.3 знаменатель обработанный')
