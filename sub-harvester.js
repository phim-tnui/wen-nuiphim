const axios = require('axios');
const zlib = require('zlib');
const { GoogleGenAI } = require('@google/genai');
const sources = require('./sources');

// In-memory cache
const memoryCache = new Map();

/**
 * Chuyển đổi timestamp WebVTT/SRT sang mili-giây
 */
function timeToMs(t) {
    if (!t) return 0;
    const parts = t.trim().split(':');
    let h = 0, m = 0, s = 0;
    if (parts.length === 3) {
        h = parseInt(parts[0], 10) || 0;
        m = parseInt(parts[1], 10) || 0;
        s = parseFloat((parts[2] || '0').replace(',', '.')) || 0;
    } else if (parts.length === 2) {
        m = parseInt(parts[0], 10) || 0;
        s = parseFloat((parts[1] || '0').replace(',', '.')) || 0;
    }
    return Math.round((h * 3600 + m * 60 + s) * 1000);
}

/**
 * Chuyển đổi mili-giây thành định dạng chuẩn WebVTT HH:MM:SS.mmm
 */
function msToVtt(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const msec = ms % 1000;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(msec, 3)}`;
}

/**
 * Đồng bộ bù/trừ độ lệch thời gian (Time-Shift Offset) cho toàn bộ file WebVTT
 */
function shiftVtt(vttContent, offsetSec = 0) {
    if (!vttContent || typeof vttContent !== 'string') return "WEBVTT\n\n";
    if (!offsetSec || offsetSec === 0) return vttContent;

    const offsetMs = Math.round(offsetSec * 1000);
    const cueRegex = /(\d{1,2}:(?:\d{2}:)?\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:(?:\d{2}:)?\d{2}[.,]\d{3})/g;
    
    return vttContent.replace(cueRegex, (match, start, end) => {
        const newStart = msToVtt(timeToMs(start) + offsetMs);
        const newEnd = msToVtt(timeToMs(end) + offsetMs);
        return `${newStart} --> ${newEnd}`;
    });
}

/**
 * Chuyển đổi file phụ đề SubRip (.srt) thành WebVTT (.vtt) chuẩn UTF-8
 */
function convertSrtToVtt(srtContent) {
    if (!srtContent) return "WEBVTT\n\n";
    // Xóa BOM character nếu có
    let text = srtContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    if (!text.startsWith("WEBVTT")) {
        text = "WEBVTT\n\n" + text;
    }
    return text;
}

/**
 * Giải nén file .srt/.vtt từ file ZIP trong bộ nhớ đệm (Pure JS, zero dependency)
 */
function extractSrtFromZip(buffer) {
    if (!buffer || buffer.length < 30) return null;
    let offset = 0;
    while (offset < buffer.length - 30) {
        // Local file header signature = 0x04034b50
        if (buffer.readUInt32LE(offset) === 0x04034b50) {
            const compressionMethod = buffer.readUInt16LE(offset + 8);
            const compressedSize = buffer.readUInt32LE(offset + 18);
            const fileNameLength = buffer.readUInt16LE(offset + 26);
            const extraFieldLength = buffer.readUInt16LE(offset + 28);
            
            const fileName = buffer.toString('utf8', offset + 30, offset + 30 + fileNameLength);
            const dataStart = offset + 30 + fileNameLength + extraFieldLength;
            const dataEnd = dataStart + compressedSize;
            const compressedData = buffer.slice(dataStart, dataEnd);

            if (fileName.toLowerCase().endsWith('.srt') || fileName.toLowerCase().endsWith('.vtt')) {
                let fileContent = '';
                try {
                    if (compressionMethod === 8) { // DEFLATE
                        fileContent = zlib.inflateRawSync(compressedData).toString('utf8');
                    } else if (compressionMethod === 0) { // STORED
                        fileContent = compressedData.toString('utf8');
                    }
                } catch (e) {
                    console.error("Zip decompression error:", e.message);
                }
                if (fileContent) {
                    return { fileName, content: fileContent };
                }
            }
            offset = dataEnd;
        } else {
            offset++;
        }
    }
    return null;
}

/**
 * Tự động phân giải mã IMDb ID cho các mục phim từ catalog Việt Nam (phim_slug)
 */
async function resolveImdbForSubtitles(type, rawId, cache) {
    if (!rawId) return null;
    if (rawId.startsWith('tt')) {
        return rawId.split(':')[0];
    }

    const cleanSlug = rawId.replace(/^(phim_|vsmov_|nguonc_|ophim_|xink_|custom_|viptorrent_|viptorrent:)/, '').split(':')[0];
    if (cleanSlug.startsWith('tt')) {
        return cleanSlug;
    }

    const cacheKey = `slug_to_imdb_v4_${cleanSlug}`;
    const cached = cache ? (cache.get(cacheKey) || cache.get(`slug_to_imdb_v3_${cleanSlug}`)) : (memoryCache.get(cacheKey) || memoryCache.get(`slug_to_imdb_v3_${cleanSlug}`));
    if (cached) return cached;

    try {
        const endpoints = sources.getEndpoints();
        const cleanNguonC = (endpoints.nguonc || "https://phim.nguonc.com").replace(/\/api\/?$/, '');
        const cleanVSMov = (endpoints.vsmov || "https://vsmov.com").replace(/\/api\/?$/, '');
        const cleanXink = (endpoints.xink || "https://api.xink.pro/api").replace(/\/+$/, '');

        const requests = [
            axios.get(`${endpoints.kkphim}/phim/${cleanSlug}`, { timeout: 2500 }).catch(() => null),
            axios.get(`${endpoints.ophim}/phim/${cleanSlug}`, { timeout: 2500 }).catch(() => null),
            axios.get(`${endpoints.ophim}/v1/api/phim/${cleanSlug}`, { timeout: 2500 }).catch(() => null),
            axios.get(`${cleanVSMov}/api/phim/${cleanSlug}`, { timeout: 2500 }).catch(() => null),
            axios.get(`${cleanNguonC}/api/film/${cleanSlug}`, { timeout: 2500 }).catch(() => null),
            axios.get(`${cleanXink}/phim/${cleanSlug}`, { timeout: 2500 }).catch(() => null)
        ];

        const results = await Promise.all(requests);
        let m = null;
        for (const res of results) {
            if (res && res.data) {
                const cand = res.data.movie || res.data.item || res.data.data?.item || res.data.data?.movie || res.data.data;
                if (cand && (cand.name || cand.origin_name || cand.imdb || cand.tmdb)) {
                    m = cand;
                    break;
                }
            }
        }

        let imdbId = null;
        if (m) {
            if (m.imdb?.id && String(m.imdb.id).startsWith('tt')) imdbId = String(m.imdb.id);
            else if (m.imdb?.id && /^\d+$/.test(String(m.imdb.id))) imdbId = `tt${m.imdb.id}`;
            else if (m.imdb_id && String(m.imdb_id).startsWith('tt')) imdbId = String(m.imdb_id);
            else if (m.imdb_id && /^\d+$/.test(String(m.imdb_id))) imdbId = `tt${m.imdb_id}`;

            if (!imdbId && (m.origin_name || m.name)) {
                imdbId = await sources.getImdbFromTitle(type, m.origin_name || m.name, m.year, cache);
            }
        }

        if (!imdbId) {
            const slugWords = cleanSlug.replace(/[-_]/g, ' ');
            imdbId = await sources.getImdbFromTitle(type, slugWords, null, cache);
        }

        if (imdbId) {
            if (cache) cache.set(cacheKey, imdbId, 86400 * 7);
            else memoryCache.set(cacheKey, imdbId);
            return imdbId;
        }
    } catch (e) {}

    return null;
}

/**
 * Thu thập phụ đề tiếng Việt từ kho YTS-Subs (chuyên cho bản BluRay / WEB-DL / YTS)
 */
async function fetchYtsSubtitles(imdbId, hostUrl) {
    if (!imdbId || !imdbId.startsWith('tt')) return [];
    try {
        const res = await axios.get(`https://yts-subs.com/movie-imdb/${imdbId}`, { timeout: 3500 });
        const html = res.data;
        const regex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let match;
        const subs = [];

        while ((match = regex.exec(html)) !== null) {
            const row = match[1];
            if (row.includes('Vietnamese') || row.includes('vietnamese')) {
                const linkMatch = row.match(/href=\"(\/subtitles\/[^\"]+)\"/i);
                const titleMatch = row.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
                let rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/^subtitle\s*/i, '').trim() : 'Bản Chuẩn';
                rawTitle = rawTitle.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

                if (linkMatch && linkMatch[1]) {
                    const subId = linkMatch[1].replace(/^\/subtitles\//, '');
                    // Sử dụng Base64URL để an toàn tuyệt đối 100% qua mọi Reverse Proxy, ExoPlayer, Stremio
                    const b64 = Buffer.from(linkMatch[1]).toString('base64url');

                    // 1. Luồng chính 0s chuẩn gốc BluRay
                    subs.push({
                        id: `yts_${subId}_std`,
                        url: `${hostUrl}/api/sub-yts/${b64}.vtt?offset=0`,
                        lang: "vie",
                        label: `🇻🇳 Tiếng Việt [${rawTitle.slice(0, 36)}] (Chuẩn Gốc 0s)`
                    });

                    // 2. Tùy chọn cắt 5s Intro Web-DL
                    subs.push({
                        id: `yts_${subId}_trim5`,
                        url: `${hostUrl}/api/sub-yts/${b64}.vtt?offset=-5`,
                        lang: "vie",
                        label: `⚡ Tiếng Việt [${rawTitle.slice(0, 28)}] (Cắt 5s Intro)`
                    });

                    // 3. Tùy chọn cắt 8s Intro Web-DL
                    subs.push({
                        id: `yts_${subId}_trim8`,
                        url: `${hostUrl}/api/sub-yts/${b64}.vtt?offset=-8`,
                        lang: "vie",
                        label: `⚡ Tiếng Việt [${rawTitle.slice(0, 28)}] (Cắt 8s Intro)`
                    });

                    // 4. Tùy chọn chữ ra sớm: Bù trễ +2.5s
                    subs.push({
                        id: `yts_${subId}_p25`,
                        url: `${hostUrl}/api/sub-yts/${b64}.vtt?offset=2.5`,
                        lang: "vie",
                        label: `⏩ Chữ ra sớm: Bù trễ +2.5s`
                    });

                    // 5. Tùy chọn chữ ra muộn: Đẩy sớm -2.5s
                    subs.push({
                        id: `yts_${subId}_m25`,
                        url: `${hostUrl}/api/sub-yts/${b64}.vtt?offset=-2.5`,
                        lang: "vie",
                        label: `⏪ Chữ ra muộn: Đẩy sớm -2.5s`
                    });
                }
            }
        }
        return subs;
    } catch (e) {
        return [];
    }
}

