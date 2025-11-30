import os
import json

# Ruta base: carpeta donde está este script (para_git)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

JSON_DIR = os.path.join(BASE_DIR, "data", "json")
MANIFEST_PATH = os.path.join(BASE_DIR, "data", "manifest.json")

files = [
    f for f in os.listdir(JSON_DIR)
    if f.lower().endswith(".json")
]

files.sort()

print(f"Se encontraron {len(files)} archivos JSON.")

os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
    json.dump(files, f, ensure_ascii=False, indent=2)

print(f"Manifest generado en: {MANIFEST_PATH}")