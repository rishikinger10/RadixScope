#!/bin/bash
# ops/sglang/launch.sh
# Launch SGLang server for RadixScope (M7 dependency)
# Day 0 initialization

echo "Checking NVIDIA SMI..."
nvidia-smi || { echo "NVIDIA SMI failed. Please check driver >= 580.65.06."; exit 1; }

echo "Starting SGLang v0.5.18 on port 30000..."
docker run --gpus all \
  --shm-size 8g \
  -p 30000:30000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -v ~/.cache/flashinfer:/root/.cache/flashinfer \
  --ipc=host \
  lmsysorg/sglang:v0.5.18 \
  python3 -m sglang.launch_server \
    --model-path Qwen/Qwen2.5-1.5B-Instruct \
    --context-length 8192 \
    --mem-fraction-static 0.85 \
    --host 0.0.0.0 \
    --port 30000 \
    --enable-metrics
