import React, { useState, useEffect } from "react";

// Dummy API calls (replace with your backend endpoints)
const fetchGpuStatus = async () => {
  // Example: GET /api/gpu-status
  // Return { gpuOn: true, tokensPerSec: 28 }
  return { gpuOn: true, tokensPerSec: Math.floor(Math.random() * 30) + 10 };
};
const switchBackend = async (backend) => {
  // Example: POST /api/switch-backend { backend }
  return backend;
};
const turboGpu = async () => {
  // Example: POST /api/turbo-gpu
  return true;
};

export default function LlamaGpuControlPanel() {
  const [gpuOn, setGpuOn] = useState(false);
  const [tokensPerSec, setTokensPerSec] = useState(0);
  const [backend, setBackend] = useState("llama.cpp");
  const [loading, setLoading] = useState(false);
  const [temperature, setTemperature] = useState(0.7);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const status = await fetchGpuStatus();
      if (mounted) {
        setGpuOn(status.gpuOn);
        setTokensPerSec(status.tokensPerSec);
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleSwitch = async () => {
    setLoading(true);
    const next = backend === "llama.cpp" ? "Ollama" : "llama.cpp";
    await switchBackend(next);
    setBackend(next);
    setLoading(false);
  };

  const handleTurbo = async () => {
    setLoading(true);
    await turboGpu();
    setLoading(false);
  };

  const handleTemperatureChange = (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v)) setTemperature(v);
    // TODO: call API to set temperature on backend if needed
  };

  return (
    <div className="bg-gray-900 text-white p-4 rounded shadow flex flex-col gap-4 w-full max-w-md mx-auto z-50" style={{ position: 'relative' }}>
      <h2 className="text-lg font-bold mb-2">Contrôle GPU Llama.cpp</h2>
      <div className="flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded-full ${gpuOn ? "bg-green-500" : "bg-red-500"}`}></span>
        <span>{gpuOn ? "GPU ON" : "GPU OFF"}</span>
      </div>
      <div>
        <span className="font-mono">Vitesse : </span>
        <span className="font-bold">{tokensPerSec} tokens/s</span>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="setTemp" className="text-sm">Température</label>
        <input
          id="setTemp"
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={temperature}
          onChange={handleTemperatureChange}
          className="ml-2 w-24 bg-gray-800 text-white rounded px-2 py-1 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Température du modèle"
          title="Température (0.0 - 2.0)"
        />
      </div>

      <div className="flex gap-2">
        <button
          className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded"
          onClick={handleTurbo}
          disabled={loading}
        >
          Turbo GPU
        </button>
        <button
          className="bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded"
          onClick={handleSwitch}
          disabled={loading}
        >
          Switch {backend === "llama.cpp" ? "→ Ollama" : "→ llama.cpp"}
        </button>
      </div>
      <div>
        <span className="font-mono">Backend actuel : </span>
        <span className="font-bold">{backend}</span>
      </div>
    </div>
  );
}
