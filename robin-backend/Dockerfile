FROM node:20-slim

# Install FFmpeg and yt-dlp for video processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy application code
COPY . .

EXPOSE 10000

# --expose-gc: enables manual GC calls to keep RAM under 512MB on Render free tier
# --max-old-space-size: hard cap heap at 400MB (leaves headroom for subprocesses)
CMD ["node", "--expose-gc", "--max-old-space-size=400", "--dns-result-order=ipv4first", "src/index.js"]
