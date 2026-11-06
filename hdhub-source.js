/**
 * 🌟 4KHDHub & HubDrive / HubCloud High-Speed HTTP Streaming Engine
 * - Hỗ trợ phân giải trực tiếp các luồng 4K (2160p) & 1080p chất lượng cao
 * - Chuẩn hóa giao diện hiển thị giống 100% hình ảnh người dùng cung cấp:
 *   "▶ 4KHDHub HubDrive 2160P" / "▶ 4KHDHub HubDrive 1080P"
 * - Bộ lọc chất lượng nghiêm ngặt: CHỈ giữ lại nguồn >= 1080p
 */

const axios = require("axios");
const cheerio = require("cheerio");

const DEFAULT_4KHDHUB_DOMAIN = "https://4khdhub.one";
const DOMAINS_LIST_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let activeDomainCache = { url: DEFAULT_4KHDHUB_DOMAIN, ts: 0 };

/**
 * Lấy domain 4khdhub mới nhất từ danh sách tự động cập nhật
 */
async function getLatestDomain() {
    const now = Date.now();
    if (now - activeDomainCache.ts < 3600 * 1000) {
        return activeDomainCache.url;
    }
    try {
        const res = await axios.get(DOMAINS_LIST_URL, {
            timeout: 3000,
            headers: { "User-Agent": USER_AGENT }
        });
        if (res.data && res.data["4khdhub"]) {
            activeDomainCache.url = res.data["4khdhub"].replace(/\/+$/, "");
            activeDomainCache.ts = now;
        }
    } catch (e) {
        // Giữ domain mặc định
    }
    return activeDomainCache.url;
}

function rot13Cipher(str) {
    if (!str) return "";
    return str.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

function base64Decode(input) {
    if (!input) return "";
    try {
        return Buffer.from(input, "base64").toString("utf-8");
    } catch (e) {
        return "";
    }
}

function levenshteinDistance(s, t) {
    if (s === t) return 0;
    const n = s.length;
    const m = t.length;
    if (n === 0) return m;
    if (m === 0) return n;
    const d = [];
    for (let i = 0; i <= n; i++) {
        d[i] = [];
        d[i][0] = i;
    }
    for (let j = 0; j <= m; j++) {
        d[0][j] = j;
    }
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        }
    }
    return d[n][m];
}

/**
 * Giải mã các link trung gian (greenmotors, v.v.) qua nhiều tầng Base64 + Rot13
 * Tự động trích xuất HubCloud nếu link đích là HubDrive
 */
async function resolveRedirectUrl(redirectUrl) {
    if (!redirectUrl) return null;
    let url = redirectUrl;

    if (!url.includes("hubcloud.") && !url.includes("hubdrive.")) {
        try {
            const res = await axios.get(url, {
                timeout: 4000,
                headers: { "User-Agent": USER_AGENT }
            });
            const html = res.data;
            if (html && typeof html === "string") {
                const match = html.match(/'o','(.*?)'/);
                if (match && match[1]) {
                    const s1 = base64Decode(match[1]);
                    const s2 = base64Decode(s1);
                    const s3 = rot13Cipher(s2);
                    const s4 = base64Decode(s3);
                    const redirectData = JSON.parse(s4);
                    if (redirectData && redirectData.o) {
                        url = base64Decode(redirectData.o);
                    }
                }
            }
        } catch (e) {}
    }

    // Nếu url trỏ về HubDrive (e.g. hubdrive.bar/file/...), trích xuất link HubCloud bên trong
    if (url && (url.includes("hubdrive.") || url.includes("hubdrive/"))) {
        try {
            const resDrive = await axios.get(url, {
                timeout: 4500,
                headers: { "User-Agent": USER_AGENT }
            });
            const $d = cheerio.load(resDrive.data);
            let cloudLink = null;
            $d("a").each((_, el) => {
                const href = $d(el).attr("href") || "";
                const text = $d(el).text().trim();
                if (href.includes("hubcloud.") || text.includes("HubCloud")) {
                    cloudLink = href;
                }
            });
            if (cloudLink) {
                url = cloudLink;
            }
        } catch (e) {}
    }

    return url;
}