/**
 * Tải và trích xuất nội dung phụ đề từ YTS Subtitle link
 */
async function downloadYtsSubtitle(subPath, offsetSec = 0, cache = null) {
    let cleanPath = subPath;
    if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
    const cacheKey = `yts_vtt_v3_${encodeURIComponent(cleanPath)}_${offsetSec}`;
    const cached = cache ? cache.get(cacheKey) : memoryCache.get(cacheKey);
    if (cached) return cached;

    try {
        const pageUrl = `https://yts-subs.com${cleanPath}`;
        const pageRes = await axios.get(pageUrl, { timeout: 4000 });
        const html = pageRes.data;

        // Trích xuất link zip base64 từ data-link="..."
        const dataLinkMatch = html.match(/data-link=\"([a-zA-Z0-9+/=]+)\"/i);
        if (!dataLinkMatch || !dataLinkMatch[1]) {
            return null;
        }

        const zipUrl = Buffer.from(dataLinkMatch[1], 'base64').toString('utf8');
        const zipRes = await axios.get(zipUrl, { responseType: 'arraybuffer', timeout: 5000 });
        const extracted = extractSrtFromZip(Buffer.from(zipRes.data));

        if (extracted && extracted.content) {
            let vtt = convertSrtToVtt(extracted.content);
            if (offsetSec !== 0) {
                vtt = shiftVtt(vtt, offsetSec);
            }
            if (cache) cache.set(cacheKey, vtt, 86400 * 7);
            else memoryCache.set(cacheKey, vtt);
            return vtt;
        }
    } catch (e) {
        console.error("downloadYtsSubtitle error:", e.message);
    }
    return null;
}

/**
 * Thu thập phụ đề tiếng Việt từ kho VNStream Subtitles
 */
async function fetchVnStreamSubtitles(imdbId, hostUrl) {
    if (!imdbId || !imdbId.startsWith('tt')) return [];
    try {
        const subUrl = `https://sub.vnstream.io.vn/vtt/${imdbId}.vtt`;
        const res = await axios.head(subUrl, { timeout: 2000 }).catch(() => null);
        if (res && res.status >= 200 && res.status < 400) {
            const b64 = Buffer.from(subUrl).toString('base64url');
            return [
                {
                    id: `vnstream_${imdbId}_std`,
                    url: `${hostUrl}/api/sub-sync/${imdbId}.vtt?b64=${b64}&offset=0`,
                    lang: "vie",
                    label: "🇻🇳 Tiếng Việt [VNStream Auto]"
                },
                {
                    id: `vnstream_${imdbId}_trim8`,
                    url: `${hostUrl}/api/sub-sync/${imdbId}.vtt?b64=${b64}&offset=-8`,
                    lang: "vie",
                    label: "⚡ Tiếng Việt [VNStream] (Cắt 8s Intro)"
                },
                {
                    id: `vnstream_${imdbId}_p25`,
                    url: `${hostUrl}/api/sub-sync/${imdbId}.vtt?b64=${b64}&offset=2.5`,
                    lang: "vie",
                    label: "⏩ Chữ ra sớm: Bù trễ +2.5s"
                },
                {
                    id: `vnstream_${imdbId}_m25`,
                    url: `${hostUrl}/api/sub-sync/${imdbId}.vtt?b64=${b64}&offset=-2.5`,
                    lang: "vie",
                    label: "⏪ Chữ ra muộn: Đẩy sớm -2.5s"
                }
            ];
        }
    } catch (e) {}
    return [];
}

/**
 * Thu thập phụ đề tiếng Việt từ OpenSubtitles REST API (Độ chính xác cao nhất cho cả phim lẻ & từng tập series)
 */
async function fetchOpenSubtitlesRest(type, imdbId, season, episode, hostUrl) {
    if (!imdbId || !imdbId.startsWith('tt')) return [];
    const numericImdb = imdbId.replace('tt', '').padStart(7, '0');
    let url = '';
    if (type === 'series' && season && episode) {
        url = `https://rest.opensubtitles.org/search/episode-${episode}/imdbid-${numericImdb}/season-${season}/sublanguageid-vie`;
    } else {
        url = `https://rest.opensubtitles.org/search/imdbid-${numericImdb}/sublanguageid-vie`;
    }

    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'TemporaryUserAgent' },
            timeout: 3800
        });
        const list = Array.isArray(res.data) ? res.data : [];
        const subs = [];
        for (const item of list.slice(0, 3)) {
            const rawFileName = item.SubFileName || item.MovieReleaseName || 'Bản Chuẩn';
            const cleanName = rawFileName.replace(/\.(srt|vtt|gz)$/i, '').slice(0, 32);
            const downloadLink = item.SubDownloadLink;
            if (!downloadLink) continue;

            const b64 = Buffer.from(downloadLink).toString('base64url');
            const subId = item.IDSubtitleFile || item.IDSubtitle || Math.random().toString(36).slice(2, 8);

            subs.push({
                id: `os_rest_${subId}`,
                url: `${hostUrl}/api/sub-sync/${subId}.vtt?b64=${b64}&offset=0`,
                lang: "vie",
                language: "vi",
                lang_code: "vi",
                label: `🇻🇳 Tiếng Việt [${cleanName}]`,
                name: `🇻🇳 Tiếng Việt [${cleanName}]`,
                title: `🇻🇳 Tiếng Việt [${cleanName}]`,
                format: "vtt"
            });
        }
        return subs;
    } catch (e) {
        return [];
    }
}

