// ============================================================
// ROBIN OSINT — Video Processor Configuration
// Centralized settings for transcription, clips, and summaries
// ============================================================

import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir } from 'fs/promises';

// ── Directories ──────────────────────────────────────────────
// On Render, /tmp is always writable. Locally, use OS temp dir.
const TEMP_DIR = process.env.VIDEO_PROCESSOR_TEMP_DIR || join(tmpdir(), 'robin_video_processor');

export const VIDEO_CONFIG = {
    // Temp directories (ephemeral — files are cleaned up after upload to Supabase/Cloudinary)
    tempDir: TEMP_DIR,
    audioDir: join(TEMP_DIR, 'audio'),
    clipsDir: join(TEMP_DIR, 'clips'),

    // External binary paths
    // Docker (Render): installed system-wide via apt-get (ffmpeg) + pip (yt-dlp)
    // Local dev: install ffmpeg + yt-dlp on your PATH, or override via env vars
    ytDlpPath:  process.env.YTDLP_PATH  || 'yt-dlp',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',

    // ── Groq Whisper Transcription ──────────────────────────
    whisperModel: 'whisper-large-v3-turbo',
    maxAudioSizeBytes: 25 * 1024 * 1024, // 25MB Groq limit
    audioSampleRate: 16000,              // 16kHz mono for optimal Whisper
    audioChannels: 1,

    // ── Clip Generation ─────────────────────────────────────
    clipDurationBefore: 14,  // seconds before keyword
    clipDurationAfter: 14,   // seconds after keyword
    clipMergeThreshold: 5,   // merge clips if gap < 5s
    maxClipsPerVideo: 50,    // safety cap

    // ── AI Summary ──────────────────────────────────────────
    summaryTemperature: 0.3,
    summaryMaxTokens: 300,
    clipSummaryMaxTokens: 200,

    // ── Supabase Storage ────────────────────────────────────
    storageBucket: 'video-clips',

    // ── Pipeline ────────────────────────────────────────────
    pipelineTimeoutMs: 10 * 60 * 1000, // 10 min max per video
    ytDlpTimeout: 300000,              // 5 min for audio download
    maxVideoDuration: 1800,            // skip videos > 30 min
};

/**
 * Ensure temp directories exist.
 */
export async function ensureDirs() {
    for (const dir of [VIDEO_CONFIG.tempDir, VIDEO_CONFIG.audioDir, VIDEO_CONFIG.clipsDir]) {
        await mkdir(dir, { recursive: true }).catch(() => {});
    }
}