function parseSizeToBytes(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/([\d.]+)\s*([GMK]B)/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'GB') return Math.round(num * 1024 * 1024 * 1024);
    if (unit === 'MB') return Math.round(num * 1024 * 1024);
    if (unit === 'KB') return Math.round(num * 1024);
    return Math.round(num);
}

function parseVideoCodecAndHdr(title) {
    const t = (title || "").toLowerCase();
    let isDv = false;
    let isRemux = t.includes("remux");
    let dynamicRange = "SDR";
    
    if (t.includes("dv") || t.includes("dolby vision") || t.includes("dovi")) {
        isDv = true;
        dynamicRange = isRemux ? "DV Profile 7 (REMUX)" : "DV / HDR10";
    } else if (t.includes("hdr10+") || t.includes("hdr10plus")) {
        dynamicRange = "HDR10+";
    } else if (t.includes("hdr10") || t.includes("hdr 10bit") || t.includes("hdr")) {
        dynamicRange = "HDR10";
    } else if (t.includes("sdr")) {
        dynamicRange = "SDR";
    }

    let isHevc = t.includes("hevc") || t.includes("x265") || t.includes("h265") || t.includes("h.265");
    let isAvc = t.includes("x264") || t.includes("h264") || t.includes("avc");

    return {
        isDv,
        isRemux,
        dynamicRange,
        isHevc,
        isAvc,
        isUniversal: !isRemux && (t.includes("sdr") || t.includes("hdr") || t.includes("web-dl") || t.includes("webrip"))
    };
}

/**
 * Trích xuất direct HTTP streams từ HubCloud landing page
 */
async function extractHubCloudStreams(hubCloudUrl, baseMeta) {
    if (!hubCloudUrl) return [];
    try {
        const res1 = await axios.get(hubCloudUrl, {
            timeout: 5000,
            headers: {
                "User-Agent": USER_AGENT,
                "Referer": hubCloudUrl
            }
        });
        const html1 = res1.data;
        if (typeof html1 !== "string") return [];

        let finalLinksUrl = null;
        const redirectMatch = html1.match(/(?:var url|window\.location(?:\.href)?)\s*=\s*['"]([^'"]+)['"]/i);
        if (redirectMatch && redirectMatch[1]) {
            finalLinksUrl = redirectMatch[1];
        } else {
            const $1 = cheerio.load(html1);
            const dlBtn = $1('a#download, a.btn-download, a[href*="hubcloud"]').attr("href");
            if (dlBtn && dlBtn.startsWith("http")) finalLinksUrl = dlBtn;
        }

        let targetHtml = html1;
        if (finalLinksUrl) {
            if (!finalLinksUrl.startsWith("http")) {
                try { finalLinksUrl = new URL(finalLinksUrl, hubCloudUrl).href; } catch (e) {}
            }
            const res2 = await axios.get(finalLinksUrl, {
                timeout: 5000,
                headers: {
                    "User-Agent": USER_AGENT,
                    "Referer": hubCloudUrl
                }
            });
            if (typeof res2.data === "string") {
                targetHtml = res2.data;
            }
        }

        const $ = cheerio.load(targetHtml);
        const pageTitle = $("title").text().trim() || baseMeta.title || "";
        const sizeText = $("#size, .size, .filesize").first().text().trim() || baseMeta.size || "";

        const foundStreams = [];

        $("a").each((_, el) => {
            const text = $(el).text().trim();
            const href = $(el).attr("href");
            if (!href || !href.startsWith("http")) return;

            // 🚫 BỎ QUA CÁC LINK QUẢNG CÁO / LANDING PAGE / HTML GENERATOR (NGUYÊN NHÂN GÂY KẸT "ĐANG TẢI BỘ NHỚ ĐỆM")
            if (href.includes("gpdl.") || href.includes("one.one.one.one") || href.includes("tinyurl.com") || 
                href.includes("t.me/") || href.includes("google.com/search") || href.includes("/admin")) {
                return;
            }

            // 1. hbplay.pages.dev Web Player -> Bóc tách URL direct Cloudflare R2 từ tham số u
            if (href.includes("hbplay.pages.dev") && href.includes("?u=")) {
                try {
                    const parsed = new URL(href);
                    const uParam = parsed.searchParams.get("u");
                    if (uParam) {
                        const directUrl = base64Decode(uParam);
                        if (directUrl && directUrl.startsWith("http")) {
                            foundStreams.push({
                                sourceType: "Direct Cloudflare R2",
                                url: directUrl,
                                title: pageTitle,
                                size: sizeText,
                                height: baseMeta.height
                            });
                        }
                    }
                } catch (e) {}
                return;
            }

            // 2. Direct Cloudflare R2 / Worker / Cloud Storage (Độ ổn định & tốc độ cao nhất)
            if (href.includes("cloudflarestorage.com") || href.includes("workers.dev") || href.includes("r2.dev") || href.includes("storage.googleapis.com")) {
                foundStreams.push({
                    sourceType: "Direct Cloudflare",
                    url: href,
                    title: pageTitle,
                    size: sizeText,
                    height: baseMeta.height
                });
            }
            // 3. FSL / Fast Server (Chỉ chấp nhận các direct URL stream)
            else if (text.includes("FSL") || text.includes("Fast Server") || text.includes("Download File")) {
                if (!href.includes(".php?") && !href.includes("?id=")) {
                    foundStreams.push({
                        sourceType: "Fast Server",
                        url: href,
                        title: pageTitle,
                        size: sizeText,
                        height: baseMeta.height
                    });
                }
            }
        });

        return foundStreams;
    } catch (e) {
        return [];
    }
}