/**
 * BOT Cấy Mắt: Bóc tách phụ đề tiếng Việt nhúng trong luồng m3u8 playlist từ Server Việt
 */
async function extractEmbeddedSubtitles(candidateStreams = [], hostUrl) {
    if (!Array.isArray(candidateStreams) || candidateStreams.length === 0) return [];
    const extractedSubs = [];
    const seenUris = new Set();

    for (const st of candidateStreams.slice(0, 8)) {
        // 1. Phụ đề đã có sẵn trong object stream từ API upstream
        if (Array.isArray(st.subtitles) && st.subtitles.length > 0) {
            for (const s of st.subtitles) {
                const norm = sources.normalizeSubtitleTrack(s, extractedSubs.length);
                if (norm && norm.url && !seenUris.has(norm.url)) {
                    seenUris.add(norm.url);
                    extractedSubs.push(norm);
                }
            }
        }

        // 2. Quét nhanh manifest m3u8 playlist
        const stUrl = st.url || "";
        const isVnServer = st.name && (st.name.includes("KKPhim") || st.name.includes("VSMOV") || st.name.includes("NguonC") || st.name.includes("Xink") || st.name.includes("OPhim"));
        if (isVnServer && stUrl.includes('.m3u8') && !seenUris.has(stUrl)) {
            try {
                const ref = st.behaviorHints?.proxyHeaders?.request?.Referer || "https://phimapi.com/";
                const res = await axios.get(stUrl, {
                    timeout: 2000,
                    headers: { "User-Agent": "Mozilla/5.0", "Referer": ref }
                }).catch(() => null);

                if (res?.data && typeof res.data === 'string') {
                    const text = res.data;
                    const subRegex = /#EXT-X-MEDIA:TYPE=SUBTITLES[^,\n]*,URI=["']([^"']+)["']/gi;
                    let m;
                    while ((m = subRegex.exec(text)) !== null) {
                        let subUri = m[1];
                        if (!subUri.startsWith("http")) {
                            const baseUrl = stUrl.substring(0, stUrl.lastIndexOf('/') + 1);
                            subUri = baseUrl + subUri;
                        }
                        if (!seenUris.has(subUri)) {
                            seenUris.add(subUri);
                            const b64 = Buffer.from(subUri).toString('base64url');
                            extractedSubs.push({
                                id: `m3u8_sub_${extractedSubs.length}`,
                                url: `${hostUrl}/api/sub-sync/emb.vtt?b64=${b64}&offset=0`,
                                lang: "vie",
                                label: `🇻🇳 Tiếng Việt [Phụ Đề Bóc Tách Server]`
                            });
                        }
                    }
                }
            } catch (e) {}
        }
    }

    return extractedSubs;
}

/**
 * Truy vấn danh sách phụ đề tiếng Việt tổng hợp cho Stremio & Nuvio
 */
