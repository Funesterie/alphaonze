import json
from pathlib import Path

def mask_to_python(mask):
    task = mask.get("task", {})
    inputs = mask.get("inputs", {})
    options = mask.get("options", {})
    constraints = mask.get("constraints", {})

    if task.get("domain") == "filesystem" and task.get("action") == "sort_images":
        folder_path = inputs.get("path", ".")
        extensions = inputs.get("extensions", ["png"])
        sort_by = options.get("sort_by", "date")
        recursive = options.get("recursive", False)
        safe_mode = constraints.get("safe_mode", True)
        no_delete = constraints.get("no_delete", True)

        # Normalize extensions
        normalized_exts = []
        for ext in extensions:
            ext_str = str(ext).strip().lower().lstrip(".")
            if ext_str:
                normalized_exts.append(ext_str)
        if not normalized_exts:
            normalized_exts = ["png"]

        # Sort expression
        if sort_by == "date":
            sort_expr = "p.stat().st_mtime"
        elif sort_by == "name":
            sort_expr = "p.name.lower()"
        elif sort_by == "size":
            sort_expr = "p.stat().st_size"
        else:
            sort_expr = "p.stat().st_mtime"

        glob_method = "rglob" if recursive else "glob"
        patterns_code = ", ".join(repr(f"*.{ext}") for ext in normalized_exts)

        code = f'''from pathlib import Path

folder = Path(r"{folder_path}")
patterns = [{patterns_code}]
files = []

for pattern in patterns:
    files.extend(folder.{glob_method}(pattern))

files = sorted(files, key=lambda p: {sort_expr})

for i, f in enumerate(files, start=1):
    print(f"{{i:03d}} - {{f.name}}")
'''
        return code
    return "# Unsupported MASK task"

if __name__ == "__main__":
    with open("mask_python_example.json", "r", encoding="utf-8") as f:
        mask = json.load(f)
    print(mask_to_python(mask))
