# WSL2 Setup — SGLang Recovery Path

This document covers running the pinned SGLang server on a Windows 11 machine
without Docker Desktop, for contributors whose Ubuntu boot volume is unavailable.

This is the **recovery path**. The supported path is native Ubuntu with the
`lmsysorg/sglang:v0.5.18` container. Measurements taken here are classified
separately.

---

## 1. Why Native Windows Does Not Work

Attempting `pip install sglang` in PowerShell fails at dependency resolution:

```
ERROR: Could not find a version that satisfies the requirement apache-tvm-ffi==0.1.0b15
ERROR: Failed to build 'flashinfer_python' when installing build dependencies
```

This is not a fixable pin. There are two independent blockers.

### Blocker 1 — FlashInfer is a core dependency

In `python/pyproject.toml`, `flashinfer_python[cu13]` and `apache-tvm-ffi` appear
in the top-level `dependencies` array with no platform marker. They are not
extras. No install invocation skips them.

Neither publishes Windows wheels, so pip falls back to a source build requiring a
CUDA C++ toolchain.

**Do not** attempt to solve this by locating a wheel or installing Build Tools.
It leads to Blocker 2.

### Blocker 2 — uvloop

`sglang/srt/entrypoints/http_server.py`:

```python
import uvloop                                        # line 48
asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())   # line 190
```

The import is unconditional and executes at module load. uvloop has never
supported Windows — there is no wheel and the source will not build against the
Windows event loop. `sglang.launch_server` cannot import on Windows regardless of
what else is resolved.

### What does not help

| Proposed workaround | Result |
|---|---|
| Pin an older SGLang release | Both blockers predate v0.5.18 substantially. |
| Hand-install a FlashInfer wheel | No Windows wheel exists; also leaves Blocker 2. |
| `--attention-backend triton` | Runtime kernel selection. Does not affect install-time dependencies or uvloop. |
| Install C++ Build Tools | Addresses Blocker 1 at best. Leaves Blocker 2 and the Linux-only kernel wheels. |

Also Linux-only in core dependencies: `sglang-kernel`, `sgl-deep-gemm`,
`sgl-deep-ep`, `quack-kernels`, `torch_memory_saver`, `tokenspeed_mla`,
`humming-kernels`, `tilelang`.

SGLang's installation documentation covers NVIDIA, AMD, Apple Metal, Intel Xeon,
TPU, Jetson, Ascend NPU, and Intel XPU. Windows is absent.

### The actual bypass

Do not make SGLang run on Windows. Run it in a Linux userspace on the same
machine, where every wheel above already exists. WSL2 provides that, and
**Docker Desktop is not required** — SGLang is installed directly into the WSL2
Ubuntu environment with pip.

---

## 2. Prerequisites

- Windows 11
- NVIDIA GPU with a current **Windows** driver installed
- ~15 GB free disk for the distro, model weights, and CUDA libraries
- Administrator access for the one-time WSL2 install

---

## 3. Install WSL2 and Ubuntu

In an **Administrator** PowerShell:

```powershell
wsl --install -d Ubuntu-24.04
```

Reboot if prompted. On first launch, create a UNIX username and password.

Confirm the distro is on WSL version 2 — version 1 has no GPU passthrough:

```powershell
wsl --list --verbose
```

If it reports `1`:

```powershell
wsl --set-version Ubuntu-24.04 2
```

---

## 4. Verify GPU Passthrough

> **Do not install an NVIDIA driver inside WSL.** The Windows driver is projected
> into the distro. Installing a Linux driver inside WSL breaks passthrough and is
> the most common failure in this setup.

Inside the Ubuntu shell:

```bash
nvidia-smi
```

The GPU and its VRAM should be listed. If the command is missing or reports no
device, update the Windows NVIDIA driver and restart WSL:

```powershell
wsl --shutdown
```

You need the CUDA **toolkit** only if building from source. The runtime libraries
arrive with the pip wheels.

---

## 5. Resource Limits

WSL2 defaults can starve model loading on a 16 GB host. Create
`C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
memory=12GB
swap=8GB
```

Then `wsl --shutdown` and reopen the distro. Adjust `memory` to leave Windows
enough to remain responsive; the value above assumes a 16 GB machine.

---

