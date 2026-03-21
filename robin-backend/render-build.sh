#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Installing Node dependencies..."
npm install

echo "Downloading yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
chmod a+rx yt-dlp

echo "Downloading FFmpeg statically compiled for Linux..."
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ffmpeg.tar.xz
mkdir -p ffmpeg-static
tar -xf ffmpeg.tar.xz -C ffmpeg-static --strip-components=1
cp ffmpeg-static/ffmpeg ./ffmpeg
cp ffmpeg-static/ffprobe ./ffprobe
chmod a+rx ffmpeg ffprobe
rm -rf ffmpeg-static ffmpeg.tar.xz

echo "Build complete! yt-dlp and ffmpeg are ready in the root directory."