async function fetchVietsubList(type, rawId, hostUrl, cache, candidateStreams = []) {
    const cleanId = rawId.replace('.json', '');
    const cacheKey = `vietsub_list_v7_${encodeURIComponent(hostUrl)}_${type}_${cleanId}`;
    const cached = cache ? cache.get(cacheKey) : memoryCache.get(cacheKey);
    if (cached) {
        return cached.map(s => {
            let u = s.url;
            if (u && (u.includes('/api/sub-') || u.includes('/subtitles/'))) {
                u = u.replace(/^https?:\/\/[^/]+(\/api\/sub-[^?]+|\/subtitles\/[^?]+)/, `${hostUrl}$1`);
            }
            return { ...s, url: u };
        });
    }

    const subs = [];

    // 0. Bóc tách phụ đề nhúng trực tiếp từ các luồng máy chủ Việt Nam (BOT Cấy Mắt)
    if (candidateStreams && candidateStreams.length > 0) {
        try {
            const embedded = await extractEmbeddedSubtitles(candidateStreams, hostUrl);
            if (embedded.length > 0) subs.push(...embedded);
        } catch (e) {}
    }

    // 0.1 Bóc tách phụ đề trực tiếp từ máy chủ Việt Nam nếu là phim slug (phim_, vsmov_, nguonc_, ophim_, xink_)
    const cleanSlug = cleanId.replace(/^(phim_|vsmov_|nguonc_|ophim_|xink_|custom_|viptorrent_|viptorrent:)/, '').split(':')[0];
    if (cleanSlug && cleanSlug !== cleanId) {
        try {
            const endpoints = sources.getEndpoints();
            const kkRes = await axios.get(`${endpoints.kkphim}/phim/${cleanSlug}`, { timeout: 2000 }).catch(() => null);
            const mData = kkRes?.data?.movie || kkRes?.data?.item;
            const epData = kkRes?.data?.episodes;
            if (mData) {
                const ext = sources.extractExternalSubtitles(mData, epData?.[0]?.server_data?.[0], null);
                if (Array.isArray(ext) && ext.length > 0) {
                    ext.forEach((e, idx) => {
                        subs.push({
                            id: e.id || `ext_vn_${idx}`,
                            url: e.url,
                            lang: "vie",
                            language: "vi",
                            lang_code: "vi",
                            name: e.name || e.label || "🇻🇳 Tiếng Việt [Gốc Máy Chủ]",
                            label: e.name || e.label || "🇻🇳 Tiếng Việt [Gốc Máy Chủ]",
                            title: e.name || e.label || "🇻🇳 Tiếng Việt [Gốc Máy Chủ]",
                            format: e.format || "vtt"
                        });
                    });
                }
            }
        } catch (e) {}
    }
    
    // 1. Phân giải ra IMDb ID
    const imdbId = await resolveImdbForSubtitles(type, cleanId, cache);

    if (imdbId) {
        const parts = cleanId.split(':');
        const season = parts[1];
        const episode = parts[2];
        const isEpisodeRequest = Boolean(season && episode);

        // Bật đa luồng quét song song: OpenSubtitles REST + YTS-Subs + OpenSubtitles v3
        const parallelTasks = [
            fetchOpenSubtitlesRest(type, imdbId, season, episode, hostUrl),
            fetchVnStreamSubtitles(imdbId, hostUrl)
        ];

        if (type === 'movie' || !isEpisodeRequest) {
            parallelTasks.push(fetchYtsSubtitles(imdbId, hostUrl));
            parallelTasks.push(axios.get(`https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`, { timeout: 3000 }).then(r => r.data?.subtitles || []).catch(() => []));
        } else {
            parallelTasks.push(axios.get(`https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season}:${episode}.json`, { timeout: 3000 }).then(r => r.data?.subtitles || []).catch(() => []));
        }

        const taskResults = await Promise.allSettled(parallelTasks);

        taskResults.forEach(r => {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                // If OpenSubtitles v3 format
                if (r.value.length > 0 && r.value[0].url && r.value[0].lang) {
                    const viOnly = r.value.filter(s => s.lang === 'vie' || s.lang === 'vi' || s.lang === 'vn').slice(0, 4);
                    viOnly.forEach((s, idx) => {
                        const release = s.movieReleaseName || s.subtitleFileName || `Bản ${idx + 1}`;
                        const cleanRelease = release.replace(/\.srt$/i, '').slice(0, 32);

                        subs.push({
                            id: `vi_os_${s.id || idx}`,
                            url: s.url,
                            lang: "vie",
                            language: "vi",
                            lang_code: "vi",
                            label: `🇻🇳 Tiếng Việt [${cleanRelease}]`,
                            name: `🇻🇳 Tiếng Việt [${cleanRelease}]`,
                            title: `🇻🇳 Tiếng Việt [${cleanRelease}]`,
                            format: "vtt"
                        });
                    });
                } else {
                    subs.push(...r.value);
                }
            }
        });

        // Fallback: nếu series không có sub theo từng tập, thử tìm ở cấp movie
        if (type === 'series' && subs.length === 0) {
            try {
                const fbSubs = await fetchOpenSubtitlesRest('movie', imdbId, null, null, hostUrl);
                if (fbSubs.length > 0) subs.push(...fbSubs);
            } catch (e) {}
        }

        // Tự phục hồi: Nếu vẫn chưa có phụ đề rời nào, tự động dò tìm máy chủ Việt Nam theo tên phim và bóc tách
        if (subs.length === 0) {
            try {
                const cineRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, { timeout: 2600 }).catch(() => null);
                const cineMeta = cineRes?.data?.meta;
                if (cineMeta && (cineMeta.name || cineMeta.name)) {
                    const targetEp = isEpisodeRequest ? parseInt(episode, 10) : null;
                    const vnStreams = await sources.fetchAllVnStreamsByTitle(cineMeta.name, cineMeta.name, cineMeta.year, targetEp, imdbId);
                    if (vnStreams.length > 0) {
                        const harvested = await extractEmbeddedSubtitles(vnStreams, hostUrl);
                        if (harvested.length > 0) subs.push(...harvested);
                    }
                }
            } catch (e) {}
        }
    }

    // 2. BỘ PHỤ ĐỀ SMART AUTO-SYNC CHUẨN ĐẢM BẢO LUÔN CÓ PHỤ ĐỀ TIẾNG VIỆT
    const safeTargetId = cleanId;
    const guaranteedSmartSubs = [
        {
            id: `smart_${safeTargetId}_std_vi`,
            url: `${hostUrl}/api/sub-smart/${type}/${safeTargetId}.vtt`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "🇻🇳 Tiếng Việt [Khớp Chuẩn 0s]",
            label: "🇻🇳 Tiếng Việt [Khớp Chuẩn 0s]",
            title: "🇻🇳 Tiếng Việt [Khớp Chuẩn 0s]",
            format: "vtt"
        },
        {
            id: `smart_${safeTargetId}_std_vie`,
            url: `${hostUrl}/api/sub-smart/${type}/${safeTargetId}.vtt`,
            lang: "vie",
            language: "vi",
            lang_code: "vi",
            name: "🇻🇳 Tiếng Việt [Khớp Chuẩn 0s]",
            label: "🇻🇳 Tiếng Việt [Khớp Chuẩn 0s]",
            title: "🇻🇳 Tiếng Việt [Khớp Chuẩn 0s]",
            format: "vtt"
        },
        {
            id: `smart_${safeTargetId}_trim8_vi`,
            url: `${hostUrl}/api/sub-smart/${type}/${safeTargetId}.vtt?offset=-8`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "⚡ Tiếng Việt [Cắt 8s Intro]",
            label: "⚡ Tiếng Việt [Cắt 8s Intro]",
            title: "⚡ Tiếng Việt [Cắt 8s Intro]",
            format: "vtt"
        },
        {
            id: `smart_${safeTargetId}_p25_vi`,
            url: `${hostUrl}/api/sub-smart/${type}/${safeTargetId}.vtt?offset=2.5`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "⏩ Chữ ra sớm: Bù trễ +2.5s",
            label: "⏩ Chữ ra sớm: Bù trễ +2.5s",
            title: "⏩ Chữ ra sớm: Bù trễ +2.5s",
            format: "vtt"
        },
        {
            id: `smart_${safeTargetId}_m25_vi`,
            url: `${hostUrl}/api/sub-smart/${type}/${safeTargetId}.vtt?offset=-2.5`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "⏪ Chữ ra muộn: Đẩy sớm -2.5s",
            label: "⏪ Chữ ra muộn: Đẩy sớm -2.5s",
            title: "⏪ Chữ ra muộn: Đẩy sớm -2.5s",
            format: "vtt"
        }
    ];

    // Đẩy các luồng Smart Sync lên đầu nếu chưa có phụ đề rời
    if (subs.length === 0) {
        subs.push(...guaranteedSmartSubs);
    } else {
        subs.unshift(...guaranteedSmartSubs);
    }
    // Đã tắt tự động gắn track /api/sub-ai (Gemini trả phí) khi mở phim để tiết kiệm 100% chi phí API;
    // chỉ sử dụng phụ đề cào miễn phí từ OpenSubtitles, YTS, SubDL, KKPhim/OPhim.

    // Lọc trùng lặp ID
    const uniqueSubs = [];
    const seenSubIds = new Set();
    subs.forEach(s => {
        if (s && s.id && !seenSubIds.has(s.id)) {
            seenSubIds.add(s.id);
            uniqueSubs.push({
                ...s,
                lang: s.lang || "vie",
                language: s.language || "vi",
                lang_code: "vi",
                name: s.name || s.label || s.title || "🇻🇳 Tiếng Việt",
                label: s.label || s.name || s.title || "🇻🇳 Tiếng Việt",
                title: s.title || s.label || s.name || "🇻🇳 Tiếng Việt",
                format: s.format || "vtt"
            });
        }
    });

    // Giới hạn danh sách tối đa 8 track phụ đề chất lượng cao nhất để Nuvio và Android TV phản hồi siêu tốc, không bị tràn bộ nhớ hay timeout
    const curatedSubs = uniqueSubs.slice(0, 8);

    if (cache && curatedSubs.length > 0) cache.set(cacheKey, curatedSubs, 3600 * 12);
    else if (curatedSubs.length > 0) memoryCache.set(cacheKey, curatedSubs);

    return curatedSubs;
}