/**
 * Tìm kiếm trang phim trên 4KHDHub theo Title và Year
 */
async function search4khdhubPage(domain, name, year, isSeries) {
    try {
        const cleanQuery = (name || "")
            .replace(/\s*\(\d{4}\)/g, "")
            .replace(/[:\-_.]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const searchUrl = `${domain}/?s=${encodeURIComponent(cleanQuery)}`;
        const res = await axios.get(searchUrl, {
            timeout: 5000,
            headers: { "User-Agent": USER_AGENT }
        });

        const $ = cheerio.load(res.data);
        const targetType = isSeries ? "Series" : "Movies";
        const cards = $(".movie-card");

        let bestMatch = null;
        let lowestDistance = 999;

        cards.each((_, el) => {
            const cardFormat = $(el).find(".movie-card-format").text();
            if (targetType === "Series" && !cardFormat.includes("Series") && !cardFormat.includes("TV")) return;

            const metaText = $(el).find(".movie-card-meta").text().trim();
            const yearMatch = metaText.match(/\b(19\d{2}|20\d{2})\b/);
            const cardYear = yearMatch ? parseInt(yearMatch[1], 10) : NaN;
            if (year && !isNaN(cardYear) && Math.abs(cardYear - year) > 1) return;

            const rawCardTitle = $(el).find(".movie-card-title").text().replace(/\[.*?\]/g, "").trim();
            const cardTitleNorm = rawCardTitle.toLowerCase().replace(/[:\-_.]/g, " ").replace(/\s+/g, " ").trim();
            const queryNorm = cleanQuery.toLowerCase().replace(/[:\-_.]/g, " ").replace(/\s+/g, " ").trim();

            const isSubstrMatch = cardTitleNorm === queryNorm || cardTitleNorm.includes(queryNorm) || queryNorm.includes(cardTitleNorm);
            const dist = levenshteinDistance(cardTitleNorm, queryNorm);

            if (isSubstrMatch || (dist < lowestDistance && dist < 15)) {
                if (dist < lowestDistance) lowestDistance = dist;
                let href = $(el).attr("href");
                if (href && !href.startsWith("http")) {
                    href = domain + (href.startsWith("/") ? "" : "/") + href;
                }
                bestMatch = href;
            }
        });

        return bestMatch;
    } catch (e) {
        return null;
    }
}

/**
 * Lấy danh sách streams từ 4KHDHub & HubDrive
 * @param {Object} params - { title, year, imdbId, type, season, episode, hostUrl }
 * @returns {Promise<Array>} Danh sách streams theo format Stremio
 */
async function fetch4khdhubStreams({ title, year, imdbId, type, season, episode, hostUrl }) {
    if (!title && !imdbId) return [];

    let searchTitle = title;
    let searchYear = year;
    const isSeries = type === "series" || type === "tv";

    // Nếu có IMDB ID mà chưa có title hoặc year, truy vấn TMDB
    if ((!searchTitle || !searchYear) && imdbId) {
        try {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
            const tmdbRes = await axios.get(findUrl, { timeout: 3000 });
            const m = tmdbRes.data?.movie_results?.[0] || tmdbRes.data?.tv_results?.[0];
            if (m) {
                searchTitle = m.title || m.name || searchTitle;
                const dateStr = m.release_date || m.first_air_date || "";
                if (dateStr) searchYear = parseInt(dateStr.split("-")[0], 10);
            }
        } catch (e) {}
    }

    if (!searchTitle) return [];

    try {
        const domain = await getLatestDomain();
        const pageUrl = await search4khdhubPage(domain, searchTitle, searchYear, isSeries);
        if (!pageUrl) return [];

        const pageRes = await axios.get(pageUrl, {
            timeout: 5000,
            headers: { "User-Agent": USER_AGENT }
        });
        const $ = cheerio.load(pageRes.data);

        const itemsToProcess = [];

        if (isSeries && season && episode) {
            const seasonStr = `S${String(season).padStart(2, "0")}`;
            const episodeStr = `Episode-${String(episode).padStart(2, "0")}`;
            $(".episode-item").each((_, el) => {
                if ($(".episode-title", el).text().includes(seasonStr)) {
                    $(".episode-download-item", el).each((_, item) => {
                        if ($(item).text().includes(episodeStr)) {
                            itemsToProcess.push(item);
                        }
                    });
                }
            });
        } else {
            $(".download-item").each((_, el) => {
                itemsToProcess.push(el);
            });
        }

        if (itemsToProcess.length === 0) return [];

        // Trích xuất metadata và redirect link từ từng download item
        const candidateItems = [];

        for (const item of itemsToProcess) {
            const itemHtml = $(item).html() || "";
            const itemText = $(item).text();

            const sizeMatch = itemHtml.match(/([\d.]+ ?[GM]B)/i) || itemText.match(/([\d.]+ ?[GM]B)/i);
            const sizeStr = sizeMatch ? sizeMatch[1].trim() : "";

            let height = 0;
            const heightMatch = itemHtml.match(/(\d{3,4})p/i) || itemText.match(/(\d{3,4})p/i);
            if (heightMatch) height = parseInt(heightMatch[1], 10);
            if (height === 0 && (/4k/i.test(itemHtml) || /2160/i.test(itemHtml))) {
                height = 2160;
            }

            // 🌟 BỘ LỌC CHẤT LƯỢNG NGHIÊM NGẶT: Chỉ giữ >= 1080p
            if (height > 0 && height < 1080) continue;
            if (height === 0) height = 1080;

            const fileTitle = $(item).find(".file-title, .episode-file-title").text().trim() ||
                              $(item).find("h3, h4, strong").first().text().trim() ||
                              searchTitle;

            // Tìm HubCloud hoặc HubDrive link - Luôn ưu tiên HubCloud trước
            let cloudLink = null;
            let driveLink = null;
            $(item).find("a").each((_, a) => {
                const aText = $(a).text();
                const aHref = $(a).attr("href") || "";
                if (aText.includes("HubCloud") || aHref.includes("hubcloud")) {
                    cloudLink = aHref;
                } else if (aText.includes("HubDrive") || aHref.includes("hubdrive") || aHref.includes("greenmotors")) {
                    driveLink = aHref;
                }
            });

            const directCloudLink = cloudLink || driveLink;

            if (directCloudLink) {
                candidateItems.push({
                    link: directCloudLink,
                    meta: {
                        title: fileTitle,
                        size: sizeStr,
                        height: height
                    }
                });
            }
        }

        // Xử lý tối đa 6 candidate items song song để đạt tốc độ cao
        const selectedCandidates = candidateItems.slice(0, 6);
        const resolvedStreamsList = await Promise.all(selectedCandidates.map(async (cand) => {
            try {
                const resolvedHubCloudUrl = await resolveRedirectUrl(cand.link);
                if (!resolvedHubCloudUrl) return [];

                const streams = await extractHubCloudStreams(resolvedHubCloudUrl, cand.meta);
                return streams;
            } catch (err) {
                return [];
            }
        }));

        const flattened = resolvedStreamsList.flat();

        // Loại bỏ trùng lặp URL
        const seenUrls = new Set();
        const uniqueItems = [];
        for (const item of flattened) {
            if (!item.url || seenUrls.has(item.url)) continue;
            seenUrls.add(item.url);
            uniqueItems.push(item);
        }

        // Định dạng streams theo đúng quy chuẩn giao diện ảnh Photo 1
        const formattedStreams = uniqueItems.map((item) => {
            const is4K = (item.height && item.height >= 2160) || /4k|2160p/i.test(item.title);
            const qualityLabel = is4K ? "2160P" : "1080P";
            const providerHeader = `▶ 4KHDHub HubDrive ${qualityLabel}`;

            let cleanTitle = item.title.trim();
            if (!cleanTitle.toLowerCase().endsWith(".mkv") && !cleanTitle.toLowerCase().endsWith(".mp4")) {
                cleanTitle += ".mkv";
            }

            const safeFileName = cleanTitle
                .replace(/[/\\?%*:|"<>]/g, '_')
                .replace(/\s+/g, '.')
                .replace(/\.+/g, '.');

            const byteSize = parseSizeToBytes(item.size);
            const videoAttrs = parseVideoCodecAndHdr(item.title);

            // Xây dựng URL stream an toàn: Định tuyến qua /proxy/stream/:filename
            // để loại bỏ triệt để lỗi HEAD 403 S3/R2 và cung cấp Accept-Ranges chuẩn cho ExoPlayer CacheDataSource
            let streamUrl = item.url;
            if (hostUrl) {
                const encodedOrig = encodeURIComponent(item.url);
                streamUrl = `${hostUrl}/proxy/stream/${encodeURIComponent(safeFileName)}?url=${encodedOrig}&size=${byteSize}`;
            }

            const descLines = [cleanTitle];
            if (item.size) {
                descLines.push(`Size: ${item.size}`);
            }

            return {
                name: providerHeader,
                title: descLines.join("\n"),
                url: streamUrl,
                originalUrl: item.url,
                quality: qualityLabel,
                is1080pOrHigher: true,
                isUniversal: videoAttrs.isUniversal,
                isRemux: videoAttrs.isRemux,
                isDv: videoAttrs.isDv,
                behaviorHints: {
                    // 🌟 CRITICAL: notWebReady = true buộc Stremio/Nuvio kích hoạt native ExoPlayer decoder
                    // Chấm dứt hiện tượng màn hình đen chỉ phát âm thanh do HTML5 <video> không giải mã được HEVC/MKV!
                    notWebReady: true,
                    filename: safeFileName,
                    videoSize: byteSize > 0 ? byteSize : undefined,
                    bingeGroup: `4khdhub-${qualityLabel}`,
                    proxyHeaders: {
                        request: {
                            "User-Agent": USER_AGENT,
                            "Accept": "*/*"
                        }
                    }
                }
            };
        });

        // Sắp xếp ưu tiên:
        // 1. 2160P (4K) lên đầu, tiếp đến 1080P
        // 2. Trong các bản 4K: Bản WEB-DL / SDR / HDR10 (tương thích 100% mọi thiết bị) lên trước REMUX DV Profile 7
        formattedStreams.sort((a, b) => {
            const a4k = a.quality === "2160P" ? 1 : 0;
            const b4k = b.quality === "2160P" ? 1 : 0;
            if (b4k !== a4k) return b4k - a4k;

            const aUni = a.isUniversal ? 1 : 0;
            const bUni = b.isUniversal ? 1 : 0;
            if (bUni !== aUni) return bUni - aUni;

            return 0;
        });

        return formattedStreams;
    } catch (e) {
        return [];
    }
}

module.exports = {
    fetch4khdhubStreams,
    getLatestDomain,
    resolveRedirectUrl,
    extractHubCloudStreams,
    search4khdhubPage
};
