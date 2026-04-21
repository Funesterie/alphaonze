import configparser
from huggingface_hub import HfApi

cfg = configparser.ConfigParser()
cfg.read(r"C:\Users\cella\.cache\huggingface\stored_tokens")
token = cfg.get("codex", "hf_token")
api = HfApi(token=token)
info = api.space_info("funeste/a11")
print(info)