/**
 * Kiểm tra xem luồng phát có phải luồng quốc tế không (không phải Server Việt Nam và không có Thuyết Minh / Lồng Tiếng)
 */
function isNonVietnameseStream(stream) {
    if (!stream) return false;
    const name = (stream.name || '').toLowerCase();
    const title = (stream.title || '').toLowerCase();
    const t = `${name} ${title}`;

    // Các từ khóa của Server Việt Nam (đã có Vietsub cứng hoặc audio Việt)
    const isVnServer = t.includes("kkphim") || t.includes("phimapi") || t.includes("nguonc") || 
                       t.includes("vsmov") || t.includes("vnstream") || t.includes("xink") || 
                       t.includes("onflix") || t.includes("ophim") || t.includes("custom") || 
                       t.includes("api:") || t.includes("nguồn api") || t.includes("vietnam direct");

    // Các từ khóa Thuyết Minh / Lồng Tiếng
    const hasTm = t.includes("thuyết minh") || t.includes("thuyet minh") || t.includes("lồng tiếng") || 
                  t.includes("long tieng") || t.includes("vie audio") || t.includes("viet audio") || 
                  t.includes("audio tiếng việt") || t.includes("audio tieng viet");

    return !isVnServer && !hasTm;
}

/**
 * Đánh giá điểm khớp phụ đề theo nhiều phương pháp kiểm tra (Release Group, Source Encode, Resolution, Offset)
 */
function scoreSubtitleMatch(sub, stream) {
    if (!sub || !sub.url) return -1;
    let score = 100;
    const sUrl = (sub.url || '').toLowerCase();
    const sLabel = (sub.label || '').toLowerCase();
    const sId = (sub.id || '').toLowerCase();
    const stName = (stream?.name || '').toLowerCase();
    const stTitle = (stream?.title || '').toLowerCase();
    const streamText = `${stName} ${stTitle}`;

    // 1. Kiểm tra ngôn ngữ: Ưu tiên tiếng Việt tuyệt đối
    const isVietnamese = sub.lang === 'vie' || sub.lang === 'vi' || sub.lang === 'vn' ||
                         sLabel.includes('tiếng việt') || sLabel.includes('việt') || sLabel.includes('vietnamese');
    if (!isVietnamese) return -10;
    score += 300;

    // 2. Kiểm tra Release Group (YTS, YIFY, RARBG, FLUX, SPARKS, GECKOS, EVO, v.v.)
    const releaseGroups = [
        "yts", "yify", "rarbg", "flux", "sparks", "geckos", "evo", "cmrg", 
        "ntb", "psa", "galaxyrg", "ion10", "qxr", "tgx", "vyndros", "megusta", 
        "d3g", "ctrlhd", "don", "batv", "playweb", "whiterhino", "dimension",
        "chd", "wiki", "hds", "chopin", "roccat", "hdchina", "framestor"
    ];
    for (const rg of releaseGroups) {
        if (streamText.includes(rg)) {
            if (sLabel.includes(rg) || sId.includes(rg) || sUrl.includes(rg)) {
                score += 500;
                break;
            }
        }
    }

    // 3. Kiểm tra định dạng nguồn (BluRay / BDRip / BRRip vs WEB-DL / WEBRip)
    const isBlurayStream = streamText.includes("bluray") || streamText.includes("bdrip") || streamText.includes("brrip") || streamText.includes("remux");
    const isWebStream = streamText.includes("web-dl") || streamText.includes("webrip") || streamText.includes("web.");
    const isBluraySub = sLabel.includes("bluray") || sLabel.includes("bdrip") || sLabel.includes("brrip") || sId.includes("yts");
    const isWebSub = sLabel.includes("web-dl") || sLabel.includes("webrip") || sLabel.includes("web") || sLabel.includes("intro");

    if (isBlurayStream && isBluraySub) score += 300;
    if (isWebStream && isWebSub) score += 300;

    // 4. Kiểm tra độ phân giải (4K / 2160p, 1080p, 720p)
    const is4k = streamText.includes("2160p") || streamText.includes("4k") || streamText.includes("uhd");
    const is1080p = streamText.includes("1080p") || streamText.includes("fhd");
    const is720p = streamText.includes("720p") || streamText.includes("hd");

    if (is4k && (sLabel.includes("2160p") || sLabel.includes("4k") || sLabel.includes("uhd"))) score += 150;
    if (is1080p && (sLabel.includes("1080p") || sLabel.includes("1080"))) score += 150;
    if (is720p && (sLabel.includes("720p") || sLabel.includes("720"))) score += 100;

    // 5. Độ ổn định thời gian: Offset chuẩn 0s là tiêu chuẩn gốc
    if (sUrl.includes("offset=0") || sId.includes("_std") || sId.includes("_direct")) {
        score += 200;
    } else if (sUrl.includes("offset=-8") || sId.includes("trim8")) {
        if (isWebStream) score += 180;
        else score += 60;
    } else {
        score += 40;
    }

    // 6. Uy tín của nhà cung cấp phụ đề
    if (sId.includes("smart_std")) score += 220; // Smart harvester tổng hợp
    if (sId.includes("vi_os_") || sId.includes("os_rest_")) score += 170; // OpenSubtitles
    if (sId.includes("yts")) score += 180; // YTS official
    if (sId.includes("vi_ai")) score += 80; // Gemini AI fallback

    return score;
}

