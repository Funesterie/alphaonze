import runpy
import traceback

ns = runpy.run_path(r"D:\funesterie\spaces\a11\app.py", run_name="not_main")
demo = ns["demo"]
try:
    app, local_url, share_url = demo.launch(server_name="127.0.0.1", server_port=7861, prevent_thread_lock=True, show_api=False)
    print("LAUNCH_OK", local_url, share_url)
    demo.close()
except Exception:
    traceback.print_exc()
