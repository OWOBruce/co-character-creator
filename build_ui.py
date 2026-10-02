"""Turn the game's own UI art (texture_library/ui in the game's archives) into the editor's skin: viewer/ui/*.png.

Usage: python build_ui.py
The costume-creator kit pieces are greyscale 9-slice parts (black ink outline, white fill) that the game
tints; they are assembled into 24x24 sheets for CSS border-image and tinted here.
"""
import io
import os

from PIL import Image

from gamefs import open_game

THEME = 'Champions_PC_Theme'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'viewer', 'ui')

# tints for the greyscale kits (the game's blue / gold comic palette)
TINTS = {
    'panel_dark': ('CC_Panel_Greyscale', (22, 58, 118)),     # side panel, pop-ups
    'panel_deep': ('CC_Panel_Greyscale', (12, 32, 70)),      # boxes inside panels
    'button': ('CC_Panel_Greyscale', (32, 102, 204)),        # buttons, tabs
    'button_hover': ('CC_Panel_Greyscale', (58, 140, 240)),
    'button_on': ('CC_Paddle_Greyscale', (255, 196, 32)),    # selected tab / choice
    'field': ('CC_Paddle_Greyscale', (10, 26, 56)),          # cycler name fields, inputs
    'field_hover': ('CC_Paddle_Greyscale', (18, 48, 98)),
}
COPY = {  # published name -> source (relative to dds/ui)
    'slider_empty.png': r'Widgets\slider\Slider_Bar_Empty.dds',
    'slider_full.png': r'Widgets\slider\Slider_Bar_Full.dds',
    'slider_focused.png': r'Widgets\slider\Slider_Bar_Focused.dds',
    'slider_thumb.png': r'Widgets\slider\Slider_Scroller.dds',
    'slider_thumb_hover.png': r'Widgets\slider\Slider_Scroller_Mouseover.dds',
    'color_frame.png': r'Champions_PC_Theme\Costume_Creator_Misc\CC_Button_Color_Idle.dds',
    'color_frame_hover.png': r'Champions_PC_Theme\Costume_Creator_Misc\CC_Button_Color_Mouseover.dds',
    'color_glow.png': r'Champions_PC_Theme\Costume_Creator_Misc\CC_Button_Color_Glow_Overlay.dds',
    'header_glow.png': r'Champions_PC_Theme\Widgets\Category_Header_Background_320.dds',
    'zippatone.png': r'Champions_PC_Theme\Costume_Creator_Misc\CC_Zippatone_Vertical_Tile_244.dds',
    'frame_orange.png': r'Champions_PC_Theme\Costume_Creator_Misc\CC_Frame_Orange_Bottom.dds',
}
# the cycler arrows and the unlock badges, under their own names
COPY.update({f'{n}.png': rf'Champions_PC_Theme\Costume_Creator_Misc\{n}.dds'
             for n in [f'CC_Arrow_{side}_{state}' for side in ('Left', 'Right') for state in ('Idle', 'Mouseover', 'Pushed')]
             + ['CC_Costume_Locked', 'CC_Costume_Purchased']})


def ui(rel):
    """A UI texture (path under texture_library/ui, e.g. Widgets\\slider\\X.dds) as an image, from the archives."""
    path = 'texture_library/ui/' + rel.replace('\\', '/')[:-len('.dds')] + '.wtex'
    data = open_game().dds(path)
    if data is None:
        raise FileNotFoundError(path)
    return Image.open(io.BytesIO(data))


def nine(prefix):
    kit = os.path.join(THEME, 'Costume_Creator_Kits')
    g = lambda n: ui(os.path.join(kit, f'{prefix}_{n}.dds')).convert('RGBA')
    out = Image.new('RGBA', (24, 24))
    for name, pos in (('Top_Left', (0, 0)), ('Top_Right', (16, 0)), ('Bottom_Left', (0, 16)), ('Bottom_Right', (16, 16))):
        out.paste(g(name), pos)
    for name, pos in (('Top', (8, 0)), ('Bottom', (8, 16)), ('Left', (0, 8)), ('Right', (16, 8)), ('Middle', (8, 8))):
        out.paste(g(name).resize((8, 8), Image.NEAREST), pos)
    return out


def tint(im, rgb):
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            k = r / 255  # greyscale: white takes the tint, black stays ink
            px[x, y] = (round(rgb[0] * k), round(rgb[1] * k), round(rgb[2] * k), a)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for e in os.scandir(OUT):  # start clean (keeping the folder), so the page can't rely on a leftover file
        if e.is_file():
            os.remove(e.path)
    for name, (prefix, rgb) in TINTS.items():
        tint(nine(prefix), rgb).save(os.path.join(OUT, name + '.png'))
    for name, src in COPY.items():
        ui(src).convert('RGBA').save(os.path.join(OUT, name))
    bg = ui(os.path.join(THEME, 'Screen_Backgrounds', 'Screen_BG_Tailor_01.dds')).convert('RGB')
    bg.save(os.path.join(OUT, 'backdrop.jpg'), quality=85)
    # the comic cover the game draws saved costumes on (Costume_<account>_<name>_CC_Comic_Page_Blue_<time>.jpg)
    cover = ui(os.path.join('CharacterCreation', 'CC_Comic_Page_Blue.dds')).convert('RGB')
    cover.save(os.path.join(OUT, 'cover.jpg'), quality=90)
    print('wrote', len(TINTS) + len(COPY) + 2, 'files to', OUT)


if __name__ == '__main__':
    main()
