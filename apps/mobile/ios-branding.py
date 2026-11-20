from pathlib import Path
from PIL import Image

project = Path(__file__).resolve().parent
assets = project / "ios/App/App/Assets.xcassets"
brand = Image.open(project.parents[1] / "packages/ui/tray-icon.png").convert("RGBA")
icon = Image.new("RGB", (1024, 1024), "white")
mark = brand.resize(icon.size, Image.Resampling.LANCZOS)
icon.paste(mark, (0, 0), mark)
icon.save(assets / "AppIcon.appiconset/AppIcon-512@2x.png")
for file in (assets / "Splash.imageset").glob("splash-*.png"):
    splash = Image.new("RGB", (1024, 1024), "white")
    mark = brand.resize((140, 140), Image.Resampling.LANCZOS)
    splash.paste(mark, (442, 442), mark)
    splash.save(file)
