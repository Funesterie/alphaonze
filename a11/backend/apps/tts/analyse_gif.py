from PIL import Image
import os

ROOT_DIR = os.path.dirname(__file__)
GIF_PATH = os.path.join(ROOT_DIR, "A11_talking_smooth_8s.gif")

def get_gif_loop_count(path):
    try:
        with Image.open(path) as im:
            loop = im.info.get('loop', None)
            print(f"Loop count for {path}: {loop}")
    except Exception as e:
        print(f"Error reading {path}: {e}")

get_gif_loop_count(GIF_PATH)