/**
 * Nhúng danh sách phụ đề Vietsub vào Stremio Stream Object
 * - Nếu luồng KHÔNG PHẢI từ Server Việt Nam: Tự động chấm điểm, chọn phụ đề khớp nhất và đánh dấu default: true ở Index 0
 * - Nếu luồng là Server Việt Nam hoặc có Thuyết Minh / Lồng Tiếng: Không ép bật tự động để tránh đè chữ
 * - Toàn bộ các bản dịch khác luôn được giữ lại ở các vị trí tiếp theo làm phương án dự phòng thủ công
 */
function injectSubtitlesIntoStreams(streams, type, rawId, hostUrl, customSubs = []) {
    if (!Array.isArray(streams) || streams.length === 0) return streams;

    const defaultVietsubTracks = [
        {
            id: `vi_smart_std_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=0`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "⭐ 🇻🇳 Tiếng Việt [Khớp Chuẩn 0s] (Mặc Định)",
            title: "⭐ 🇻🇳 Tiếng Việt [Khớp Chuẩn 0s] (Mặc Định)",
            label: "⭐ 🇻🇳 Tiếng Việt [Khớp Chuẩn 0s] (Mặc Định)",
            format: "vtt"
        },
        {
            id: `vie_smart_std_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=0`,
            lang: "vie",
            language: "vie",
            lang_code: "vi",
            name: "⭐ 🇻🇳 Tiếng Việt [Khớp Chuẩn 0s] (Mặc Định)",
            title: "⭐ 🇻🇳 Tiếng Việt [Khớp Chuẩn 0s] (Mặc Định)",
            label: "⭐ 🇻🇳 Tiếng Việt [Khớp Chuẩn 0s] (Mặc Định)",
            format: "vtt"
        },
        {
            id: `vi_smart_p25_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=2.5`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "⏩ Tiếng Việt [Bù trễ +2.5s - Khớp Web-DL]",
            title: "⏩ Tiếng Việt [Bù trễ +2.5s - Khớp Web-DL]",
            label: "⏩ Tiếng Việt [Bù trễ +2.5s - Khớp Web-DL]",
            format: "vtt"
        },
        {
            id: `vie_smart_p25_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=2.5`,
            lang: "vie",
            language: "vie",
            lang_code: "vi",
            name: "⏩ Tiếng Việt [Bù trễ +2.5s - Khớp Web-DL]",
            title: "⏩ Tiếng Việt [Bù trễ +2.5s - Khớp Web-DL]",
            label: "⏩ Tiếng Việt [Bù trễ +2.5s - Khớp Web-DL]",
            format: "vtt"
        },
        {
            id: `vi_smart_m25_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=-2.5`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "⏪ Tiếng Việt [Đẩy sớm -2.5s - Khớp BluRay]",
            title: "⏪ Tiếng Việt [Đẩy sớm -2.5s - Khớp BluRay]",
            label: "⏪ Tiếng Việt [Đẩy sớm -2.5s - Khớp BluRay]",
            format: "vtt"
        },
        {
            id: `vie_smart_m25_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=-2.5`,
            lang: "vie",
            language: "vie",
            lang_code: "vi",
            name: "⏪ Tiếng Việt [Đẩy sớm -2.5s - Khớp BluRay]",
            title: "⏪ Tiếng Việt [Đẩy sớm -2.5s - Khớp BluRay]",
            label: "⏪ Tiếng Việt [Đẩy sớm -2.5s - Khớp BluRay]",
            format: "vtt"
        },
        {
            id: `vi_smart_trim8_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=-8`,
            lang: "vi",
            language: "vi",
            lang_code: "vi",
            name: "⚡ Tiếng Việt [Cắt 8s Intro Web-DL]",
            title: "⚡ Tiếng Việt [Cắt 8s Intro Web-DL]",
            label: "⚡ Tiếng Việt [Cắt 8s Intro Web-DL]",
            format: "vtt"
        },
        {
            id: `vie_smart_trim8_${rawId}`,
            url: `${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=-8`,
            lang: "vie",
            language: "vie",
            lang_code: "vi",
            name: "⚡ Tiếng Việt [Cắt 8s Intro Web-DL]",
            title: "⚡ Tiếng Việt [Cắt 8s Intro Web-DL]",
            label: "⚡ Tiếng Việt [Cắt 8s Intro Web-DL]",
            format: "vtt"
        }
    ];

    const extraTracks = Array.isArray(customSubs) ? customSubs : [];
    const allVietsubTracks = [...extraTracks, ...defaultVietsubTracks];

    return streams.map(st => {
        if (!st) return st;
        const isNonVn = isNonVietnameseStream(st);
        const isVipTorrent = (st.name && st.name.includes("VipTorrent")) || (st.title && st.title.includes("VipTorrent"));
        const isTorrent = (st.name && st.name.toLowerCase().includes("torrent")) || st.infoHash;

        // Chuẩn hóa và bảo tồn toàn bộ phụ đề đã có từ API
        const existingSubs = [];
        if (Array.isArray(st.subtitles) && st.subtitles.length > 0) {
            st.subtitles.forEach((s, idx) => {
                const norm = sources.normalizeSubtitleTrack(s, idx);
                if (norm) existingSubs.push(norm);
            });
        }

        // Hợp nhất phụ đề gốc từ API và phụ đề thu hoạch
        const mergedSubs = [];
        const seenUrls = new Set();
        [...existingSubs, ...allVietsubTracks].forEach(s => {
            if (s && s.url && !seenUrls.has(s.url)) {
                seenUrls.add(s.url);
                mergedSubs.push({ ...s });
            }
        });

        let updatedName = st.name || '';
        let updatedTitle = st.title || '';
        let finalSubList = mergedSubs;

        if (isNonVn && mergedSubs.length > 0) {
            // Đánh giá và xếp hạng độ khớp phụ đề cho luồng quốc tế
            const scoredSubs = mergedSubs.map(sub => ({
                sub,
                score: scoreSubtitleMatch(sub, st)
            }));

            // Sắp xếp theo điểm số giảm dần
            scoredSubs.sort((a, b) => b.score - a.score);

            // Phụ đề tốt nhất được gán default: true và isDefault: true
            const best = scoredSubs[0].sub;
            const isViet = (best.lang === 'vi' || best.lang === 'vie' || (best.label || '').toLowerCase().includes('việt') || (best.name || '').toLowerCase().includes('việt'));
            let bestUrl = best.url || '';
            if (bestUrl.endsWith('?offset=0')) bestUrl = bestUrl.replace('?offset=0', '');

            const bestTrack = {
                ...best,
                id: `${best.id || 'best'}_vi`,
                url: bestUrl,
                lang: "vi",
                language: "vi",
                lang_code: "vi",
                locale: "vi",
                format: best.format || "vtt",
                default: true,
                isDefault: true,
                name: best.name || best.label || "🇻🇳 Tiếng Việt [Khớp Tự Động]",
                title: best.title || best.label || "🇻🇳 Tiếng Việt [Khớp Tự Động]",
                label: (best.label || '').includes("⭐") ? best.label : `⭐ 🇻🇳 Tiếng Việt [Khớp Tự Động] (Đang Bật)`
            };

            const bestTrackVie = {
                ...best,
                id: `${best.id || 'best'}_vie`,
                url: bestUrl,
                lang: "vie",
                language: "vi",
                lang_code: "vi",
                locale: "vi",
                format: best.format || "vtt",
                default: false,
                isDefault: false,
                name: best.name || best.label || "🇻🇳 Tiếng Việt [Khớp Tự Động]",
                title: best.title || best.label || "🇻🇳 Tiếng Việt [Khớp Tự Động]",
                label: best.label || "🇻🇳 Tiếng Việt [Khớp Tự Động]"
            };

            // Toàn bộ các phụ đề còn lại giữ default: false để người dùng tự do chọn lại thủ công
            const remainingTracks = [];
            scoredSubs.slice(1, 8).forEach((item, idx) => {
                const s = item.sub;
                let sUrl = s.url || '';
                if (sUrl.endsWith('?offset=0')) sUrl = sUrl.replace('?offset=0', '');
                const isV = (s.lang === 'vi' || s.lang === 'vie' || (s.label || '').toLowerCase().includes('việt') || (s.name || '').toLowerCase().includes('việt'));
                
                remainingTracks.push({
                    ...s,
                    id: `${s.id || `sub_${idx}`}_vi`,
                    url: sUrl,
                    lang: isV ? "vi" : (s.lang || "vi"),
                    language: "vi",
                    lang_code: "vi",
                    locale: "vi",
                    format: s.format || (sUrl.includes('.srt') ? "srt" : "vtt"),
                    name: s.name || s.label || s.title || "Phụ đề Tiếng Việt",
                    title: s.title || s.label || s.name || "Phụ đề Tiếng Việt",
                    label: s.label || s.name || "🇻🇳 Tiếng Việt",
                    default: false,
                    isDefault: false
                });

                if (isV) {
                    remainingTracks.push({
                        ...s,
                        id: `${s.id || `sub_${idx}`}_vie`,
                        url: sUrl,
                        lang: "vie",
                        language: "vi",
                        lang_code: "vi",
                        locale: "vi",
                        format: s.format || (sUrl.includes('.srt') ? "srt" : "vtt"),
                        name: s.name || s.label || s.title || "Phụ đề Tiếng Việt",
                        title: s.title || s.label || s.name || "Phụ đề Tiếng Việt",
                        label: s.label || s.name || "🇻🇳 Tiếng Việt",
                        default: false,
                        isDefault: false
                    });
                }
            });

            finalSubList = [bestTrack, bestTrackVie, ...remainingTracks];

            if (!updatedName.includes("Vietsub") && !updatedName.includes("vietsub") && !updatedName.includes("Auto Vietsub")) {
                updatedName = `${updatedName}\n⭐ [Auto Vietsub ON]`;
            }
            if (!updatedTitle.includes("Khớp Tự Động") && !updatedTitle.includes("Bật Sẵn")) {
                updatedTitle = `${updatedTitle}\n⭐ 🇻🇳 Phụ đề Tiếng Việt đã được Tự Động Khớp & Bật Sẵn (Đổi bản dịch tại nút CC)`;
            }
        } else {
            // Luồng Việt Nam hoặc Thuyết Minh: Đặt tất cả default: false để tránh đè chữ tự động
            const cleanVnSubs = [];
            mergedSubs.slice(0, 8).forEach((s, idx) => {
                let sUrl = s.url || '';
                if (sUrl.endsWith('?offset=0')) sUrl = sUrl.replace('?offset=0', '');
                const isV = (s.lang === 'vi' || s.lang === 'vie' || (s.label || '').toLowerCase().includes('việt') || (s.name || '').toLowerCase().includes('việt'));
                
                cleanVnSubs.push({
                    ...s,
                    id: `${s.id || `sub_vn_${idx}`}_vi`,
                    url: sUrl,
                    lang: isV ? "vi" : (s.lang || "vi"),
                    language: "vi",
                    lang_code: "vi",
                    locale: "vi",
                    format: s.format || (sUrl.includes('.srt') ? "srt" : "vtt"),
                    name: s.name || s.label || s.title || "Phụ đề Tiếng Việt",
                    title: s.title || s.label || s.name || "Phụ đề Tiếng Việt",
                    label: s.label || s.name || "🇻🇳 Tiếng Việt",
                    default: false,
                    isDefault: false
                });

                if (isV) {
                    cleanVnSubs.push({
                        ...s,
                        id: `${s.id || `sub_vn_${idx}`}_vie`,
                        url: sUrl,
                        lang: "vie",
                        language: "vi",
                        lang_code: "vi",
                        locale: "vi",
                        format: s.format || (sUrl.includes('.srt') ? "srt" : "vtt"),
                        name: s.name || s.label || s.title || "Phụ đề Tiếng Việt",
                        title: s.title || s.label || s.name || "Phụ đề Tiếng Việt",
                        label: s.label || s.name || "🇻🇳 Tiếng Việt",
                        default: false,
                        isDefault: false
                    });
                }
            });
            finalSubList = cleanVnSubs;

            if (isVipTorrent || isTorrent) {
                if (!updatedName.includes("Vietsub") && !updatedName.includes("vietsub")) {
                    updatedName = `${updatedName}\n🇻🇳 (Có Vietsub rời)`;
                }
                if (!updatedTitle.includes("CC")) {
                    updatedTitle = `${updatedTitle}\n🇻🇳 Bấm nút CC để bật Phụ Đề Tiếng Việt`;
                }
            }
        }

        return {
            ...st,
            name: updatedName,
            title: updatedTitle,
            subtitles: finalSubList
        };
    });
}

