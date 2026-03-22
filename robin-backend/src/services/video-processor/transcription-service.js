// ============================================================
// ROBIN OSINT — Groq Whisper Transcription Service
// Downloads YouTube audio → sends to Groq Whisper API
// Returns word-level + segment-level timestamps
// Handles: large files (chunked), 401 key rotation, auto language detection
// ============================================================

import { spawn } from 'child_process';
import { readFile, unlink, stat, readdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { VIDEO_CONFIG, ensureDirs } from './config.js';
import { log } from '../../lib/logger.js';
import Groq from 'groq-sdk';

// ── Key management ───────────────────────────────────────────
// Track keys that returned 401 so we skip them on future calls
const invalidKeyIndices = new Set();

function getAllKeys() {
    const keys = [];
    for (let i = 1; i <= 20; i++) {
        if (!invalidKeyIndices.has(i)) {
            const key = process.env[`GROQ_API_KEY_${i}`];
            if (key) keys.push({ key, index: i });
        }
    }
    return keys;
}

function getGroqClient() {
    const keys = getAllKeys();
    if (keys.length === 0) throw new Error('No valid GROQ_API_KEY found (all keys exhausted or invalid)');
    const idx = Math.floor(Date.now() / 1000) % keys.length;
    return { client: new Groq({ apiKey: keys[idx].key }), keyIndex: keys[idx].index };
}

// ── Audio download ───────────────────────────────────────────

/**
 * Download audio from a YouTube video using yt-dlp.
 * Outputs 16kHz mono WAV for optimal Whisper performance.
 */
export async function downloadAudio(videoId) {
    await ensureDirs();

    // Use a unique prefix so we can reliably find the output file regardless of extension
    const filePrefix = `${videoId}_${randomUUID().slice(0, 8)}`;
    const outputTemplate = join(VIDEO_CONFIG.audioDir, `${filePrefix}.%(ext)s`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    await new Promise((resolve, reject) => {
        const proc = spawn(VIDEO_CONFIG.ytDlpPath, [
            '-x',                          // Extract audio only
            '--audio-format', 'wav',       // Convert to WAV
            '--postprocessor-args', `ffmpeg:-ar ${VIDEO_CONFIG.audioSampleRate} -ac ${VIDEO_CONFIG.audioChannels}`,
            '--ffmpeg-location', VIDEO_CONFIG.ffmpegPath,
            '--extractor-args', 'youtube:player-client=android', // Bypass "Sign in to confirm you're not a bot"
            '-o', outputTemplate,
            '--no-playlist',
            '--no-warnings',
            '--match-filter', `!is_live & duration<${VIDEO_CONFIG.maxVideoDuration}`,
            videoUrl,
        ], { timeout: VIDEO_CONFIG.ytDlpTimeout });

        const timeout = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('yt-dlp audio download timed out'));
        }, VIDEO_CONFIG.ytDlpTimeout);

        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else reject(new Error(`yt-dlp failed (code ${code}): ${stderr.substring(0, 200)}`));
        });
        proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    // yt-dlp may produce .wav, .webm, .mp3, .m4a, .opus etc. depending on the video and ffmpeg.
    // Scan the audio directory for any file starting with our unique prefix.
    const AUDIO_EXTENSIONS = new Set(['.wav', '.webm', '.mp3', '.m4a', '.ogg', '.opus', '.flac', '.aac']);
    const files = await readdir(VIDEO_CONFIG.audioDir);

    // Log all files with this prefix for diagnostics
    const prefixFiles = files.filter(f => f.startsWith(filePrefix));
    log.ai.info('Audio dir scan after yt-dlp', { videoId, filePrefix, found: prefixFiles });

    const audioFile = prefixFiles.find(f => {
        const ext = f.slice(f.lastIndexOf('.')).toLowerCase();
        return AUDIO_EXTENSIONS.has(ext);
    });

    if (!audioFile) {
        // yt-dlp exited 0 but produced no audio — video likely has DRM, is private, or is geo-blocked
        throw new Error(`Audio file not found after yt-dlp download (prefix: ${filePrefix}) — video may be private, DRM-protected, or geo-blocked`);
    }

    const resolvedPath = join(VIDEO_CONFIG.audioDir, audioFile);
    log.ai.info('Audio file located', { videoId, file: audioFile, ext: audioFile.slice(audioFile.lastIndexOf('.')) });
    return resolvedPath;
}

