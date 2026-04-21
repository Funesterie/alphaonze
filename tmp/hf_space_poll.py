import configparser
import time
from huggingface_hub import HfApi

cfg = configparser.ConfigParser()
cfg.read(r"C:\Users\cella\.cache\huggingface\stored_tokens")
token = cfg.get("codex", "hf_token")
api = HfApi(token=token)
for i in range(6):
    info = api.space_info("funeste/a11")
    runtime = info.runtime
    stage = getattr(runtime, 'stage', None)
    print(i, stage, getattr(runtime, 'hardware', None), info.last_modified.isoformat())
    if stage not in {"BUILDING", "APP_STARTING", "RUNNING_BUILDING"}:
        break
    if i < 5:
        time.sleep(10)
