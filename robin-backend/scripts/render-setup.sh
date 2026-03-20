#!/usr/bin/env bash
# ============================================================
# ROBIN OSINT — Render Build Setup
# Downloads yt-dlp and ffmpeg static binaries into ./bin/
# Runs as part of the robin-worker buildCommand on Render.
# No apt-get, no sudo, no Docker — pure static binaries.
# ============================================================
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ROBIN Worker: Installing Binary Tools      ║"
echo "╚══════════════════════════════════════════════╝"

mkdir -p bin

# ── yt-dlp ────────────────────────────────────────────────
# Standalone Linux binary (Python bundled inside — no Python needed)
echo ""
echo "→ Downloading yt-dlp..."
curl -sSfL \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" \
  -o bin/yt-dlp
chmod +x bin/yt-dlp
echo "  ✓ yt-dlp $(./bin/yt-dlp --version)"

# ── ffmpeg ────────────────────────────────────────────────
# Static GPL build from BtbN — no system dependencies needed
echo ""
echo "→ Downloading ffmpeg (static build)..."
mkdir -p /tmp/ffmpeg-extract
curl -sSfL \
  "https://github.com/BtbN/ffmpeg-builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz" \
  | tar -xJ -C /tmp/ffmpeg-extract --strip-components=1

cp /tmp/ffmpeg-extract/bin/ffmpeg bin/ffmpeg
cp /tmp/ffmpeg-extract/bin/ffprobe bin/ffprobe 2>/dev/null || true
rm -rf /tmp/ffmpeg-extract
chmod +x bin/ffmpeg bin/ffprobe 2>/dev/null || true
echo "  ✓ $(./bin/ffmpeg -version 2>&1 | head -1)"

# ── Summary ───────────────────────────────────────────────
echo ""
echo "Binaries ready:"
ls -lh bin/
echo ""
echo "✅ Render setup complete"
