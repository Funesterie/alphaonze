import configparser
import os
from huggingface_hub import HfApi

cfg = configparser.ConfigParser()
cfg.read(r"C:\Users\cella\.cache\huggingface\stored_tokens")
token = cfg.get("codex", "hf_token")
api = HfApi(token=token)
result = api.upload_folder(
    repo_id="funeste/a11",
    repo_type="space",
    folder_path=r"D:\funesterie\spaces\a11",
    commit_message="Fix Gradio runtime boot and pin compatible FastAPI/Starlette",
)
print(result)
