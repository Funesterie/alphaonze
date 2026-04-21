import runpy
import traceback

ns = runpy.run_path(r"D:\funesterie\spaces\a11\app.py", run_name="not_main")
demo = ns["demo"]
print("demo_type", type(demo).__name__)
try:
    info = demo.get_api_info()
    print("API_OK", bool(info))
    print("keys", list(info.keys())[:10])
except Exception:
    traceback.print_exc()
