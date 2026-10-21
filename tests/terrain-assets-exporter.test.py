"""Small offline checks for selection, transparency, integrity and publication."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("terrain_exporter", REPO / "scripts/build-terrain-assets.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class TerrainExporterTests(unittest.TestCase):
    def setUp(self):
        (REPO / ".local").mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="test-terrain-export-", dir=REPO / ".local")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def source(self, relative, image):
        file = self.root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        image.save(file, "PNG")
        data = file.read_bytes()
        return {"x": 29, "y": 71, "path": relative, "bytes": len(data), "sha256": exporter.digest(data), "status": "rendered"}

    def test_near_empty_community_uses_certified_cache_and_preserves_black_cache_floors(self):
        community = self.source("terrain/28/2/0_29_71.png", Image.new("RGBA", (256, 256), "black"))
        cache = self.source("terrain.cache-fixture/28/2/0_29_71.png", Image.new("RGBA", (256, 256), "black"))
        image, selected, rejected = exporter.select_image(self.root, [(community, "community"), (cache, "cache")])
        self.assertEqual(selected["source"], "cache")
        self.assertEqual(image.getpixel((0, 0)), (0, 0, 0, 255))
        self.assertTrue(rejected[0]["rejectedBlank"])
        (self.root / cache["path"]).write_bytes(b"altered")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            exporter.select_image(self.root, [(cache, "cache")])

    def test_lossless_preserves_rgba_including_transparent_rgb_and_lossy_preserves_alpha(self):
        image = Image.new("RGBA", (256, 256), (17, 81, 123, 0))
        image.paste((0, 0, 0, 255), (20, 20, 80, 80))
        image.paste((200, 110, 80, 127), (80, 20, 120, 80))
        data = exporter.encode(image)
        self.assertEqual(Image.open(io.BytesIO(data)).convert("RGBA").tobytes(), image.tobytes())
        for quality in (90, 95, 100):
            decoded = Image.open(io.BytesIO(exporter.encode(image, lossless=False, quality=quality))).convert("RGBA")
            self.assertEqual(decoded.getchannel("A").tobytes(), image.getchannel("A").tobytes())

    def test_build_publishes_verified_manifest_last_with_transparent_page_padding_and_refuses_overwrite(self):
        source = Image.new("RGBA", (256, 256))
        source.paste((120, 60, 10, 255), (0, 0, 128, 256))
        tile = self.source("terrain.cache-fixture/28/2/0_29_71.png", source)
        manifest = {"cacheTerrain": {"mapId": 28, "plane": 0, "zoom": 2, "iconFree": True,
            "layoutComplete": True, "transparentWater": True, "oceanColor": "#60769a",
            "directory": "terrain.cache-fixture/28/2", "tiles": [tile]}}
        manifest_data = exporter.json_bytes(manifest)
        output = self.root / "output"
        exporter.build(self.root, manifest_data, manifest, (29, 71, 1, 1), output)
        bundle_path = next(output.glob("*/manifest.json"))
        bundle = json.loads(bundle_path.read_bytes())
        descriptor = json.loads((bundle_path.parent / "descriptor.json").read_bytes())
        self.assertEqual(descriptor["manifestSha256"], exporter.digest(bundle_path.read_bytes()))
        self.assertEqual(bundle["provenance"]["inputs"][0]["sha256"], tile["sha256"])
        for entry in bundle["tiles"] + bundle["pages"]:
            data = (output / entry["path"]).read_bytes()
            self.assertEqual(entry["sha256"], exporter.digest(data))
            self.assertEqual(entry["bytes"], len(data))
        page = Image.open(output / bundle["pages"][0]["path"]).convert("RGBA")
        self.assertEqual(page.getpixel((128, 128)), (0, 0, 0, 0))
        self.assertEqual(page.getpixel((63, 20))[3], 0)
        self.assertEqual(page.getpixel((0, 20)), (120, 60, 10, 255))
        native = Image.open(output / bundle["tiles"][0]["path"]).convert("RGBA")
        self.assertEqual(native.tobytes(), source.tobytes())
        with self.assertRaises(FileExistsError):
            exporter.build(self.root, manifest_data, manifest, (29, 71, 1, 1), output)


if __name__ == "__main__":
    unittest.main()