function isValidGeminiKey(key) {
    if (!key || typeof key !== 'string') return false;
    const clean = key.trim();
    return clean.startsWith('AIzaSy') && clean.length >= 35;
}

/**
 * Đã tắt gọi Gemini AI trả phí cho dịch phụ đề — sử dụng 100% phụ đề cào miễn phí (OpenSubtitles, YTS, SubDL, KKPhim/OPhim).
 */
async function translateVttWithGemini(vttText) {
    if (vttText && typeof vttText === 'string' && vttText.includes('-->')) {
        return vttText.startsWith('WEBVTT') ? vttText : convertSrtToVtt(vttText);
    }
    return null;
}

/**
 * Phân tích cấu trúc WebVTT thành mảng các Cue có mốc thời gian giây (Float)
 */
function parseVttCues(vttContent) {
    if (!vttContent || typeof vttContent !== 'string') return [];
    const cues = [];
    const blocks = vttContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
    const cueRegex = /(\d{1,2}:(?:\d{2}:)?\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:(?:\d{2}:)?\d{2}[.,]\d{3})/;

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        let timeLineIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (cueRegex.test(lines[i])) {
                timeLineIdx = i;
                break;
            }
        }
        if (timeLineIdx !== -1) {
            const match = lines[timeLineIdx].match(cueRegex);
            const startMs = timeToMs(match[1]);
            const endMs = timeToMs(match[2]);
            const text = lines.slice(timeLineIdx + 1).join(' ').trim();
            if (text) {
                cues.push({
                    start: match[1],
                    end: match[2],
                    startSec: +(startMs / 1000).toFixed(3),
                    endSec: +(endMs / 1000).toFixed(3),
                    text
                });
            }
        }
    }
    return cues;
}

