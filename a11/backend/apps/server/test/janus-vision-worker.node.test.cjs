const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('janus_vision_worker handles planner_text requests without requiring an image payload', () => {
  const workerPath = path.resolve(__dirname, '../tools/vision/janus_vision_worker.py');
  const inlineScript = `
import importlib.util
import json
import sys
import types

torch_mod = types.ModuleType("torch")
torch_mod.bfloat16 = "bfloat16"
torch_mod.float16 = "float16"
torch_mod.float32 = "float32"
torch_mod.inference_mode = lambda: (lambda fn: fn)
torch_mod.cuda = types.SimpleNamespace(is_available=lambda: False, is_bf16_supported=lambda: False)
sys.modules["torch"] = torch_mod

pil_mod = types.ModuleType("PIL")
pil_mod.Image = types.SimpleNamespace(open=lambda *args, **kwargs: None)
sys.modules["PIL"] = pil_mod

transformers_mod = types.ModuleType("transformers")
transformers_mod.__path__ = []
transformers_mod.AutoModelForCausalLM = object
sys.modules["transformers"] = transformers_mod

config_mod = types.ModuleType("transformers.configuration_utils")
config_mod.dataclass = lambda cls=None, *args, **kwargs: (cls if cls is not None else (lambda inner: inner))
sys.modules["transformers.configuration_utils"] = config_mod

janus_mod = types.ModuleType("janus")
janus_mod.__path__ = []
sys.modules["janus"] = janus_mod

janus_models_mod = types.ModuleType("janus.models")
janus_models_mod.VLChatProcessor = object
sys.modules["janus.models"] = janus_models_mod

spec = importlib.util.spec_from_file_location("janus_worker_under_test", r"${workerPath.replace(/\\/g, '\\\\')}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

module.ensure_model = lambda *args, **kwargs: (types.SimpleNamespace(device="cpu"), object(), object(), "cpu", "float32")
module.run_text_only = lambda *args, **kwargs: "plan interne ok"

response = module.handle_request(
    {"id": "req-1", "action": "planner_text", "prompt": "planifie cette sequence"},
    types.SimpleNamespace(model="fake-model", device="cpu", dtype="auto")
)
print(json.dumps(response))
`;

  const result = spawnSync('python', ['-c', inlineScript], {
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(String(result.stdout || '').trim().split(/\r?\n/).pop());
  assert.equal(payload.ok, true);
  assert.equal(payload.text, 'plan interne ok');
  assert.equal(payload.device, 'cpu');
});