## 6. Python Environment

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip git
python3 -m venv ~/.venvs/radixscope
source ~/.venvs/radixscope/bin/activate
pip install --upgrade pip
pip install uv
```

Python 3.10 or newer is required.

---

## 7. Install SGLang v0.5.18

Pin the version. Do not install latest — the RadixScope measurement contract is
version-specific.

```bash
git clone -b v0.5.18 https://github.com/sgl-project/sglang.git
cd sglang
pip install -e "python"
```

Alternatively, from PyPI with the pinned version:

```bash
uv pip install --prerelease=allow "sglang==0.5.18"
```

The `--prerelease=allow` flag matters: several SGLang dependencies publish only
pre-releases, and uv versions older than 0.12.0 will otherwise resolve silently to
an older SGLang.

### CUDA 12 hosts

SGLang defaults to CUDA 13 wheels. If your driver requires CUDA 12:

```bash
uv pip install --force-reinstall torch==2.13.0 torchaudio==2.11.0 torchvision \
  --index-url https://download.pytorch.org/whl/cu129
uv pip install --force-reinstall sglang-kernel \
  --index-url https://docs.sglang.ai/whl/cu129/
uv pip install --force-reinstall sgl-deep-gemm \
  --index-url https://docs.sglang.ai/whl/cu129/ --no-deps
```

### If you hit `CUDA_HOME is not set`

```bash
export CUDA_HOME=/usr/local/cuda-<version>
```

Or install FlashInfer first per its own documentation, then reinstall SGLang.

---

## 8. Launch the Server

```bash
python3 -m sglang.launch_server \
  --model-path Qwen/Qwen2.5-1.5B-Instruct \
  --context-length 8192 \
  --host 127.0.0.1 \
  --port 30000 \
  --enable-metrics
```

Note the model: **Qwen2.5**-1.5B-Instruct. Qwen2-1.5B-Instruct is a different
checkpoint with a different tokenizer revision. Substituting it silently breaks
comparability with every prior RadixScope measurement.

First launch downloads roughly 3 GB of weights. Set `HF_TOKEN` if the model
requires authentication.

Weights are cached in `~/.cache/huggingface` **inside the distro**. Reading them
from a Windows path over `/mnt/c/` is markedly slower; keep them in the Linux
filesystem.

---

## 9. Acceptance Checks

Run all four before treating the environment as usable.

**Liveness.** Use `/health` only. Never `/health_generate` — it performs inference
and populates the cache.

```bash
curl http://127.0.0.1:30000/health
```

**Flush.** `/flush_cache` accepts GET and POST with a `timeout` query parameter.

```bash
curl -X POST "http://127.0.0.1:30000/flush_cache?timeout=30"
```

**`cached_tokens` presence.** RadixScope's primary metric. If this field is absent
from `meta_info`, stop — the environment is `UNAVAILABLE`, not degraded.

```bash
curl -s http://127.0.0.1:30000/generate \
  -H "Content-Type: application/json" \
  -d '{"text":"hello","sampling_params":{"temperature":0,"max_new_tokens":8}}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['meta_info'])"
```

**Cold start.** Flush, then issue one request and confirm `cached_tokens` is at or
near zero. SGLang runs a warm-up generation at startup before advertising
readiness, so the cache is **not** empty when the server first responds. The flush
is mandatory, not defensive.

---

## 10. VRAM on 8 GB Cards

Qwen2.5-1.5B in BF16 needs roughly 3 GB for weights; the remainder is KV cache and
CUDA overhead. If the server fails to allocate, reduce the static memory fraction:

```bash
--mem-fraction-static 0.7
```

Do not reach for quantization. AWQ, GPTQ, and GGUF are out of scope, and switching
precision invalidates comparison against any BF16 measurement.

The approved fallback is `Qwen/Qwen2.5-0.5B-Instruct`, and only after the primary
model fails the acceptance checks in §9.

---

## 11. Recording the Environment

Runs executed under WSL2 must record it. WSL2 adds a virtualization layer between
the process and the GPU; latency figures are not directly comparable to native
Ubuntu, though `cached_tokens` — an engine-internal count — is unaffected.

Classify accordingly in `docs/architecture/sglang-integration.md`:

- SGLang API behaviour confirmed here → `RUNTIME_VERIFIED_LAPTOP`, annotated `WSL2`
- Timing figures → measured, but not comparable across environments

Never present a WSL2 timing measurement and a native Ubuntu timing measurement as
two points on the same axis.