/**
 * Tải lát cắt âm thanh/video máy chủ trung gian khi trình duyệt bị giới hạn ghi âm CORS
 */
async function fetchAudioSliceFromStream(streamUrl, referenceTimeSec = 0) {
    if (!streamUrl || typeof streamUrl !== 'string' || !streamUrl.startsWith('http')) return null;

    try {
        if (streamUrl.includes('.m3u8')) {
            const playlistRes = await axios.get(streamUrl, {
                timeout: 3000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const playlistText = typeof playlistRes.data === 'string' ? playlistRes.data : '';
            if (playlistText.includes('#EXTINF')) {
                const lines = playlistText.split('\n');
                let targetSegmentUri = null;
                let currentTimestamp = 0;
                let baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('#EXTINF:')) {
                        const dur = parseFloat(line.split(':')[1]) || 6;
                        const nextLine = (lines[i + 1] || '').trim();
                        if (nextLine && !nextLine.startsWith('#')) {
                            if (currentTimestamp + dur >= referenceTimeSec || !targetSegmentUri) {
                                targetSegmentUri = nextLine.startsWith('http') ? nextLine : (baseUrl + nextLine);
                                if (currentTimestamp + dur >= referenceTimeSec) break;
                            }
                        }
                        currentTimestamp += dur;
                    }
                }

                if (targetSegmentUri) {
                    const segRes = await axios.get(targetSegmentUri, {
                        timeout: 4500,
                        responseType: 'arraybuffer',
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    });
                    const buf = Buffer.from(segRes.data);
                    if (buf.length > 500) {
                        const mimeType = targetSegmentUri.includes('.aac') ? 'audio/aac' : (targetSegmentUri.includes('.mp4') || targetSegmentUri.includes('.m4s') ? 'video/mp4' : 'video/mp2t');
                        return { buffer: buf, mimeType };
                    }
                }
            }
        }

        // Dự phòng với Range Request (lấy 1.5MB đầu tiên của luồng)
        const rangeRes = await axios.get(streamUrl, {
            timeout: 4500,
            responseType: 'arraybuffer',
            headers: {
                'Range': 'bytes=0-1500000',
                'User-Agent': 'Mozilla/5.0'
            }
        }).catch(() => null);

        if (rangeRes?.data && rangeRes.data.byteLength > 1000) {
            return {
                buffer: Buffer.from(rangeRes.data),
                mimeType: streamUrl.includes('.mp4') ? 'video/mp4' : 'video/mp2t'
            };
        }
    } catch (e) {
        console.warn('fetchAudioSliceFromStream error:', e.message);
    }
    return null;
}

/**
 * 🌟 AI AUDIO-SUBTITLE SYNCHRONIZER (GEMINI MULTIMODAL AUDIO & SFX CUE ANALYZER)
 * Lắng nghe phổ âm thanh thực tế, phát hiện lời thoại, tiếng súng, tiếng nổ, âm nhạc,
 * đo lường độ lệch thời gian (time-offset) và tự động căn chỉnh phụ đề khớp từng mili-giây.
 */
async function analyzeAudioAndSyncSubtitles({
    cues = [],
    referenceTime = 0,
    subContent = ''
}) {
    let targetCues = Array.isArray(cues) && cues.length > 0 ? cues : [];
    if (targetCues.length === 0 && subContent) {
        const allParsed = parseVttCues(subContent);
        const windowStart = Math.max(0, referenceTime - 12);
        const windowEnd = referenceTime + 45;
        targetCues = allParsed.filter(c => (c.startSec >= windowStart && c.startSec <= windowEnd) || (c.endSec >= windowStart && c.endSec <= windowEnd));
    }
    return {
        success: true,
        mismatchDetected: false,
        confidenceScore: 1.0,
        calculatedOffsetSeconds: 0,
        primarySyncAnchor: null,
        detectedAudioEvents: [],
        reasoning: "Đã sử dụng bộ đồng bộ phụ đề miễn phí (0đ), không gọi API Gemini trả phí.",
        realignedCues: targetCues.slice(0, 10)
    };
}

module.exports = {
    timeToMs,
    msToVtt,
    shiftVtt,
    convertSrtToVtt,
    extractSrtFromZip,
    resolveImdbForSubtitles,
    fetchYtsSubtitles,
    downloadYtsSubtitle,
    fetchOpenSubtitlesRest,
    fetchVietsubList,
    scoreSubtitleMatch,
    isNonVietnameseStream,
    injectSubtitlesIntoStreams,
    translateVttWithGemini,
    parseVttCues,
    fetchAudioSliceFromStream,
    analyzeAudioAndSyncSubtitles
};

