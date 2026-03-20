// ============================================================
// ROBIN OSINT — Video Clip Generator
// FFmpeg-powered clip extraction with Supabase Storage upload
// Window: 14s before + 14s after keyword = 28s per clip
// ============================================================

import { spawn } from 'child_process';
import { readFile, unlink, stat } from 'fs/promises';
import { join } from 'path';
import { randomUUID, createHash } from 'crypto';
import { VIDEO_CONFIG, ensureDirs } from './config.js';
import { log } from '../../lib/logger.js';
import { supabase } from '../../lib/supabase.js';

/**
 * Get video duration using yt-dlp.
 * @param {string} videoId
 * @returns {Promise<number>} Duration in seconds
 */
async function getVideoDuration(videoId) {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    return new Promise((resolve, reject) => {
        const proc = spawn(VIDEO_CONFIG.ytDlpPath, [
            '--print', 'duration',
            '--no-playlist',
            '--quiet',
            videoUrl,
        ], { timeout: 30000 });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', (code) => {
            if (code === 0) {
                const duration = parseFloat(stdout.trim());
                resolve(isNaN(duration) ? 0 : duration);
            } else {
                reject(new Error(`yt-dlp duration failed: ${stderr.substring(0, 100)}`));
            }
        });
        proc.on('error', reject);
    });
}

/**
 * Calculate clip boundaries, merging overlapping clips.
 * 
 * @param {Array} occurrences - Keyword occurrences [{ timestamp, keyword, ... }]
 * @param {number} videoDuration - Total video duration in seconds
 * @returns {Array} Clip windows [{ start, end, keywords, occurrences }]
 */
export function calculateClipWindows(occurrences, videoDuration) {
    if (!occurrences || occurrences.length === 0) return [];

    const before = VIDEO_CONFIG.clipDurationBefore;
    const after = VIDEO_CONFIG.clipDurationAfter;

    // Calculate raw clip windows
    const rawClips = occurrences.map(occ => ({
        start: Math.max(0, occ.timestamp - before),
        end: Math.min(videoDuration, occ.timestamp + after),
        keywords: [occ.keyword || occ.text],
        occurrences: [occ],
        primaryTimestamp: occ.timestamp,
    }));

    // Sort by start time
    rawClips.sort((a, b) => a.start - b.start);

    // Merge overlapping clips
    const merged = [];
    for (const clip of rawClips) {
        const last = merged[merged.length - 1];
        if (last && clip.start - last.end < VIDEO_CONFIG.clipMergeThreshold) {
            // Merge: extend end, add keywords
            last.end = Math.max(last.end, clip.end);
            last.keywords = [...new Set([...last.keywords, ...clip.keywords])];
            last.occurrences = [...last.occurrences, ...clip.occurrences];
        } else {
            merged.push({ ...clip });
        }
    }

    // Apply safety cap
    return merged.slice(0, VIDEO_CONFIG.maxClipsPerVideo);
}

/**
 * Generate a single clip using yt-dlp + FFmpeg.
 * Downloads only the needed segment, not the full video.
 *
 * @param {string} videoId - YouTube video ID
 * @param {Object} clipWindow - { start, end, keywords }
 * @returns {Promise<Object>} { localPath, duration, start, end }
 */
async function generateSingleClip(videoId, clipWindow) {
    await ensureDirs();

    const clipId = randomUUID().slice(0, 8);
    const outputPath = join(VIDEO_CONFIG.clipsDir, `${videoId}_clip_${clipId}.mp4`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const duration = clipWindow.end - clipWindow.start;

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('Clip generation timed out'));
        }, 120000); // 2min per clip

        // Use yt-dlp to download just the segment
        const proc = spawn(VIDEO_CONFIG.ytDlpPath, [
            '--download-sections', `*${clipWindow.start}-${clipWindow.end}`,
            '--force-keyframes-at-cuts',
            '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
            '--merge-output-format', 'mp4',
            '--postprocessor-args', 'ffmpeg:-movflags +faststart',
            '--ffmpeg-location', VIDEO_CONFIG.ffmpegPath,
            '-o', outputPath,
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            videoUrl,
        ], { timeout: 120000 });

        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve({
                    localPath: outputPath,
                    duration,
                    start: clipWindow.start,
                    end: clipWindow.end,
                });
            } else {
                reject(new Error(`Clip generation failed (code ${code}): ${stderr.substring(0, 200)}`));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

/**
 * Upload a clip to Cloudinary (video CDN).
 * Requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET env vars.
 *
 * @param {string} localPath - Local MP4 path
 * @param {string} videoId - YouTube video ID
 * @param {number} clipIndex - Clip index
 * @returns {Promise<string>} Cloudinary secure URL
 */
async function uploadToCloudinary(localPath, videoId, clipIndex) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error('Cloudinary env vars not configured');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `robin-clips/${videoId}_clip_${clipIndex}`;

    // Signed upload: SHA-1 of sorted params + api_secret
    const paramsStr = `public_id=${publicId}&timestamp=${timestamp}`;
    const signature = createHash('sha1')
        .update(paramsStr + apiSecret)
        .digest('hex');

    const fileBuffer = await readFile(localPath);
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: 'video/mp4' }), `clip_${clipIndex}.mp4`);
    formData.append('public_id', publicId);
    formData.append('timestamp', String(timestamp));
    formData.append('api_key', apiKey);
    formData.append('signature', signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Cloudinary upload failed (${res.status}): ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    return data.secure_url;
}

