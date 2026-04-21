import configparser
from huggingface_hub import HfApi

cfg = configparser.ConfigParser()
cfg.read(r"C:\Users\cella\.cache\huggingface\stored_tokens")
token = cfg.get("codex", "hf_token")
api = HfApi(token=token)
commits = api.list_repo_commits("funeste/a11", repo_type="space")
for commit in commits[:5]:
    print(commit.commit_id, '|', commit.title)
