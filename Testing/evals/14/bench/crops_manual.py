"""Crops for manual tests on the free DeepSeek chat: the same place with less and less context around it.

Boxes are pixel boxes on the original photos (x0, y0, x1, y1); every crop is enlarged 4x.
"""
import os
import sys

from PIL import Image

OUT = r'C:\Users\kosti\Desktop\Тест на бесплатном DeepSeek'
CROPS = {
    # 13.6.3: sign in ОДЗ, written ≠, the reader writes >
    '1a 13.6.3 фото целиком': ('cases/13.6.3/solution-01.png', None),
    '1b 13.6.3 ОДЗ вместе с логарифмом': ('cases/13.6.3/solution-01.png', (240, 0, 545, 62)),
    '1c 13.6.3 только блок ОДЗ': ('cases/13.6.3/solution-01.png', (420, 0, 545, 62)),
    '1d 13.6.3 одна строка 4sinx': ('cases/13.6.3/solution-01.png', (420, 16, 520, 32)),
    # 13.2.3: answer written −13/14 π, the reader writes −13π/4 (as in x1 = −13π/4 above)
    '2a 13.2.3 фото целиком': ('cases/13.2.3/solution.png', None),
    '2b 13.2.3 ответ вместе со строкой x1': ('cases/13.2.3/solution.png', (0, 350, 582, 522)),
    '2c 13.2.3 только строка ответа б)': ('cases/13.2.3/solution.png', (0, 475, 582, 522)),
    '2d 13.2.3 только первый корень ответа': ('cases/13.2.3/solution.png', (172, 494, 238, 521)),
    # 500366.1: written cos x = ±1/4, the reader writes ±1/√2 (cos²x = 1/2 above)
    '3a 500366.1 фото целиком': ('cases/500366.1/solution.png', None),
    '3b 500366.1 строка вместе с cos²x': ('cases/500366.1/solution.png', (40, 75, 330, 135)),
    '3c 500366.1 только строка cos x': ('cases/500366.1/solution.png', (40, 103, 330, 135)),
    # 505470.1: written x = π/3 + πk (student error), the reader writes π/6 (tg x = 1/√3 above)
    '4a 505470.1 фото целиком': ('cases/505470.1/solution.png', None),
    '4b 505470.1 серия вместе с tg x': ('cases/505470.1/solution.png', (175, 205, 417, 290)),
    '4c 505470.1 только строка серии': ('cases/505470.1/solution.png', (175, 260, 417, 290)),
}

if __name__ == '__main__':
    only = sys.argv[1:]
    for name, (src, box) in CROPS.items():
        if only and not any(name.startswith(o) for o in only):
            continue
        im = Image.open(src).convert('RGB')
        if box:
            im = im.crop(box)
        scale = 1 if box is None else 4
        im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
        im.save(os.path.join(OUT, name + '.png'))
        print(name, im.size)
