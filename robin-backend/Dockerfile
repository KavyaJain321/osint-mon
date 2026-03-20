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

EXPOSE 3001

# Use --expose-gc for manual GC in memory-constrained environments (Render free tier)
CMD ["node", "--expose-gc", "--dns-result-order=ipv4first", "src/index.js"]