// ── Audio chunking (for files > 25MB) ───────────────────────

/**
 * Estimate audio duration from WAV file size.
 * WAV at 16kHz mono 16-bit: bytes_per_second = 16000 * 2 = 32000
 */
function estimateWavDuration(fileSizeBytes) {
    const WAV_HEADER_BYTES = 44;
    const BYTES_PER_SECOND = VIDEO_CONFIG.audioSampleRate * 2; // 16-bit = 2 bytes
    return Math.max(0, (fileSizeBytes - WAV_HEADER_BYTES) / BYTES_PER_SECOND);
}

/**
 * Split a WAV file into chunks using ffmpeg.
 * Each chunk is at most MAX_CHUNK_DURATION seconds.
 */
async function splitAudioIntoChunks(audioPath, totalDurationSeconds) {
    // Target ~23MB per chunk (safely under Groq's 25MB limit)
    const MAX_CHUNK_BYTES = 23 * 1024 * 1024;
    const BYTES_PER_SECOND = VIDEO_CONFIG.audioSampleRate * 2;
    const maxChunkDuration = Math.floor(MAX_CHUNK_BYTES / BYTES_PER_SECOND); // ~718s

    const chunks = [];
    let start = 0;
    let index = 0;

    while (start < totalDurationSeconds) {
        const duration = Math.min(maxChunkDuration, totalDurationSeconds - start);
        const chunkPath = audioPath.replace('.wav', `_chunk${index}.wav`);

        await new Promise((resolve, reject) => {
            const proc = spawn(VIDEO_CONFIG.ffmpegPath, [
                '-i', audioPath,
                '-ss', String(start),
                '-t', String(duration),
                '-ar', String(VIDEO_CONFIG.audioSampleRate),
                '-ac', String(VIDEO_CONFIG.audioChannels),
                '-y',
                chunkPath,
            ], { timeout: 60000 });

            let stderr = '';
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg split failed (code ${code}): ${stderr.substring(0, 100)}`));
            });
            proc.on('error', reject);
        });

        chunks.push({ path: chunkPath, startOffset: start, duration });
        start += duration;
        index++;
    }

    log.ai.info('Audio split into chunks', { totalChunks: chunks.length, totalDuration: totalDurationSeconds });
    return chunks;
}

/**
 * Merge transcription results from multiple chunks.
 * Applies time offsets to all timestamps.
 */
function mergeChunkTranscripts(chunkResults) {
    const merged = {
        text: '',
        segments: [],
        words: [],
        duration: 0,
        language: chunkResults[0]?.language || 'unknown',
    };

    for (const { transcript, startOffset } of chunkResults) {
        if (!transcript) continue;

        merged.text += (merged.text ? ' ' : '') + transcript.text;

        for (const seg of transcript.segments) {
            merged.segments.push({
                start: seg.start + startOffset,
                end: seg.end + startOffset,
                text: seg.text,
            });
        }

        for (const word of transcript.words) {
            merged.words.push({
                word: word.word,
                start: word.start + startOffset,
                end: word.end + startOffset,
            });
        }

        merged.duration = Math.max(merged.duration, startOffset + transcript.duration);
    }

    return merged;
}

// ── Single-file transcription ────────────────────────────────

/**
 * Transcribe a single audio file via Groq Whisper.
 * Rotates away from 401 keys permanently; retries on transient errors.
 */
async function transcribeSingleFile(audioPath) {
    const maxAttempts = Math.max(3, getAllKeys().length);
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { client, keyIndex } = getGroqClient();

        try {
            const transcription = await client.audio.transcriptions.create({
                file: createReadStream(audioPath),
                model: VIDEO_CONFIG.whisperModel,
                response_format: 'verbose_json',
                timestamp_granularities: ['word', 'segment'],
                // No 'language' — let Whisper auto-detect (handles Odia, Hindi, English, etc.)
            });

            return {
                text: transcription.text || '',
                segments: (transcription.segments || []).map(s => ({
                    start: s.start,
                    end: s.end,
                    text: s.text?.trim() || '',
                })),
                words: (transcription.words || []).map(w => ({
                    word: w.word?.trim() || '',
                    start: w.start,
                    end: w.end,
                })),
                duration: transcription.duration || 0,
                language: transcription.language || 'unknown',
            };
        } catch (error) {
            lastError = error;
            const status = error.status || 0;

            if (status === 401) {
                // Key is permanently invalid — blacklist it and immediately try next
                invalidKeyIndices.add(keyIndex);
                log.ai.warn(`Groq key ${keyIndex} is invalid (401) — blacklisted`, {
                    remainingKeys: getAllKeys().length,
                });
                if (getAllKeys().length === 0) break; // No keys left
                continue; // Don't wait, just retry with next key
            }

            if (status === 413) {
                // File too large — caller should chunk it; don't retry
                throw new Error(`Audio file too large for Groq Whisper (413): ${error.message}`);
            }

            log.ai.warn(`Whisper attempt ${attempt + 1} failed`, {
                keyIndex,
                status,
                error: error.message?.substring(0, 100),
            });

            if (attempt < maxAttempts - 1) {
                await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            }
        }
    }

    throw new Error(`Whisper transcription failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

// ── Public API ───────────────────────────────────────────────

/**
 * Transcribe an audio file.
 * Automatically splits files > 25MB into chunks before sending to Whisper.
 */
export async function transcribeAudio(audioPath) {
    const fileStat = await stat(audioPath);

    if (fileStat.size <= VIDEO_CONFIG.maxAudioSizeBytes) {
        // Normal path — single file
        return await transcribeSingleFile(audioPath);
    }

    // File too large — split into chunks
    const totalDuration = estimateWavDuration(fileStat.size);
    log.ai.info('Audio exceeds 25MB — splitting into chunks', {
        sizeMB: Math.round(fileStat.size / 1024 / 1024),
        estimatedDuration: Math.round(totalDuration) + 's',
    });

    const chunks = await splitAudioIntoChunks(audioPath, totalDuration);
    const chunkResults = [];

    for (const chunk of chunks) {
        try {
            log.ai.info(`Transcribing chunk at offset ${chunk.startOffset}s`, { path: chunk.path });
            const transcript = await transcribeSingleFile(chunk.path);
            chunkResults.push({ transcript, startOffset: chunk.startOffset });
        } catch (err) {
            log.ai.warn(`Chunk at ${chunk.startOffset}s failed — skipping`, { error: err.message });
            chunkResults.push({ transcript: null, startOffset: chunk.startOffset });
        } finally {
            await unlink(chunk.path).catch(() => {});
        }
    }

    return mergeChunkTranscripts(chunkResults);
}

/**
 * Full transcription pipeline: download audio → transcribe → cleanup.
 */
export async function transcribeVideo(videoId) {
    let audioPath = null;

    try {
        log.ai.info('Starting video transcription', { videoId });

        audioPath = await downloadAudio(videoId);
        log.ai.info('Audio downloaded', { videoId, path: audioPath });

        const result = await transcribeAudio(audioPath);
        log.ai.info('Transcription complete', {
            videoId,
            duration: result.duration,
            words: result.words.length,
            language: result.language,
        });

        return result;
    } finally {
        if (audioPath) await unlink(audioPath).catch(() => {});
    }
}