/**
 * Upload a clip to Supabase Storage.
 *
 * @param {string} localPath - Local file path
 * @param {string} videoId - YouTube video ID
 * @param {number} clipIndex - Clip number
 * @returns {Promise<string>} Public URL
 */
async function uploadToSupabase(localPath, videoId, clipIndex) {
    const fileData = await readFile(localPath);
    const storagePath = `clips/${videoId}/${videoId}_clip_${clipIndex}.mp4`;

    // Ensure bucket exists (creates if not — Supabase ignores if exists)
    try {
        await supabase.storage.createBucket(VIDEO_CONFIG.storageBucket, {
            public: true,
            fileSizeLimit: 50 * 1024 * 1024, // 50MB max
        });
    } catch {
        // Bucket likely already exists — fine
    }

    const { data, error } = await supabase.storage
        .from(VIDEO_CONFIG.storageBucket)
        .upload(storagePath, fileData, {
            contentType: 'video/mp4',
            upsert: true,
        });

    if (error) throw new Error(`Supabase upload failed: ${error.message}`);

    // Get public URL
    const { data: urlData } = supabase.storage
        .from(VIDEO_CONFIG.storageBucket)
        .getPublicUrl(storagePath);

    return urlData?.publicUrl || storagePath;
}

/**
 * Generate all clips for a video and upload to storage.
 *
 * @param {string} videoId - YouTube video ID
 * @param {Array} clipWindows - From calculateClipWindows()
 * @returns {Promise<Array>} Generated clips with URLs
 */
export async function generateClips(videoId, clipWindows) {
    const results = [];

    for (let i = 0; i < clipWindows.length; i++) {
        const window = clipWindows[i];

        try {
            log.ai.info(`Generating clip ${i + 1}/${clipWindows.length}`, {
                videoId,
                start: window.start,
                end: window.end,
                keywords: window.keywords,
            });

            // Generate clip locally
            const clip = await generateSingleClip(videoId, window);

            // Upload to storage: try Supabase first, then Cloudinary.
            // NO YouTube timestamp fallback — only store real clips.
            let clipUrl = null;
            try {
                clipUrl = await uploadToSupabase(clip.localPath, videoId, i);
                log.ai.info('Clip uploaded to Supabase', { videoId, clipIndex: i });
            } catch (supabaseErr) {
                log.ai.warn('Supabase upload failed, trying Cloudinary', { error: supabaseErr.message });
                try {
                    clipUrl = await uploadToCloudinary(clip.localPath, videoId, i);
                    log.ai.info('Clip uploaded to Cloudinary', { videoId, clipIndex: i });
                } catch (cloudinaryErr) {
                    log.ai.warn('Both Supabase and Cloudinary failed — clip skipped (no YouTube fallback)', {
                        videoId,
                        clipIndex: i,
                        supabaseErr: supabaseErr.message?.substring(0, 80),
                        cloudinaryErr: cloudinaryErr.message?.substring(0, 80),
                    });
                }
            }

            // Cleanup local file regardless of upload outcome
            await unlink(clip.localPath).catch(() => {});

            // Only store clips that have a real hosted URL
            if (clipUrl) {
                results.push({
                    clipIndex: i,
                    start: window.start,
                    end: window.end,
                    duration: window.end - window.start,
                    keywords: window.keywords,
                    occurrences: window.occurrences,
                    clipUrl,
                });
            }

        } catch (error) {
            log.ai.warn(`Clip ${i + 1} generation failed — skipping (no YouTube fallback)`, {
                videoId,
                start: window.start,
                end: window.end,
                error: error.message?.substring(0, 120),
            });
            // Do NOT push a YouTube timestamp URL — clip is simply skipped
        }
    }

    return results;
}
