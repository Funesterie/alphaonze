import configparser
from huggingface_hub import snapshot_download

cfg = configparser.ConfigParser()
cfg.read(r"C:\Users\cella\.cache\huggingface\stored_tokens")
token = cfg.get("codex", "hf_token")
path = snapshot_download(
    repo_id="funeste/a11",
    repo_type="space",
    local_dir=r"D:\funesterie\tmp\hf-a11-verify",
    force_download=True,
    token=token,
)
print(path)
