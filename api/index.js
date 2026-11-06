/**
 * TUNGNUI PRO 4.1 - SERVERLESS ENTRY POINT (WEBVIEW SHAKA ĐẶC TRỊ DRM 100%)
 * - Tích hợp AI Gemini Dịch Phụ Đề
 * - [BẢN VÁ LỖI CUỐI CÙNG]: Tương thích ngược với hệ điều hành Android Tivi Cũ.
 *   Xử lý lỗi regex của Pháp Sư, tái kích hoạt Cổng Phát Webview (Bung giống Vsmov).
 */

const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const sources = require("../sources");
const scraper = require("../scraper");
const subHarvester = require("../sub-harvester");
const aiHealer = require("../ai-source-finder");
const hdhubSource = require("../hdhub-source");

const app = express();
const cache = new NodeCache({ stdTTL: 1800, checkperiod: 593 }); // Ép xóa Cache máy chủ

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const getHostUrl = (req) => {
    const fwdHost = req.headers['x-forwarded-host'];
    let host = (fwdHost ? String(fwdHost).split(',')[0].trim() : '') || req.get('host') || req.headers['host'] || 'localhost:3000';
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
        const originOrRef = req.headers['origin'] || req.headers['referer'] || '';
        if (originOrRef && !originOrRef.includes('localhost') && !originOrRef.includes('127.0.0.1')) {
            try {
                const u = new URL(originOrRef);
                return `${u.protocol}//${u.host}`;
            } catch (_) {}
        }
    }
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const proto = req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : (isLocal ? 'http' : 'https');
    return `${isLocal ? 'http' : proto}://${host}`;
};

// 1. CORS & PHÂN LỚP VERCEL CDN CACHE
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST");
    if (req.method === "OPTIONS") return res.sendStatus(200);

    if (req.url.includes("subtitles") || req.url.includes("sub-") || req.url.includes("/stream/")) {
        console.log(`[CLIENT-REQ] ${req.method} ${req.url} (UA: ${req.get('user-agent') || 'none'})`);
    }

    if (req.method === "GET" || req.method === "HEAD") {
        if (req.url.includes("/catalog/")) res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400");
        else if (req.url.includes("/stream/")) res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
        else if (req.url.includes("/meta/")) res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=3600");
        else if (req.url.includes("/subtitles/") && !req.url.includes("gemini-translate")) res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    }
    next();
});

// 2. API CATALOGS CHO REACT SPA
app.get("/api/catalogs", (req, res) => {
    res.json({
        success: true,
        tvCatalogs: sources.TV_CATALOGS || [],
        movieCatalogs: sources.MOVIE_CATALOGS || [],
        adultCatalogs: sources.ADULT_SUB_CATALOGS || []
    });
});

// 3. MANIFEST
app.get(["/manifest.json"], (req, res) => res.json(sources.buildManifest("")));
app.get(["/config/:options/manifest.json", "/:options/manifest.json"], (req, res) => res.json(sources.buildManifest(req.params.options)));

// ==============================================================================
// 🌟 AI SOURCE DISCOVERY & SELF-HEALING ORCHESTRATOR v2.5 ENDPOINTS
// ==============================================================================
// Giao diện NOC Dashboard giám sát trực quan thời gian thực
app.get(["/noc", "/dashboard", "/api/dashboard"], aiHealer.handleDashboardHtml);

// Cổng Proxy CORS & Header Streaming (Manifest Rewriting & Pipe)
app.all(["/api/stream-proxy", "/api/proxy-stream"], aiHealer.handleStreamProxy);

// Telemetry & Circuit Breaker Health Matrix
app.get("/api/system-health", (req, res) => {
    res.json({
        success: true,
        healthMatrix: aiHealer.systemHealthMatrix
    });
});

// Kích hoạt thủ công chu trình Tự Phục Hồi Toàn Hệ Thống
app.post("/api/trigger-heal", async (req, res) => {
    const result = await aiHealer.runSelfHealingCycle();
    res.json(result);
});

// Micro-Healing: Nhận báo lỗi cục bộ từ Client để cứu kênh tức thời
app.post("/api/stream-report", aiHealer.handleStreamReport);

// ==============================================================================
// ⚽ IPTV / M3U EXPORT ENDPOINTS & LIVE FOOTBALL ENGINE
// ==============================================================================

// 1. Tự động xuất Playlist M3U Trực Tiếp Bóng Đá & 23 Kênh BLV Cola TV (vuminhthanh)
// Sắp xếp theo trình tự thời gian: Đang đá (LIVE) -> Sắp đá (Gần nhất -> Xa nhất)
app.get(["/playlist.m3u", "/api/iptv/football.m3u"], async (req, res) => {
    try {
        const matches = await sources.fetchLiveMatches(cache);
        const groupFilter = req.query.group || "all";
        const m3uContent = sources.generateFootballM3uPlaylist(matches, { group: groupFilter });

        res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300");
        if (req.query.download === "1" || req.query.download === "true") {
            res.setHeader("Content-Disposition", 'attachment; filename="football_matches.m3u"');
        }
        res.send(m3uContent);
    } catch (err) {
        res.status(500).send("#EXTM3U\n# Error generating playlist: " + err.message);
    }
});

// 2. Xuất toàn bộ kênh BLV Thể Thao (Cola TV, Gà Vàng 33 & 24h, Khán Đài, Xôi Chè) sang M3U
app.get(["/api/iptv/cola-tv.m3u", "/api/iptv/commentators.m3u"], (req, res) => {
    try {
        const isColaOnly = req.path.includes("cola-tv") && req.query.all !== "1";
        const streamsToExport = isColaOnly ? sources.COLA_TV_STREAMS : (sources.ALL_COMMENTATOR_STREAMS || sources.COLA_TV_STREAMS);
        const commentatorMatches = streamsToExport.map(ch => ({
            id: ch.id,
            name: ch.name,
            genre: ch.group,
            poster: ch.poster,
            streams: [
                {
                    name: ch.name,
                    url: ch.streamUrl,
                    behaviorHints: { proxyHeaders: { request: { "User-Agent": ch.userAgent } } }
                }
            ]
        }));
        const m3uContent = sources.generateFootballM3uPlaylist(commentatorMatches, { group: "all" });

        res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=7200");
        if (req.query.download === "1" || req.query.download === "true") {
            res.setHeader("Content-Disposition", `attachment; filename="${isColaOnly ? 'cola_tv' : 'commentators'}.m3u"`);
        }
        res.send(m3uContent);
    } catch (err) {
        res.status(500).send("#EXTM3U\n# Error: " + err.message);
    }
});

// 3. API JSON danh sách trận đấu bóng đá được sắp xếp theo thời gian
app.get("/api/football/matches", async (req, res) => {
    try {
        const matches = await sources.fetchLiveMatches(cache);
        const liveCount = matches.filter(m => m.timing?.status === 'live').length;
        const upcomingCount = matches.filter(m => m.timing?.status === 'upcoming').length;

        res.json({
            success: true,
            totalMatches: matches.length,
            stats: {
                live: liveCount,
                upcoming: upcomingCount,
                undated: matches.length - (liveCount + upcomingCount)
            },
            timezone: "Asia/Ho_Chi_Minh (GMT+7)",
            updatedAt: new Date().toISOString(),
            matches
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==============================================================================
// 🌟 GIAO THỨC UNIVERSAL TVBOX & FONGMI (TVBOX V3/V4 / FONGMI JSON SUBSCRIPTION)
// Cung cấp 1 URL duy nhất biến server thành kho phim & truyền hình cho Android TV
// ==============================================================================

// 1. Xuất Playlist M3U Toàn Bộ Kênh Truyền Hình Trực Tiếp (.mpd ClearKey & HLS)
app.get(["/api/iptv/live-tv.m3u", "/api/iptv/channels.m3u"], async (req, res) => {
    try {
        const hostUrl = getHostUrl(req);
        const channels = await sources.fetchUnifiedTvChannels(cache);
        const m3uContent = sources.generateLiveTvM3uPlaylist(channels, hostUrl);

        res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=600, s-maxage=1200");
        if (req.query.download === "1" || req.query.download === "true") {
            res.setHeader("Content-Disposition", 'attachment; filename="livetv_channels.m3u"');
        }
        res.send(m3uContent);
    } catch (err) {
        res.status(500).send("#EXTM3U\n# Error: " + err.message);
    }
});

// 2. Cổng cấu hình TVBox & FongMi JSON Subscription Endpoint
app.get(["/api/tvbox.json", "/api/fongmi.json", "/tvbox.json", "/fongmi.json", "/api/tvbox/config"], (req, res) => {
    const hostUrl = getHostUrl(req);
    const config = sources.generateTvBoxConfig(hostUrl);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    res.json(config);
});

// 3. Cổng MacCMS V10 Adapter cho TVBox & FongMi (Hỗ trợ ac=list, ac=detail, wd=...)
app.get("/api/tvbox/vod", async (req, res) => {
    const hostUrl = getHostUrl(req);
    const { ac, t, ids, wd, pg } = req.query;
    const page = parseInt(pg || "1", 10);
    const endpoints = sources.getEndpoints();

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // B1: Tìm kiếm phim theo từ khóa (ac=detail&wd=... hoặc ?wd=...)
    if (wd) {
        try {
            const results = await sources.searchAllMovieSources(wd, page);
            const vodList = (results || []).map((m, idx) => ({
                vod_id: m.id || `search_${idx}`,
                vod_name: m.name || "",
                vod_pic: m.poster || "",
                vod_remarks: m.description || "HD",
                type_name: "Phim Tìm Kiếm"
            }));
            return res.json({
                code: 1,
                msg: "ok",
                page,
                pagecount: 10,
                limit: vodList.length,
                total: vodList.length * 10,
                list: vodList
            });
        } catch (e) {
            return res.json({ code: 1, msg: "ok", list: [] });
        }
    }

    // B2: Chi tiết phim và luồng phát (ac=detail&ids=...)
    if (ac === "detail" && ids) {
        const idList = ids.split(",");
        const details = [];

        for (const rawId of idList.slice(0, 5)) {
            try {
                let slug = rawId.replace(/^phim_/, '').replace(/^vsmov_/, '').replace(/^nguonc_/, '');
                let movieName = slug;
                let moviePic = "";
                let episodes = [];

                if (rawId.startsWith("vsmov_")) {
                    const vsData = await sources.fetchVSMOV(slug, null);
                    episodes = vsData?.streams || [];
                } else if (rawId.startsWith("nguonc_")) {
                    const ncData = await sources.fetchNguonC(slug, null);
                    episodes = ncData?.streams || [];
                } else {
                    const kkRes = await axios.get(`${endpoints.kkphim}/phim/${slug}`, { timeout: 3000 });
                    const m = kkRes.data?.movie;
                    if (m) {
                        movieName = m.name || slug;
                        moviePic = sources.getImgUrl(m.thumb_url || m.poster_url);
                        const rawEps = kkRes.data.episodes?.[0]?.server_data || [];
                        episodes = rawEps.map((ep, idx) => ({
                            name: ep.name || `Tập ${idx + 1}`,
                            url: ep.link_m3u8 || ep.link_embed
                        }));
                    }
                }

                const playUrlParts = episodes.map(ep => `${ep.name || 'Full'}$${ep.url}`).join("#");

                details.push({
                    vod_id: rawId,
                    vod_name: movieName,
                    vod_pic: moviePic,
                    vod_remarks: "TUNGNUI PRO HD",
                    vod_play_from: "TungNui VIP",
                    vod_play_url: playUrlParts || "Xem Phim$https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
                });
            } catch (e) {}
        }

        return res.json({
            code: 1,
            msg: "ok",
            list: details
        });
    }

    // B3: Danh sách danh mục & phân trang (ac=list hoặc ac=videolist)
    const categoryClasses = [
        { type_id: "phim-le", type_name: "Phim Lẻ" },
        { type_id: "phim-bo", type_name: "Phim Bộ" },
        { type_id: "phim-chieu-rap", type_name: "Phim Chiếu Rạp" },
        { type_id: "phim-thieu-nhi", type_name: "Hoạt Hình & Anime" },
        { type_id: "phim-thuyet-minh", type_name: "Phim Thuyết Minh" }
    ];

    try {
        const catPath = t ? `danh-sach/${t}` : "danh-sach/phim-moi-cap-nhat";
        const url = `${endpoints.kkphim}/v1/api/${catPath}?page=${page}&limit=20`;
        const response = await axios.get(url, { timeout: 3500 });
        const items = response.data?.data?.items || response.data?.items || [];

        const vodList = items.map(phim => ({
            vod_id: `phim_${phim.slug}`,
            vod_name: phim.name,
            vod_pic: sources.getImgUrl(phim.thumb_url || phim.poster_url),
            vod_remarks: `${phim.year || '2024'} • ${phim.episode_current || 'HD'}`,
            type_name: t || "Phim Mới"
        }));

        res.json({
            code: 1,
            msg: "ok",
            page,
            pagecount: 50,
            limit: 20,
            total: 1000,
            class: categoryClasses,
            list: vodList
        });
    } catch (e) {
        res.json({
            code: 1,
            msg: "ok",
            class: categoryClasses,
            list: []
        });
    }
});

// ==============================================================================
// 🌟 STREAM PROXY SERVER: AURAFLIX / MYTV CDN (MPEG-DASH & HLS)
// Vượt rào cản CORS & Hotlink bảo mật (Referer / Origin / Range) chống màn hình đen
// ==============================================================================

// TỰ ĐỘNG CHẠY BOT HARVESTER & QUÉT CLEARKEY MỖI 30 PHÚT
setInterval(() => {
    sources.refreshChannelsAndClearKeys(cache, true).catch(() => {});
}, 30 * 60 * 1000);

// ENDPOINT KIỂM TRA & ĐỒNG BỘ THỦ CÔNG BOT HARVESTER
app.get("/api/bot/sync", async (req, res) => {
    const force = req.query.force === "true" || req.query.force === "1";
    const channels = await sources.refreshChannelsAndClearKeys(cache, force);
    res.json({
        success: true,
        telemetry: sources.botSyncTelemetry,
        totalChannels: channels.length,
        timestamp: new Date().toISOString()
    });
});

app.all("/proxy-stream", async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("Missing target url");
    targetUrl = targetUrl.replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn");

    const hostUrl = getHostUrl(req);

    // Dynamic origin and referer calculation based on target URL
    let targetOrigin = "https://auraflix.vip";
    try {
        const parsed = new URL(targetUrl);
        targetOrigin = `${parsed.protocol}//${parsed.host}`;
    } catch (e) {}

    const upstreamReferer = req.query.referer || (targetUrl.includes('auraflix') ? 'https://auraflix.vip/' : `${targetOrigin}/`);
    const upstreamOrigin = req.query.origin || (targetUrl.includes('auraflix') ? 'https://auraflix.vip' : targetOrigin);

    const upstreamHeaders = {
        "Referer": upstreamReferer,
        "Origin": upstreamOrigin,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "*/*"
    };
    if (req.headers.range) {
        upstreamHeaders["Range"] = req.headers.range;
    }

    try {
        const isMpd = targetUrl.includes(".mpd") || targetUrl.includes("/manifest");
        const isM3u8 = targetUrl.includes(".m3u8");

        if (isMpd) {
            const cacheKey = "mpd_proxy_" + targetUrl;
            let mpdData = cache.get(cacheKey);

            if (!mpdData) {
                const response = await axios.get(targetUrl, {
                    headers: upstreamHeaders,
                    responseType: "text",
                    timeout: 10000,
                    validateStatus: (status) => status < 400
                });

                mpdData = response.data;
                const baseUrlTarget = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
                const b64Base = Buffer.from(baseUrlTarget).toString("base64url");
                const proxyBaseUrl = `${hostUrl}/proxy/dash/${b64Base}/`;

                mpdData = mpdData.replace(/<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*>[\s\S]*?<\/ContentProtection>/gi, '');
                mpdData = mpdData.replace(/<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*\/>/gi, '');
                mpdData = mpdData.replace(/<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*>[\s\S]*?<\/ContentProtection>/gi, '');
                mpdData = mpdData.replace(/<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*\/>/gi, '');

                if (mpdData.includes("<BaseURL>")) {
                    mpdData = mpdData.replace(/<BaseURL>[\s\S]*?<\/BaseURL>/gi, `<BaseURL>${proxyBaseUrl}</BaseURL>`);
                } else if (mpdData.includes("<Period")) {
                    mpdData = mpdData.replace("<Period", `<BaseURL>${proxyBaseUrl}</BaseURL><Period`);
                }
                cache.set(cacheKey, mpdData, 2);
            }

            res.setHeader("Content-Type", "application/dash+xml; charset=utf-8");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Cache-Control", "public, max-age=2, s-maxage=3");
            return res.send(mpdData);
        } else if (isM3u8 && !req.headers.range) {
            // Dynamic HLS Playlist Rewriting: Ensure relative segments route through the proxy
            const response = await axios.get(targetUrl, {
                headers: upstreamHeaders,
                responseType: "text",
                timeout: 10000,
                validateStatus: (status) => status < 400
            });

            let playlist = response.data;
            if (typeof playlist === "string" && playlist.includes("#EXTM3U")) {
                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
                playlist = playlist.split("\n").map(line => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) return line;
                    const resolved = trimmed.startsWith("http://") || trimmed.startsWith("https://") 
                        ? trimmed 
                        : (baseUrl + trimmed);
                    return `${hostUrl}/proxy-stream?url=${encodeURIComponent(resolved)}&referer=${encodeURIComponent(upstreamReferer)}`;
                }).join("\n");

                res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Cache-Control", "public, max-age=3, s-maxage=5");
                return res.send(playlist);
            }

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Access-Control-Allow-Origin", "*");
            return res.send(playlist);
        } else {
            const response = await axios({
                method: req.method,
                url: targetUrl,
                headers: upstreamHeaders,
                responseType: "stream",
                timeout: 15000,
                validateStatus: (status) => status < 400
            });

            res.status(response.status);
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, immutable");
            if (response.headers["content-type"]) res.setHeader("Content-Type", response.headers["content-type"]);
            if (response.headers["content-length"]) res.setHeader("Content-Length", response.headers["content-length"]);
            if (response.headers["content-range"]) res.setHeader("Content-Range", response.headers["content-range"]);
            if (response.headers["accept-ranges"]) res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);

            return response.data.pipe(res);
        }
    } catch (err) {
        console.error("Proxy error for", targetUrl, err.message);
        // CƠ CHẾ TỰ PHỤC HỒI NGUỒN PHÁT (SELF-HEALING FAILOVER):
        const fallbackUrl = req.query.fallback;
        if (fallbackUrl && fallbackUrl !== targetUrl && fallbackUrl.startsWith("http")) {
            console.log(`[SELF-HEALING] Kích hoạt chuyển mạch dự phòng sang: ${fallbackUrl}`);
            try {
                const fbRes = await axios({
                    method: req.method,
                    url: fallbackUrl,
                    headers: upstreamHeaders,
                    responseType: "stream",
                    timeout: 15000,
                    validateStatus: (status) => status < 400
                });
                res.status(fbRes.status);
                res.setHeader("Access-Control-Allow-Origin", "*");
                if (fbRes.headers["content-type"]) res.setHeader("Content-Type", fbRes.headers["content-type"]);
                return fbRes.data.pipe(res);
            } catch (fbErr) {
                console.error("Fallback stream also failed:", fbErr.message);
            }
        }
        return res.status(502).send("Proxy upstream error: " + err.message);
    }
});

// CỔNG PROXY MPEG-DASH PHÂN ĐOẠN (CHỐNG LỖI MÀN HÌNH ĐEN STREMIO/NUVIO)
app.all("/proxy/dash/:b64Base/*", async (req, res) => {
    try {
        const { b64Base } = req.params;
        const segmentPath = req.params[0] || "";
        const baseDir = Buffer.from(b64Base, "base64url").toString("utf-8");
        let targetUrl = baseDir + segmentPath;
        targetUrl = targetUrl.replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn");

        const hostUrl = getHostUrl(req);

        const upstreamHeaders = {
            "Referer": "https://auraflix.vip/",
            "Origin": "https://auraflix.vip",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "*/*"
        };
        if (req.headers.range) {
            upstreamHeaders["Range"] = req.headers.range;
        }

        const isMpd = segmentPath.endsWith(".mpd") || segmentPath.includes("manifest");
        if (isMpd) {
            const cacheKey = "mpd_dash_" + targetUrl;
            let mpdData = cache.get(cacheKey);

            if (!mpdData) {
                const response = await axios.get(targetUrl, {
                    headers: upstreamHeaders,
                    responseType: "text",
                    timeout: 10000,
                    validateStatus: (status) => status < 400
                });
                mpdData = response.data;
                const proxyBaseUrl = `${hostUrl}/proxy/dash/${b64Base}/`;

                mpdData = mpdData.replace(/<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*>[\s\S]*?<\/ContentProtection>/gi, '');
                mpdData = mpdData.replace(/<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*\/>/gi, '');
                mpdData = mpdData.replace(/<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*>[\s\S]*?<\/ContentProtection>/gi, '');
                mpdData = mpdData.replace(/<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*\/>/gi, '');

                if (mpdData.includes("<BaseURL>")) {
                    mpdData = mpdData.replace(/<BaseURL>[\s\S]*?<\/BaseURL>/gi, `<BaseURL>${proxyBaseUrl}</BaseURL>`);
                } else if (mpdData.includes("<Period")) {
                    mpdData = mpdData.replace("<Period", `<BaseURL>${proxyBaseUrl}</BaseURL><Period`);
                }
                cache.set(cacheKey, mpdData, 2);
            }

            res.setHeader("Content-Type", "application/dash+xml; charset=utf-8");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Cache-Control", "public, max-age=2, s-maxage=3");
            return res.send(mpdData);
        } else {
            const response = await axios({
                method: req.method,
                url: targetUrl,
                headers: upstreamHeaders,
                responseType: "stream",
                timeout: 15000,
                validateStatus: (status) => status < 400
            });

            res.status(response.status);
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, immutable");
            if (response.headers["content-type"]) res.setHeader("Content-Type", response.headers["content-type"]);
            if (response.headers["content-length"]) res.setHeader("Content-Length", response.headers["content-length"]);
            if (response.headers["content-range"]) res.setHeader("Content-Range", response.headers["content-range"]);
            if (response.headers["accept-ranges"]) res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);

            return response.data.pipe(res);
        }
    } catch (err) {
        console.error("Proxy dash segment error:", err.message);
        return res.status(502).send("Proxy error: " + err.message);
    }
});

// ==============================================================================
// 🛡️ ANTI-403 HLS PROXY LAYER (DÀNH CHO NGUONC / STREAMC VÀ CÁC NGUỒN BẢO MẬT)
// Tự động phân giải m3u8, viết lại phân đoạn .ts và chèn Header Referer / Origin
// ==============================================================================
app.get("/proxy/hls", async (req, res) => {
    try {
        const streamUrl = req.query.url;
        if (!streamUrl) return res.status(400).send("Missing stream url");

        let referer = req.query.ref || "";
        if (!referer) {
            if (streamUrl.includes("nguonc") || streamUrl.includes("streamc")) {
                referer = "https://phim.nguonc.com/";
            } else if (streamUrl.includes("ophim") || streamUrl.includes("stream-ophim")) {
                referer = "https://ophim1.com/";
            } else {
                referer = "https://phimapi.com/";
            }
        }

        let origin = "";
        try {
            const parsedRef = new URL(referer);
            origin = `${parsedRef.protocol}//${parsedRef.host}`;
        } catch (e) {
            origin = "https://phim.nguonc.com";
        }

        const isLikelySegment = /\.(ts|m4s|mp4|aac|mp3|vtt|key|jpg|jpeg|png|webp|woff|ttf)(\?|$)/i.test(streamUrl);
        const isM3u8 = streamUrl.includes(".m3u8") || req.path.endsWith(".m3u8") || !isLikelySegment;

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

        if (req.method === "HEAD") {
            return res.status(200).end();
        }

        const hostUrl = getHostUrl(req);

        if (isM3u8) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
            res.setHeader("Cache-Control", "public, max-age=60");

            const response = await axios.get(streamUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                    "Referer": referer,
                    "Origin": origin,
                    "Accept": "*/*"
                },
                responseType: "text",
                timeout: 7000
            });

            const content = response.data;
            if (typeof content !== "string") {
                return res.status(502).send("Invalid m3u8 playlist response");
            }

            const finalStreamUrl = response.request?.res?.responseUrl || streamUrl;
            const baseUrl = finalStreamUrl.substring(0, finalStreamUrl.lastIndexOf("/") + 1);
            const lines = content.split('\n');
            const rewrittenLines = [];

            for (let line of lines) {
                const trimmed = line.trim();
                if (!trimmed) {
                    rewrittenLines.push(line);
                    continue;
                }

                if (trimmed.startsWith('#')) {
                    if (trimmed.includes('URI="')) {
                        const rewrittenDirective = trimmed.replace(/URI="([^"]+)"/, (match, rawUri) => {
                            let absUri = rawUri;
                            if (!absUri.startsWith("http://") && !absUri.startsWith("https://")) {
                                try { absUri = new URL(rawUri, baseUrl).href; } catch (e) {}
                            }
                            const proxiedUri = `${hostUrl}/proxy/hls?url=${encodeURIComponent(absUri)}&ref=${encodeURIComponent(referer)}`;
                            return `URI="${proxiedUri}"`;
                        });
                        rewrittenLines.push(rewrittenDirective);
                    } else {
                        rewrittenLines.push(line);
                    }
                } else {
                    let absSegUrl = trimmed;
                    if (!absSegUrl.startsWith("http://") && !absSegUrl.startsWith("https://")) {
                        try { absSegUrl = new URL(trimmed, baseUrl).href; } catch (e) {}
                    }
                    const proxiedSegUrl = `${hostUrl}/proxy/hls?url=${encodeURIComponent(absSegUrl)}&ref=${encodeURIComponent(referer)}`;
                    rewrittenLines.push(proxiedSegUrl);
                }
            }

            return res.send(rewrittenLines.join('\n'));
        } else {
            const forwardHeaders = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": origin,
                "Accept": "*/*"
            };
            if (req.headers.range) {
                forwardHeaders["Range"] = req.headers.range;
            }

            const response = await axios.get(streamUrl, {
                headers: forwardHeaders,
                responseType: "stream",
                timeout: 10000,
                validateStatus: (status) => status >= 200 && status < 400
            });

            if (response.headers["content-type"]) {
                res.setHeader("Content-Type", response.headers["content-type"]);
            } else if (streamUrl.includes(".ts")) {
                res.setHeader("Content-Type", "video/mp2t");
            }

            if (response.headers["content-length"]) {
                res.setHeader("Content-Length", response.headers["content-length"]);
            }
            if (response.headers["content-range"]) {
                res.setHeader("Content-Range", response.headers["content-range"]);
                res.status(206);
            }
            res.setHeader("Cache-Control", "public, max-age=3600");

            return response.data.pipe(res);
        }
    } catch (err) {
        return res.status(502).send("Anti-403 Proxy Error: " + err.message);
    }
});

// ==============================================================================
// 🌟 HIGH-SPEED STREAM PROXY & RANGE FORWARDER CHO 4KHDHUB & S3/R2 STORAGE
// - Khắc phục triệt để lỗi HEAD 403 Forbidden của link AWS S3/Cloudflare R2 pre-signed
// - Phản hồi ngay lập tức 200 OK, Content-Type: video/x-matroska và Accept-Ranges: bytes cho ExoPlayer
// - Chấm dứt kẹt "Đang tải bộ nhớ đệm" (Loading cache) & Màn hình đen khi giải mã MKV/HEVC
// ==============================================================================
app.all(["/proxy/stream/:filename", "/proxy/stream"], async (req, res) => {
    try {
        const streamUrl = req.query.url;
        if (!streamUrl) return res.status(400).send("Missing stream url parameter");

        const filename = req.params.filename || "video.mkv";
        const isMkv = filename.toLowerCase().endsWith(".mkv");
        const contentType = isMkv ? "video/x-matroska" : (filename.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/x-matroska");
        const querySize = parseInt(req.query.size, 10);

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

        if (req.method === "OPTIONS") {
            return res.status(200).end();
        }

        // Xử lý request HEAD từ ExoPlayer / Nuvio
        if (req.method === "HEAD") {
            let totalLength = !isNaN(querySize) && querySize > 0 ? querySize : null;
            if (!totalLength) {
                try {
                    const probe = await axios.get(streamUrl, {
                        headers: {
                            "Range": "bytes=0-0",
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                        },
                        timeout: 3500,
                        validateStatus: s => s >= 200 && s < 400
                    });
                    const cr = probe.headers["content-range"];
                    if (cr) {
                        const m = cr.match(/\/(\d+)/);
                        if (m) totalLength = parseInt(m[1], 10);
                    }
                } catch (e) {}
            }

            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");
            if (totalLength) res.setHeader("Content-Length", String(totalLength));
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
            res.setHeader("Cache-Control", "public, max-age=14400");
            return res.status(200).end();
        }

        // Xử lý request GET từ ExoPlayer / Nuvio
        if (req.query.mode === "pipe") {
            const forwardHeaders = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                "Accept": "*/*"
            };
            if (req.headers.range) {
                forwardHeaders["Range"] = req.headers.range;
            }
            const upstream = await axios.get(streamUrl, {
                headers: forwardHeaders,
                responseType: "stream",
                timeout: 15000,
                validateStatus: s => s >= 200 && s < 400
            });
            res.status(upstream.status);
            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");
            if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"]);
            if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
            return upstream.data.pipe(res);
        }

        // Mặc định: Trả về HTTP 302 Found chuyển tiếp trực tiếp sang link Cloudflare R2 / S3
        // Giúp thiết bị tải trực tiếp tốc độ tối đa từ CDN toàn cầu mà không gây nghẽn server
        res.writeHead(302, {
            "Location": streamUrl,
            "Access-Control-Allow-Origin": "*"
        });
        return res.end();
    } catch (err) {
        return res.status(502).send("Stream Proxy Error: " + err.message);
    }
});

// CỔNG HLS SUBTITLE PLAYLIST (CHUYỂN ĐỔI WEBVTT THÀNH CHUẨN MEDIA PLAYLIST HLS CHO EXOPLAYER NUVIO)
app.get("/proxy/hls-sub.m3u8", (req, res) => {
    const vttUrl = req.query.vtt;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");

    if (!vttUrl) {
        return res.send("#EXTM3U\n#EXT-X-ENDLIST");
    }

    // Trả về HLS WebVTT Media Playlist hợp lệ theo RFC 8216 cho ExoPlayer
    const playlist = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:10800",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXTINF:10800.000,",
        vttUrl,
        "#EXT-X-ENDLIST"
    ].join('\n');

    return res.send(playlist);
});

// CỔNG PROXY HLS M3U8 CẤY TRACK SUBTITLES TRỰC TIẾP VÀO MASTER PLAYLIST (DÀNH CHO EXOPLAYER NUVIO)
app.get("/proxy/m3u8-sub", async (req, res) => {
    try {
        const streamUrl = req.query.url;
        const subUrl = req.query.sub;
        const referer = req.query.ref || "https://phimapi.com/";

        if (!streamUrl) return res.status(400).send("Missing url");

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");

        const response = await axios.get(streamUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": referer
            },
            responseType: "text",
            timeout: 5000
        });

        let content = response.data;
        const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf("/") + 1);
        const hostUrl = getHostUrl(req);

        // Nếu là Master Playlist (#EXT-X-STREAM-INF)
        if (content.includes("#EXT-X-STREAM-INF")) {
            let injectedTag = "";
            if (subUrl) {
                const subPlaylistUri = `${hostUrl}/proxy/hls-sub.m3u8?vtt=${encodeURIComponent(subUrl)}`;
                injectedTag = `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Tiếng Việt",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="vi",URI="${subPlaylistUri}"\n`;
            }

            const lines = content.split('\n');
            const newLines = [];
            let injected = false;

            for (let line of lines) {
                const trimmed = line.trim();
                if (!injected && (trimmed.startsWith('#EXT-X-STREAM-INF') || trimmed.startsWith('#EXT-X-MEDIA'))) {
                    if (injectedTag) newLines.push(injectedTag.trim());
                    injected = true;
                }

                if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
                    if (!trimmed.includes('SUBTITLES=')) {
                        line = trimmed + ',SUBTITLES="subs"';
                    }
                    newLines.push(line);
                } else if (trimmed && !trimmed.startsWith('#')) {
                    if (!trimmed.startsWith('http')) {
                        newLines.push(baseUrl + trimmed);
                    } else {
                        newLines.push(trimmed);
                    }
                } else {
                    newLines.push(line);
                }
            }
            return res.send(newLines.join('\n'));
        }

        // Nếu là Media Playlist
        const lines = content.split('\n');
        const newLines = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('http')) {
                return baseUrl + trimmed;
            }
            return line;
        });
        return res.send(newLines.join('\n'));
    } catch (err) {
        return res.status(502).send("Proxy error: " + err.message);
    }
});

// ==============================================================================
// 🌟 MÁY CHỦ BỂ KHÓA WEBVIEW BẢN HOÀN HẢO (CHẾ ĐỘ TƯƠNG THÍCH CAO CHO TIVI CŨ)
// Đổ bê tông trị bệnh kén Widevine MPD (Lỗi 6008) trực tiếp trên Client.
// ==============================================================================
app.get("/api/player", (req, res) => {
    let { url, kid, key, name, fallback } = req.query;
    const hostUrl = getHostUrl(req);

    // Catalog of verified ClearKey DRM keys for instant automatic lookup
    const KNOWN_CLEARKEYS = {
        "hbo": { kid: "09ddfe3d63863cafaeb79d0546b098ab", key: "3de0f38dcf014827dfd5bec38743c6a2", name: "HBO HD (Vietsub)" },
        "wtv": { kid: "086d09a40bff3a00aa6dd4dbaf9c13b2", key: "34f1908cfe2e05ee060046d40f14aec9", name: "Warner TV HD (WBtv)" },
        "warner": { kid: "086d09a40bff3a00aa6dd4dbaf9c13b2", key: "34f1908cfe2e05ee060046d40f14aec9", name: "Warner TV HD (WBtv)" },
        "max": { kid: "acb4c23471063327adc732e283c0847f", key: "e9868f5f473d0fd8699ede48d531c2b0", name: "Cinemax HD (Vietsub)" },
        "cinemax": { kid: "acb4c23471063327adc732e283c0847f", key: "e9868f5f473d0fd8699ede48d531c2b0", name: "Cinemax HD (Vietsub)" },
        "cn": { kid: "3c20166660a93a75ac77db81567389f7", key: "3cc1add43aecce3fe31c9c6a2a5b8c21", name: "Cartoon Network HD" },
        "cartoon": { kid: "3c20166660a93a75ac77db81567389f7", key: "3cc1add43aecce3fe31c9c6a2a5b8c21", name: "Cartoon Network HD" },
        "dreamwork": { kid: "67dae20527c63dadaaae609aa91577cb", key: "59328f621d56767bc5ff9404a8940683", name: "DreamWorks HD" },
        "cbb": { kid: "cca73a006b4b39a595207ceb5ed9ca0a", key: "b833d1f40c261ef78896f97e06f80cdc", name: "BBC CBeebies HD" },
        "cbeebies": { kid: "cca73a006b4b39a595207ceb5ed9ca0a", key: "b833d1f40c261ef78896f97e06f80cdc", name: "BBC CBeebies HD" },
        "axn": { kid: "9d29f87efdec3c9fab368f724a62ad0e", key: "6f1c09c035eab36323d60d1454db3d20", name: "AXN HD" },
        "cinemaworld": { kid: "ee7915564d7439d09bd3556ffccc87a4", key: "b35e12a75a42a6f9184723a90ff42d9c", name: "CinemaWorld HD" },
        "dscasia": { kid: "934907b134be3963a6263a453846924c", key: "788e2835fb98568aed2f47bbdc091515", name: "Discovery Asia HD" },
        "dsc": { kid: "eb4160ea553a321d899553e4e796fec2", key: "bea5a07157e0c4d17b11ab399517f952", name: "Discovery Channel HD" },
        "ap": { kid: "ec6f072c7125377a9bc0ae61598095f4", key: "1d5388e0781415ebcec9914f5ad75875", name: "Animal Planet HD" },
        "bbcearth": { kid: "5014941a2c42379880b5edf72304c165", key: "f3fa0fe3cd39a52f4eefd36ff7161e89", name: "BBC Earth HD" },
        "bbclifestyle": { kid: "58b949986ed13294bc01b0f330abc527", key: "23e8c5f2fe202906ac2d6554d9527299", name: "BBC Lifestyle HD" },
        "bbcworldnews": { kid: "c7ba46086dda345a929e29bf155e459c", key: "d374b8f39904bf572689ea347ae86591", name: "BBC News HD" },
        "bloomberg": { kid: "1071393f8fc237f3a9a28028142110f7", key: "7a0f8c3c72e0ffff811d534c929c57c2", name: "Bloomberg TV HD" },
        "cnn": { kid: "714cc8ed05a03abb9ac61bd4bbd1d8a0", key: "1acf58ff8d4cd87c2d3c12d22248efb1", name: "CNN International HD" },
        "ftv": { kid: "c1d9f25701023508bfa6737e3a8c7001", key: "30c3613e9b06e0f7cc201014f31bf5d8", name: "Fashion TV HD" },
        "tlc": { kid: "b6908629732639ada4814a6208296d9c", key: "7ca9bf03623f77b5e2f16df0b53f274d", name: "TLC HD" },
        "boomerang": { kid: "b1f0d759e914369db388b3b0dc815971", key: "5678d317e17007a88a9b9539e4526512", name: "Cartoonito / Boomerang" },
        "dmax": { kid: "53b26f904ae03a20b56477cfb9c5dca2", key: "0c64ccfb978e7390bd33344075492aec", name: "DMAX HD" }
    };

    // Auto-resolve ClearKey credentials if missing
    if (!kid || !key) {
        const u = (url || "").toLowerCase();
        const n = (name || "").toLowerCase();
        for (const [k, v] of Object.entries(KNOWN_CLEARKEYS)) {
            if (u.includes(`/${k}.smil`) || u.includes(`/${k}/`) || u.includes(k) || n.includes(k)) {
                kid = v.kid;
                key = v.key;
                if (!name) name = v.name;
                break;
            }
        }
    }

    let effectiveStreamUrl = (url || "")
        .replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn")
        .replace("vips-livecdn.fptplay.net", "live.fptplay53.net")
        .replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i, `${hostUrl}/`);

    // If URL was wrapped in /proxy/dash/<b64>/manifest.mpd, extract direct CDN URL as primary and keep proxy as fallback
    let computedFallbackUrl = fallback || "";
    const dashMatch = effectiveStreamUrl.match(/\/proxy\/dash\/([^/]+)\/(.+)$/);
    if (dashMatch) {
        try {
            const baseDir = Buffer.from(dashMatch[1], "base64url").toString("utf8");
            if (baseDir.startsWith("http")) {
                computedFallbackUrl = effectiveStreamUrl;
                effectiveStreamUrl = `${baseDir}${dashMatch[2]}`.replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn");
            }
        } catch (_) {}
    } else if (effectiveStreamUrl.includes(".mpd") && !computedFallbackUrl) {
        const baseTarget = effectiveStreamUrl.substring(0, effectiveStreamUrl.lastIndexOf("/") + 1);
        const b64 = Buffer.from(baseTarget).toString("base64url");
        computedFallbackUrl = `${hostUrl}/proxy/dash/${b64}/manifest.mpd`;
    }

    const channelTitle = name || "Truyền Hình Quốc Tế";
    const fallbackStreamUrl = computedFallbackUrl;
    let channelId = req.query.channelId || req.query.id || "";
    let backupStreams = [];

    try {
        const liveFile = path.join(__dirname, "../live_channels.json");
        if (fs.existsSync(liveFile)) {
            const list = JSON.parse(fs.readFileSync(liveFile, "utf-8"));
            const matched = list.find(c => (channelId && c.id === channelId) || (url && c.streamUrl === url) || (name && c.name && c.name.toLowerCase() === name.toLowerCase()));
            if (matched) {
                if (!channelId) channelId = matched.id;
                if (Array.isArray(matched.backupStreams)) backupStreams = matched.backupStreams;
                if (!kid && matched.kidHex) kid = matched.kidHex;
                if (!key && matched.keyHex) key = matched.keyHex;
            }
        }
    } catch (_) {}
    
    const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>${channelTitle} - TUNGNUI PRO ULTRA CINEMA PLAYER</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.3.5/shaka-player.ui.min.js"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.3.5/controls.min.css">
        <style>
            :root {
                --primary: #38bdf8;
                --primary-glow: rgba(56, 189, 248, 0.4);
                --bg-glass: rgba(15, 23, 42, 0.88);
                --border-glass: rgba(255, 255, 255, 0.12);
            }
            * { box-sizing: border-box; }
            body, html { margin: 0; padding: 0; width: 100%; height: 100%; background-color: #030712; overflow: hidden; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
            
            .player-wrapper { width: 100vw; height: 100vh; position: relative; background: #030712; display: flex; align-items: center; justify-content: center; overflow: hidden; }
            
            /* DYNAMIC AMBIENT LIGHT CANVAS (HÀO QUANG ĐIỆN ẢNH YOUTUBE / APPLE TV) */
            .ambient-canvas {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) scale(1.18);
                width: 100vw;
                height: 100vh;
                z-index: 1;
                filter: blur(65px) brightness(1.3) saturate(1.45);
                opacity: 0.85;
                transition: opacity 0.5s ease;
                pointer-events: none;
            }
            .ambient-canvas.disabled { opacity: 0 !important; }

            /* VIDEO ELEMENT & TRANSITION */
            video {
                width: 100%;
                height: 100%;
                outline: none;
                object-fit: contain;
                z-index: 2;
                position: relative;
                transition: object-fit 0.2s ease, transform 0.2s ease;
            }
            
            /* LOADING BOX */
            .loading-box {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 20;
                text-align: center;
                background: rgba(10, 15, 30, 0.94);
                padding: 24px 34px;
                border-radius: 20px;
                border: 1px solid rgba(56, 189, 248, 0.4);
                box-shadow: 0 20px 60px rgba(0,0,0,0.9);
                backdrop-filter: blur(16px);
                max-width: 88vw;
            }
            .loading-spinner {
                width: 42px;
                height: 42px;
                border: 3px solid rgba(56, 189, 248, 0.2);
                border-top-color: #38bdf8;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin: 0 auto 14px;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            .loading-text { color: #f8fafc; font-size: 15px; font-weight: 700; margin-bottom: 4px; }
            .loading-subtext { color: #94a3b8; font-size: 12px; }

            /* FLOATING UNMUTE BANNER (KHI BỊ BROWSER POLICY CHẶN SOUND) */
            .unmute-banner {
                position: absolute;
                top: 76px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 35;
                background: linear-gradient(135deg, #ef4444, #f97316);
                color: #ffffff;
                font-size: 13px;
                font-weight: 800;
                padding: 10px 22px;
                border-radius: 30px;
                box-shadow: 0 10px 30px rgba(239, 68, 68, 0.6);
                cursor: pointer;
                display: none;
                align-items: center;
                gap: 8px;
                animation: pulse-bounce 1.5s infinite;
                user-select: none;
            }
            @keyframes pulse-bounce {
                0%, 100% { transform: translateX(-50%) scale(1); }
                50% { transform: translateX(-50%) scale(1.05); }
            }

            /* TOP BAR */
            .top-bar {
                position: absolute;
                top: 14px;
                left: 16px;
                right: 16px;
                z-index: 25;
                display: flex;
                align-items: center;
                justify-content: space-between;
                pointer-events: none;
                transition: opacity 0.3s ease, transform 0.3s ease;
            }
            .top-bar > * { pointer-events: auto; }
            .top-left { display: flex; align-items: center; gap: 10px; }
            .badge-live { background: #ef4444; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.5px; animation: pulse 2s infinite; }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
            .ch-title { color: #f8fafc; font-size: 15px; font-weight: 800; text-shadow: 0 2px 10px rgba(0,0,0,0.9); }
            
            .top-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .tool-chip {
                background: var(--bg-glass);
                color: #cbd5e1;
                font-size: 11.5px;
                font-weight: 600;
                padding: 6px 12px;
                border-radius: 12px;
                border: 1px solid var(--border-glass);
                backdrop-filter: blur(12px);
                cursor: pointer;
                user-select: none;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .tool-chip:hover { background: rgba(56, 189, 248, 0.2); border-color: var(--primary); color: #fff; transform: translateY(-1px); }
            .tool-chip.active { background: linear-gradient(135deg, #0284c7, #38bdf8); color: #fff; border-color: transparent; }

            /* 🌟 BOTTOM CONTROL BAR (HIỂN THỊ ĐẦY ĐỦ CÁC NÚT ĐIỀU KHIỂN) */
            .control-bar {
                position: absolute;
                bottom: 16px;
                left: 16px;
                right: 16px;
                z-index: 25;
                background: var(--bg-glass);
                border: 1px solid var(--border-glass);
                backdrop-filter: blur(20px);
                padding: 10px 16px;
                border-radius: 18px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                box-shadow: 0 16px 40px rgba(0,0,0,0.8);
                transition: opacity 0.35s ease, transform 0.35s ease;
            }
            .control-bar.autohide {
                opacity: 0;
                transform: translateY(20px);
                pointer-events: none;
            }
            .top-bar.autohide {
                opacity: 0;
                transform: translateY(-20px);
                pointer-events: none;
            }

            .control-group-left { display: flex; align-items: center; gap: 10px; }
            .control-group-right { display: flex; align-items: center; gap: 8px; }

            .ctrl-btn {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid var(--border-glass);
                color: #f8fafc;
                font-size: 12px;
                font-weight: 700;
                padding: 7px 12px;
                border-radius: 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
                user-select: none;
            }
            .ctrl-btn:hover { background: rgba(56, 189, 248, 0.25); border-color: var(--primary); color: #38bdf8; }
            .ctrl-btn.active { background: #0284c7; color: white; border-color: transparent; }
            .ctrl-btn-icon { font-size: 15px; }

            /* VOLUME SLIDER GROUP */
            .volume-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(255, 255, 255, 0.05);
                padding: 4px 10px;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.08);
            }
            .volume-slider {
                -webkit-appearance: none;
                width: 75px;
                height: 4px;
                background: rgba(255,255,255,0.25);
                border-radius: 2px;
                outline: none;
                cursor: pointer;
            }
            .volume-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 13px;
                height: 13px;
                background: #38bdf8;
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 0 8px rgba(56, 189, 248, 0.8);
            }
            .vol-text { font-size: 11px; font-weight: 700; color: #94a3b8; min-width: 32px; }

            /* POPUP MENU CHO THU PHÓNG & CHẤT LƯỢNG */
            .popup-menu {
                position: absolute;
                bottom: 64px;
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid rgba(56, 189, 248, 0.35);
                border-radius: 14px;
                padding: 6px;
                min-width: 180px;
                box-shadow: 0 16px 45px rgba(0,0,0,0.9);
                backdrop-filter: blur(20px);
                display: none;
                flex-direction: column;
                gap: 4px;
                z-index: 40;
            }
            .popup-menu.show { display: flex; }
            .popup-item {
                background: transparent;
                border: none;
                color: #e2e8f0;
                font-size: 11.5px;
                font-weight: 600;
                padding: 8px 12px;
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                text-align: left;
                transition: background 0.15s;
            }
            .popup-item:hover { background: rgba(56, 189, 248, 0.2); color: #fff; }
            .popup-item.active { background: rgba(56, 189, 248, 0.25); color: #38bdf8; font-weight: 800; }

            /* MODAL TRÌNH PHÁT BÊN NGOÀI & REMOTE */
            .custom-modal {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 50;
                background: rgba(15, 23, 42, 0.97);
                color: #f1f5f9;
                padding: 24px 28px;
                border-radius: 20px;
                border: 1px solid rgba(56, 189, 248, 0.4);
                box-shadow: 0 25px 75px rgba(0,0,0,0.95);
                backdrop-filter: blur(24px);
                max-width: 440px;
                width: 92vw;
                display: none;
            }
            .custom-modal.show { display: block; }
            .custom-modal-title { font-size: 15px; font-weight: 800; color: #38bdf8; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
            
            .ext-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
            .ext-btn {
                background: rgba(30, 41, 59, 0.85);
                border: 1px solid rgba(255,255,255,0.1);
                color: #f8fafc;
                font-size: 12px;
                font-weight: 700;
                padding: 10px 12px;
                border-radius: 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
            }
            .ext-btn:hover { background: rgba(56, 189, 248, 0.25); border-color: #38bdf8; transform: translateY(-2px); }

            /* OSD BOX */
            .osd-box {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) scale(0.9);
                z-index: 30;
                background: rgba(15, 23, 42, 0.94);
                color: #f8fafc;
                padding: 16px 26px;
                border-radius: 16px;
                border: 1px solid rgba(56, 189, 248, 0.4);
                box-shadow: 0 20px 60px rgba(0,0,0,0.85);
                backdrop-filter: blur(16px);
                font-size: 15px;
                font-weight: 700;
                text-align: center;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.25s ease, transform 0.25s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                min-width: 140px;
            }
            .osd-box.visible { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            .osd-progress { width: 120px; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden; margin-top: 4px; }
            .osd-progress-bar { height: 100%; background: #38bdf8; width: 50%; transition: width 0.1s linear; }

            /* INFO HUD (PHÍM I) */
            .info-hud {
                position: absolute;
                bottom: 80px;
                left: 20px;
                z-index: 25;
                background: rgba(10, 15, 30, 0.9);
                color: #e2e8f0;
                padding: 12px 18px;
                border-radius: 14px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                font-family: monospace;
                font-size: 11px;
                line-height: 1.6;
                backdrop-filter: blur(12px);
                display: none;
                pointer-events: none;
            }
            .info-hud.show { display: block; }
            .info-hud-row { display: flex; justify-content: space-between; gap: 16px; }
            .info-hud-label { color: #94a3b8; }
            .info-hud-val { color: #38bdf8; font-weight: 700; }

            .remote-table { width: 100%; font-size: 11.5px; border-collapse: collapse; }
            .remote-table td { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .remote-key { background: rgba(255,255,255,0.12); padding: 3px 8px; border-radius: 6px; font-weight: 700; color: #fef08a; font-family: monospace; }

            @media (max-width: 768px) {
                .hide-mobile { display: none !important; }
                .ctrl-btn { padding: 6px 8px; font-size: 11px; }
                .volume-slider { width: 50px; }
                .ch-title { font-size: 13px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            }
        </style>
    </head>
    <body>
        <div class="player-wrapper" id="playerWrap">
            <!-- CANVAS HÀO QUANG ĐIỆN ẢNH (DYNAMIC AMBIENT LIGHT) -->
            <canvas id="ambientCanvas" class="ambient-canvas"></canvas>
            
            <!-- VIDEO PHÁT CHÍNH -->
            <video id="video" autoplay playsinline></video>

            <!-- 🌟 BANNER TỰ ĐỘNG BẬT ÂM THANH KHI BROWSER CHẶN SOUND -->
            <div id="unmuteBanner" class="unmute-banner" onclick="forceUnmuteAudio()">
                <span>🔊</span>
                <span>CHẠM VÀO MÀN HÌNH ĐỂ BẬT ÂM THANH</span>
            </div>

            <!-- TOP BAR -->
            <div class="top-bar" id="topBar">
                <div class="top-left">
                    <span class="badge-live">LIVE</span>
                    <span class="ch-title">${channelTitle}</span>
                </div>
                <div class="top-right">
                    <div class="tool-chip active" id="btnAmbient" onclick="toggleAmbient()" title="Hào quang điện ảnh (Phím A)">
                        <span>✨</span>
                        <span id="ambientText" class="hide-mobile">Ambient On</span>
                    </div>
                    <div class="tool-chip" id="btnPip" onclick="togglePip()" title="Chế độ hình trong hình (Phím P)">
                        <span>🗗</span>
                        <span class="hide-mobile">PiP</span>
                    </div>
                    <div class="tool-chip" id="btnInfo" onclick="toggleInfoHud()" title="Bảng thông số kỹ thuật (Phím I)">
                        <span>ℹ️</span>
                        <span class="hide-mobile">Thông Số</span>
                    </div>
                    <div class="tool-chip" onclick="toggleRemoteModal()" title="Điều khiển TV / D-Pad (Phím H)">
                        <span>🎮</span>
                        <span class="hide-mobile">Remote TV</span>
                    </div>
                    <div class="tool-chip" id="statusBadge" style="cursor:default;">ClearKey DRM Active 🟢</div>
                </div>
            </div>

            <!-- 🌟 FLOATING BOTTOM CONTROL BAR (CÁC NÚT ĐIỀU KHIỂN HIỂN THỊ TRỞ LẠI) -->
            <div class="control-bar" id="controlBar">
                <!-- NHÓM BÊN TRÁI: PLAY/PAUSE, ÂM LƯỢNG -->
                <div class="control-group-left">
                    <button type="button" class="ctrl-btn" id="btnPlayPause" onclick="togglePlayPause()" title="Phát / Dừng (Space/Enter)">
                        <span class="ctrl-btn-icon" id="playIcon">⏸</span>
                    </button>
                    
                    <!-- ĐIỀU KHIỂN ÂM LƯỢNG & TỰ ĐỘNG BẬT TIẾNG -->
                    <div class="volume-wrap">
                        <button type="button" class="ctrl-btn" id="btnMute" style="padding:4px;border:none;background:transparent;" onclick="toggleMute()" title="Bật/Tắt tiếng (Phím M)">
                            <span class="ctrl-btn-icon" id="muteIcon">🔊</span>
                        </button>
                        <input type="range" class="volume-slider" id="volSlider" min="0" max="100" value="100" oninput="onVolumeChange(this.value)">
                        <span class="vol-text hide-mobile" id="volText">100%</span>
                    </div>
                </div>

                <!-- NHÓM BÊN PHẢI: THU PHÓNG, CHẤT LƯỢNG, XOAY NGANG, TRÌNH PHÁT NGOÀI, TOÀN MÀN HÌNH -->
                <div class="control-group-right">
                    <!-- 1. NÚT THU PHÓNG MÀN HÌNH (ASPECT RATIO / ZOOM) -->
                    <div style="position:relative;">
                        <button type="button" class="ctrl-btn" id="btnAspect" onclick="toggleAspectMenu(event)" title="Thay đổi kích thước thu phóng màn hình (Phím Z)">
                            <span class="ctrl-btn-icon">📐</span>
                            <span id="aspectLabel">Thu Phóng</span>
                            <span>▾</span>
                        </button>
                        <!-- MENU LỰA CHỌN THU PHÓNG -->
                        <div class="popup-menu" id="menuAspect">
                            <button type="button" class="popup-item active" id="asp-contain" onclick="setAspectRatioMode('contain')">
                                <span>🔲 Vừa Vặn (Contain)</span>
                                <span class="check-mark">✓</span>
                            </button>
                            <button type="button" class="popup-item" id="asp-cover" onclick="setAspectRatioMode('cover')">
                                <span>🔳 Tràn Viền (Cover)</span>
                                <span class="check-mark"></span>
                            </button>
                            <button type="button" class="popup-item" id="asp-fill" onclick="setAspectRatioMode('fill')">
                                <span>↔️ Kéo Giãn (Stretch)</span>
                                <span class="check-mark"></span>
                            </button>
                            <button type="button" class="popup-item" id="asp-16-9" onclick="setAspectRatioMode('16-9')">
                                <span>📺 Chuẩn 16:9</span>
                                <span class="check-mark"></span>
                            </button>
                            <button type="button" class="popup-item" id="asp-4-3" onclick="setAspectRatioMode('4-3')">
                                <span>📻 Cổ Điển 4:3</span>
                                <span class="check-mark"></span>
                            </button>
                        </div>
                    </div>

                    <!-- 2. NÚT CHỌN CHẤT LƯỢNG HÌNH ẢNH (TỰ ĐỘNG CHỌN CAO NHẤT) -->
                    <div style="position:relative;">
                        <button type="button" class="ctrl-btn" id="btnQuality" onclick="toggleQualityMenu(event)" title="Chọn chất lượng hình ảnh (Phím Q)">
                            <span class="ctrl-btn-icon">💎</span>
                            <span id="qualityLabel">1080p FHD</span>
                            <span>▾</span>
                        </button>
                        <!-- MENU LỰA CHỌN CHẤT LƯỢNG HÌNH ẢNH -->
                        <div class="popup-menu" id="menuQuality">
                            <button type="button" class="popup-item active" id="q-highest" onclick="selectQualityOption('highest')">
                                <span>💎 Cao Nhất (Highest FHD)</span>
                                <span class="check-mark">✓</span>
                            </button>
                            <button type="button" class="popup-item" id="q-1080" onclick="selectQualityOption(1080)">
                                <span>🌟 1080p (Full HD)</span>
                                <span class="check-mark"></span>
                            </button>
                            <button type="button" class="popup-item" id="q-720" onclick="selectQualityOption(720)">
                                <span>📺 720p (HD)</span>
                                <span class="check-mark"></span>
                            </button>
                            <button type="button" class="popup-item" id="q-480" onclick="selectQualityOption(480)">
                                <span>📱 480p (Tiết kiệm)</span>
                                <span class="check-mark"></span>
                            </button>
                            <button type="button" class="popup-item" id="q-auto" onclick="selectQualityOption('auto')">
                                <span>⚡ Tự Động (Auto ABR)</span>
                                <span class="check-mark"></span>
                            </button>
                        </div>
                    </div>

                    <!-- 3. XOAY NGANG MÀN HÌNH (DÀNH CHO ĐIỆN THOẠI MÀN HÌNH DỌC) -->
                    <button type="button" class="ctrl-btn" id="btnRotate" onclick="toggleRotateLandscape()" title="Tự động / Xoay ngang màn hình (Phím R)">
                        <span class="ctrl-btn-icon">🔄</span>
                        <span class="hide-mobile">Xoay Ngang</span>
                    </button>

                    <!-- 4. CHỌN TRÌNH PHÁT BÊN NGOÀI (VLC, MX PLAYER, POTPLAYER, MPV) -->
                    <button type="button" class="ctrl-btn" id="btnExtPlayer" onclick="openExternalPlayerModal()" title="Mở bằng VLC, MX Player, PotPlayer, MPV...">
                        <span class="ctrl-btn-icon">🚀</span>
                        <span class="hide-mobile">App Ngoài</span>
                    </button>

                    <!-- 5. TOÀN MÀN HÌNH -->
                    <button type="button" class="ctrl-btn" id="btnFullscreen" onclick="toggleFullscreen()" title="Toàn màn hình (Phím F/Enter)">
                        <span class="ctrl-btn-icon" id="fsIcon">⛶</span>
                    </button>
                </div>
            </div>

            <!-- MODAL CHỌN TRÌNH PHÁT BÊN NGOÀI (EXTERNAL PLAYERS MODAL) -->
            <div id="modalExternal" class="custom-modal">
                <div class="custom-modal-title">
                    <span>🚀 CHỌN TRÌNH PHÁT BÊN NGOÀI</span>
                    <span style="cursor:pointer;" onclick="closeExternalPlayerModal()">✕</span>
                </div>
                <p style="font-size:11.5px;color:#94a3b8;margin:0 0 12px 0;">
                    Chuyển mạch luồng trực tiếp sang các ứng dụng giải mã chuyên dụng cao cấp:
                </p>
                <div class="ext-grid">
                    <button type="button" class="ext-btn" onclick="openExternalApp('vlc')">
                        <span style="font-size:18px;">🟠</span>
                        <span>VLC Player</span>
                    </button>
                    <button type="button" class="ext-btn" onclick="openExternalApp('mx')">
                        <span style="font-size:18px;">🟢</span>
                        <span>MX Player (Android)</span>
                    </button>
                    <button type="button" class="ext-btn" onclick="openExternalApp('potplayer')">
                        <span style="font-size:18px;">🟣</span>
                        <span>PotPlayer (PC)</span>
                    </button>
                    <button type="button" class="ext-btn" onclick="openExternalApp('mpv')">
                        <span style="font-size:18px;">⚪</span>
                        <span>MPV Player</span>
                    </button>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button type="button" class="ext-btn" style="justify-content:center;background:rgba(56,189,248,0.15);border-color:#38bdf8;color:#38bdf8;" onclick="openExternalApp('copy_url')">
                        <span>📋 Sao Chép Link Stream (.mpd / .m3u8)</span>
                    </button>
                    <button type="button" class="ext-btn" style="justify-content:center;" onclick="openExternalApp('copy_drm')">
                        <span>🔑 Sao Chép Khóa ClearKey (KID : KEY)</span>
                    </button>
                </div>
            </div>

            <!-- LOADING BOX -->
            <div id="loadingBox" class="loading-box">
                <div class="loading-spinner" id="spinner"></div>
                <div id="loading" class="loading-text">🔄 Khởi chạy Stream Proxy & Tối Ưu Hóa Bộ Đệm...</div>
                <div class="loading-subtext" id="loadSubtext">Đang nạp MPEG-DASH / ClearKey chống đen màn hình</div>
            </div>

            <!-- D-PAD OSD OVERLAY -->
            <div id="osdBox" class="osd-box">
                <div id="osdIcon" style="font-size:26px;">🔊</div>
                <div id="osdText">Âm lượng: 100%</div>
                <div class="osd-progress" id="osdProgress">
                    <div class="osd-progress-bar" id="osdBar"></div>
                </div>
            </div>

            <!-- STREAM INFO HUD (PHÍM I) -->
            <div id="infoHud" class="info-hud">
                <div style="font-weight:bold;color:#fef08a;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:3px;">
                    📊 THÔNG SỐ TRUYỀN PHÁT (TUNGNUI PRO ULTRA 5.0)
                </div>
                <div class="info-hud-row"><span class="info-hud-label">Kênh:</span><span class="info-hud-val">${channelTitle}</span></div>
                <div class="info-hud-row"><span class="info-hud-label">Độ phân giải:</span><span class="info-hud-val" id="hudRes">1920x1080 (FHD)</span></div>
                <div class="info-hud-row"><span class="info-hud-label">Băng thông:</span><span class="info-hud-val" id="hudBitrate">-- kbps</span></div>
                <div class="info-hud-row"><span class="info-hud-label">Bộ đệm (Buffer):</span><span class="info-hud-val" id="hudBuffer">-- s</span></div>
                <div class="info-hud-row"><span class="info-hud-label">Chất Lượng:</span><span class="info-hud-val" id="hudQualityTrack">Cao Nhất (Tự Động)</span></div>
                <div class="info-hud-row"><span class="info-hud-label">DRM Scheme:</span><span class="info-hud-val" id="hudDrm">ClearKey W3C</span></div>
                <div class="info-hud-row"><span class="info-hud-label">Tự Hồi Phục:</span><span class="info-hud-val" style="color:#10b981;">Bảo Vệ Hoạt Động 🟢</span></div>
            </div>

            <!-- TV REMOTE SHORTCUTS MODAL -->
            <div id="remoteModal" class="custom-modal">
                <div class="custom-modal-title">
                    <span>🎮 ĐIỀU HƯỚNG D-PAD & BÀN PHÍM TV</span>
                    <span style="cursor:pointer;" onclick="toggleRemoteModal()">✕</span>
                </div>
                <table class="remote-table">
                    <tr><td><span class="remote-key">OK / Space</span></td><td>Tạm dừng / Phát tiếp</td></tr>
                    <tr><td><span class="remote-key">▲ / ▼</span></td><td>Tăng / Giảm âm lượng 5%</td></tr>
                    <tr><td><span class="remote-key">◀ / ▶</span></td><td>Tua lùi / Tua tiến 10 giây</td></tr>
                    <tr><td><span class="remote-key">Z</span></td><td>Đổi chế độ Thu Phóng màn hình</td></tr>
                    <tr><td><span class="remote-key">Q</span></td><td>Chọn chất lượng hình ảnh</td></tr>
                    <tr><td><span class="remote-key">R</span></td><td>Xoay ngang màn hình (Landscape)</td></tr>
                    <tr><td><span class="remote-key">F / Enter</span></td><td>Toàn màn hình (Fullscreen TV)</td></tr>
                    <tr><td><span class="remote-key">M</span></td><td>Bật / Tắt tiếng (Mute toggle)</td></tr>
                    <tr><td><span class="remote-key">A</span></td><td>Bật / Tắt hào quang điện ảnh (Ambient)</td></tr>
                    <tr><td><span class="remote-key">P</span></td><td>Bật chế độ Hình trong hình (PiP)</td></tr>
                    <tr><td><span class="remote-key">I</span></td><td>Bảng thông số kỹ thuật (HUD)</td></tr>
                </table>
                <div style="margin-top:14px;text-align:right;">
                    <button type="button" onclick="toggleRemoteModal()" style="padding:6px 14px;background:#38bdf8;color:#000;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:11px;">Đã Hiểu</button>
                </div>
            </div>
        </div>

        <script>
            var shakaPlayerInstance = null;
            var isAmbientActive = localStorage.getItem('tungnui_ambient') !== 'false';
            var osdTimeout = null;
            var hideControlsTimeout = null;
            var stallRecoveryTimeout = null;
            var stallCount = 0;
            var rawStreamUrl = '${effectiveStreamUrl}';
            var fallbackUrl = '${fallbackStreamUrl}';
            var kidHex = '${kid || ""}';
            var keyHex = '${key || ""}';
            var channelName = '${channelTitle}';
            var channelId = '${channelId || ""}';
            var backupUrls = ${JSON.stringify(backupStreams)};
            var smartFailoverInstance = null;

            // SMART FAILOVER & PROXY PLAYER CONTROLLER
            class SmartFailoverPlayer {
                constructor(playerInstance, videoEl, options) {
                    this.player = playerInstance;
                    this.video = videoEl;
                    this.primaryUrl = options.primaryUrl;
                    this.backupUrls = options.backupUrls || [];
                    this.currentUrl = this.primaryUrl;
                    this.proxyAttempted = false;
                    this.backupIndex = 0;
                    this.channelId = options.channelId || '';
                    this.channelName = options.channelName || '';
                }

                getProxyUrl(rawUrl) {
                    return '/api/stream-proxy?url=' + encodeURIComponent(rawUrl) + '&ua=Dalvik%2F2.1.0';
                }

                async attemptAutoFailover(reason) {
                    console.warn('[SmartFailover] Kích hoạt failover:', reason, 'URL hiện tại:', this.currentUrl);

                    // 1. Thử bọc qua CORS & Header Proxy nếu URL chưa qua proxy
                    if (!this.proxyAttempted && !this.currentUrl.includes('/api/stream-proxy') && !this.currentUrl.includes('/proxy/')) {
                        this.proxyAttempted = true;
                        var proxied = this.getProxyUrl(this.currentUrl);
                        showOsd('🛡️', 'CORS / Mạng: Đổi sang Header Proxy...');
                        try {
                            await this.player.load(proxied);
                            showOsd('✅', 'Phát thành công qua CORS Proxy 🟢');
                            return true;
                        } catch(proxyErr) {
                            console.warn('[SmartFailover] Proxy failed, tiếp tục sang backupStreams:', proxyErr);
                        }
                    }

                    // 2. Chuyển sang backup stream tiếp theo trong danh sách gom
                    if (this.backupIndex < this.backupUrls.length) {
                        var nextStream = this.backupUrls[this.backupIndex++];
                        this.currentUrl = nextStream;
                        this.proxyAttempted = false;
                        showOsd('⚡', 'Chuyển sang luồng dự phòng (' + this.backupIndex + '/' + this.backupUrls.length + ')...');

                        // Gửi báo lỗi cục bộ micro-healing về máy chủ
                        fetch('/api/stream-report', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                channelId: this.channelId,
                                streamUrl: this.primaryUrl,
                                error: reason
                            })
                        }).catch(function() {});

                        try {
                            await this.player.load(nextStream);
                            showOsd('🎉', 'Đã chuyển thành công luồng dự phòng 🟢');
                            return true;
                        } catch(backupErr) {
                            try {
                                var proxiedBackup = this.getProxyUrl(nextStream);
                                await this.player.load(proxiedBackup);
                                showOsd('🎉', 'Đã chuyển backup stream qua Proxy 🟢');
                                return true;
                            } catch(e2) {
                                return this.attemptAutoFailover('Backup load failed: ' + backupErr.message);
                            }
                        }
                    }

                    // 3. Fallback Url từ query
                    if (fallbackUrl && fallbackUrl !== this.primaryUrl && this.currentUrl !== fallbackUrl) {
                        this.currentUrl = fallbackUrl;
                        showOsd('⚡', 'Chuyển sang luồng Fallback...');
                        try {
                            await this.player.load(fallbackUrl);
                            return true;
                        } catch(e) {
                            this.video.src = fallbackUrl;
                            this.video.play().catch(function() {});
                            return true;
                        }
                    }

                    showOsd('❌', 'Không thể kết nối luồng phát');
                    return false;
                }
            }

            // 🌟 1. CÁC CHẾ ĐỘ THU PHÓNG MÀN HÌNH (ASPECT RATIO / ZOOM MODES)
            var ASPECT_MODES = [
                { id: 'contain', label: 'Vừa Vặn (Contain)', icon: '🔲', fit: 'contain' },
                { id: 'cover', label: 'Tràn Viền (Cover)', icon: '🔳', fit: 'cover' },
                { id: 'fill', label: 'Kéo Giãn (Stretch)', icon: '↔️', fit: 'fill' },
                { id: '16-9', label: 'Chuẩn 16:9', icon: '📺', fit: 'contain', aspect: '16/9' },
                { id: '4-3', label: 'Cổ Điển 4:3', icon: '📻', fit: 'contain', aspect: '4/3' }
            ];
            var currentAspectMode = localStorage.getItem('tungnui_player_aspect') || 'contain';

            function applyAspectRatio(modeId) {
                var video = document.getElementById('video');
                var label = document.getElementById('aspectLabel');
                var found = ASPECT_MODES.find(m => m.id === modeId) || ASPECT_MODES[0];
                currentAspectMode = found.id;
                localStorage.setItem('tungnui_player_aspect', currentAspectMode);

                if (video) {
                    video.style.objectFit = found.fit;
                    if (found.aspect) {
                        video.style.aspectRatio = found.aspect;
                        video.style.maxWidth = '100vw';
                        video.style.maxHeight = '100vh';
                    } else {
                        video.style.aspectRatio = 'auto';
                        video.style.width = '100%';
                        video.style.height = '100%';
                    }
                }
                if (label) label.innerText = found.icon + ' ' + found.label.split(' ')[0];

                // Cập nhật checkmark trong popup menu
                ASPECT_MODES.forEach(m => {
                    var el = document.getElementById('asp-' + m.id);
                    if (el) {
                        el.classList.toggle('active', m.id === currentAspectMode);
                        var check = el.querySelector('.check-mark');
                        if (check) check.innerText = (m.id === currentAspectMode) ? '✓' : '';
                    }
                });
                showOsd('📐', 'Thu phóng: ' + found.label);
            }

            function setAspectRatioMode(modeId) {
                applyAspectRatio(modeId);
                closeAspectMenu();
            }

            function cycleAspectRatio() {
                var curIdx = ASPECT_MODES.findIndex(m => m.id === currentAspectMode);
                var nextIdx = (curIdx + 1) % ASPECT_MODES.length;
                applyAspectRatio(ASPECT_MODES[nextIdx].id);
            }

            function toggleAspectMenu(e) {
                if (e) e.stopPropagation();
                closeQualityMenu();
                var menu = document.getElementById('menuAspect');
                if (menu) menu.classList.toggle('show');
            }

            function closeAspectMenu() {
                var menu = document.getElementById('menuAspect');
                if (menu) menu.classList.remove('show');
            }

            // 🌟 2. CHỌN CHẤT LƯỢNG HÌNH ẢNH & TỰ ĐỘNG CHỌN CAO NHẤT (AUTO HIGHEST QUALITY)
            function selectHighestQuality() {
                if (!shakaPlayerInstance) return;
                try {
                    var tracks = shakaPlayerInstance.getVariantTracks();
                    if (tracks && tracks.length > 0) {
                        // Sắp xếp tracks giảm dần theo chiều cao (resolution) và bandwidth
                        tracks.sort(function(a, b) {
                            var hDiff = (b.height || 0) - (a.height || 0);
                            if (hDiff !== 0) return hDiff;
                            return (b.bandwidth || 0) - (a.bandwidth || 0);
                        });
                        
                        // Tắt adaptive ABR tạm thời để lock track cao nhất
                        shakaPlayerInstance.configure({ abr: { enabled: false } });
                        var highestTrack = tracks[0];
                        shakaPlayerInstance.selectVariantTrack(highestTrack, false);
                        
                        var resStr = highestTrack.height ? (highestTrack.height + 'p ' + (highestTrack.height >= 1080 ? 'FHD' : 'HD')) : 'Cao Nhất';
                        var qEl = document.getElementById('qualityLabel');
                        if (qEl) qEl.innerText = resStr;
                        var hudQ = document.getElementById('hudQualityTrack');
                        if (hudQ) hudQ.innerText = resStr + ' (Đã chọn cao nhất)';

                        showOsd('💎', 'Tự động chọn chất lượng cao nhất: ' + resStr);
                    }
                } catch(e) {
                    console.warn('Lỗi chọn chất lượng cao nhất:', e);
                }
            }

            function selectQualityOption(target) {
                closeQualityMenu();
                if (!shakaPlayerInstance) return;
                try {
                    if (target === 'auto') {
                        shakaPlayerInstance.configure({ abr: { enabled: true } });
                        var qEl = document.getElementById('qualityLabel');
                        if (qEl) qEl.innerText = 'Tự Động (ABR)';
                        showOsd('⚡', 'Chất lượng: Thích ứng tự động (Auto ABR)');
                    } else if (target === 'highest') {
                        selectHighestQuality();
                    } else {
                        var targetHeight = parseInt(target, 10);
                        var tracks = shakaPlayerInstance.getVariantTracks();
                        var matched = tracks.filter(t => t.height && Math.abs(t.height - targetHeight) <= 100);
                        if (matched.length > 0) {
                            matched.sort((a,b) => (b.bandwidth || 0) - (a.bandwidth || 0));
                            shakaPlayerInstance.configure({ abr: { enabled: false } });
                            shakaPlayerInstance.selectVariantTrack(matched[0], true);
                            var qEl = document.getElementById('qualityLabel');
                            if (qEl) qEl.innerText = targetHeight + 'p';
                            showOsd('💎', 'Đã chuyển chất lượng: ' + targetHeight + 'p');
                        } else {
                            selectHighestQuality();
                        }
                    }
                } catch(e) {
                    console.warn('Lỗi chỉnh chất lượng:', e);
                }
            }

            function toggleQualityMenu(e) {
                if (e) e.stopPropagation();
                closeAspectMenu();
                var menu = document.getElementById('menuQuality');
                if (menu) menu.classList.toggle('show');
            }

            function closeQualityMenu() {
                var menu = document.getElementById('menuQuality');
                if (menu) menu.classList.remove('show');
            }

            // 🌟 3. TỰ ĐỘNG BẬT ÂM THANH (AUTO UNMUTE) & XỬ LÝ CHÍNH SÁCH BROWSER
            function attemptAutoUnmute() {
                var video = document.getElementById('video');
                var banner = document.getElementById('unmuteBanner');
                var volSlider = document.getElementById('volSlider');
                var volText = document.getElementById('volText');
                var muteIcon = document.getElementById('muteIcon');

                if (!video) return;

                video.volume = 1.0;
                video.muted = false;
                if (volSlider) volSlider.value = 100;
                if (volText) volText.innerText = '100%';
                if (muteIcon) muteIcon.innerText = '🔊';

                var playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(function() {
                        if (banner) banner.style.display = 'none';
                        showOsd('🔊', 'Âm lượng: 100%', 100);
                    }).catch(function(err) {
                        // Trình duyệt chặn autoplay có âm thanh -> Chạy muted để không gián đoạn hình ảnh
                        console.warn('Browser autoplay policy blocked unmuted sound:', err);
                        video.muted = true;
                        if (muteIcon) muteIcon.innerText = '🔇';
                        video.play().catch(function() {});
                        if (banner) banner.style.display = 'flex';
                    });
                }
            }

            function forceUnmuteAudio() {
                var video = document.getElementById('video');
                var banner = document.getElementById('unmuteBanner');
                var muteIcon = document.getElementById('muteIcon');
                var volSlider = document.getElementById('volSlider');
                var volText = document.getElementById('volText');

                if (video) {
                    video.muted = false;
                    video.volume = 1.0;
                    video.play().catch(function() {});
                    if (muteIcon) muteIcon.innerText = '🔊';
                    if (volSlider) volSlider.value = 100;
                    if (volText) volText.innerText = '100%';
                    showOsd('🔊', 'Đã bật âm thanh: 100%', 100);
                }
                if (banner) banner.style.display = 'none';
            }

            // 🌟 4. TỰ ĐỘNG XOAY NGANG MÀN HÌNH (AUTO ROTATE LANDSCAPE CHO MÀN HÌNH DỌC)
            function checkAutoRotateLandscape() {
                var isPortrait = window.innerHeight > window.innerWidth;
                var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
                if (isPortrait && isMobile) {
                    try {
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock('landscape').catch(function() {
                                console.log('Orientation lock waiting for user trigger');
                            });
                        }
                    } catch(e) {}
                }
            }

            function toggleRotateLandscape() {
                try {
                    if (screen.orientation && screen.orientation.lock) {
                        var current = screen.orientation.type || '';
                        if (current.includes('portrait')) {
                            screen.orientation.lock('landscape').then(function() {
                                showOsd('🔄', 'Đã xoay ngang màn hình');
                            }).catch(function() {
                                toggleFullscreen();
                            });
                        } else {
                            screen.orientation.unlock();
                            showOsd('🔄', 'Mở khóa hướng xoay');
                        }
                    } else {
                        toggleFullscreen();
                    }
                } catch(e) {
                    toggleFullscreen();
                }
            }

            // 🌟 5. TỰ ĐỘNG MỞ RỘNG FULL MÀN HÌNH CHO SMART TV / TVBOX
            function checkAutoFullscreenTv() {
                var isTv = /smart-tv|smarttv|googletv|appletv|android tv|tvbox|tizen|webos|crkey|mi box|firetv|roku|viera/i.test(navigator.userAgent) || 
                           window.location.search.includes('tv=1') || 
                           window.location.search.includes('fullscreen=1');
                if (isTv) {
                    setTimeout(function() {
                        if (!document.fullscreenElement) {
                            document.documentElement.requestFullscreen().catch(function() {});
                            showOsd('📺', 'Chế độ TV: Tự động toàn màn hình');
                        }
                    }, 1200);
                }
            }

            // 🌟 6. CHỌN TRÌNH PHÁT BÊN NGOÀI (EXTERNAL PLAYER SELECTOR)
            function openExternalPlayerModal() {
                var modal = document.getElementById('modalExternal');
                if (modal) modal.classList.add('show');
            }

            function closeExternalPlayerModal() {
                var modal = document.getElementById('modalExternal');
                if (modal) modal.classList.remove('show');
            }

            function copyTextToClipboard(text, name) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() {
                        showOsd('📋', 'Đã sao chép: ' + name);
                    }).catch(function() {
                        prompt('Sao chép liên kết:', text);
                    });
                } else {
                    prompt('Sao chép liên kết:', text);
                }
            }

            function openExternalApp(appType) {
                var rawStream = rawStreamUrl;
                var title = encodeURIComponent(channelName);
                var targetUrl = '';

                switch(appType) {
                    case 'vlc':
                        targetUrl = 'vlc://' + rawStream;
                        break;
                    case 'mx':
                        targetUrl = 'intent:' + rawStream + '#Intent;action=android.intent.action.VIEW;type=video/*;title=' + title + ';package=com.mxtech.videoplayer.ad;end';
                        break;
                    case 'potplayer':
                        targetUrl = 'potplayer://' + rawStream;
                        break;
                    case 'mpv':
                        targetUrl = 'mpv://' + rawStream;
                        break;
                    case 'copy_url':
                        copyTextToClipboard(rawStream, 'Link luồng stream');
                        closeExternalPlayerModal();
                        return;
                    case 'copy_drm':
                        var drmStr = 'KID: ' + (kidHex || 'N/A') + '\\nKEY: ' + (keyHex || 'N/A');
                        copyTextToClipboard(drmStr, 'Khóa DRM ClearKey');
                        closeExternalPlayerModal();
                        return;
                }

                if (targetUrl) {
                    showOsd('🚀', 'Đang chuyển sang ứng dụng...');
                    closeExternalPlayerModal();
                    window.location.href = targetUrl;
                }
            }

            // OSD & CONTROLS AUTO-HIDE
            function showOsd(icon, text, percent) {
                var osd = document.getElementById('osdBox');
                var osdIcon = document.getElementById('osdIcon');
                var osdText = document.getElementById('osdText');
                var osdProg = document.getElementById('osdProgress');
                var osdBar = document.getElementById('osdBar');

                if (!osd) return;
                osdIcon.innerText = icon;
                osdText.innerText = text;

                if (typeof percent === 'number') {
                    osdProg.style.display = 'block';
                    osdBar.style.width = Math.max(0, Math.min(100, percent)) + '%';
                } else {
                    osdProg.style.display = 'none';
                }

                osd.classList.add('visible');
                clearTimeout(osdTimeout);
                osdTimeout = setTimeout(function() {
                    osd.classList.remove('visible');
                }, 1400);
            }

            function resetControlsAutohide() {
                var topBar = document.getElementById('topBar');
                var controlBar = document.getElementById('controlBar');
                if (topBar) topBar.classList.remove('autohide');
                if (controlBar) controlBar.classList.remove('autohide');

                clearTimeout(hideControlsTimeout);
                hideControlsTimeout = setTimeout(function() {
                    var menuAsp = document.getElementById('menuAspect');
                    var menuQ = document.getElementById('menuQuality');
                    var modExt = document.getElementById('modalExternal');
                    var modRem = document.getElementById('remoteModal');

                    var isMenuOpen = (menuAsp && menuAsp.classList.contains('show')) ||
                                     (menuQ && menuQ.classList.contains('show')) ||
                                     (modExt && modExt.classList.contains('show')) ||
                                     (modRem && modRem.classList.contains('show'));

                    if (!isMenuOpen) {
                        if (topBar) topBar.classList.add('autohide');
                        if (controlBar) controlBar.classList.add('autohide');
                    }
                }, 3800);
            }

            document.addEventListener('mousemove', resetControlsAutohide);
            document.addEventListener('touchstart', resetControlsAutohide, { passive: true });
            document.addEventListener('click', function(e) {
                resetControlsAutohide();
                if (!e.target.closest('#btnAspect') && !e.target.closest('#menuAspect')) closeAspectMenu();
                if (!e.target.closest('#btnQuality') && !e.target.closest('#menuQuality')) closeQualityMenu();
            });

            // PLAY / PAUSE
            function togglePlayPause() {
                var video = document.getElementById('video');
                var icon = document.getElementById('playIcon');
                if (!video) return;
                if (video.paused) {
                    video.play();
                    if (icon) icon.innerText = '⏸';
                    showOsd('▶', 'Tiếp tục');
                } else {
                    video.pause();
                    if (icon) icon.innerText = '▶';
                    showOsd('⏸', 'Tạm dừng');
                }
            }

            // VOLUME CONTROLS
            function onVolumeChange(val) {
                var video = document.getElementById('video');
                var volText = document.getElementById('volText');
                var muteIcon = document.getElementById('muteIcon');
                var pct = parseInt(val, 10);
                if (video) {
                    video.muted = false;
                    video.volume = pct / 100;
                }
                if (volText) volText.innerText = pct + '%';
                if (muteIcon) muteIcon.innerText = pct === 0 ? '🔇' : (pct < 50 ? '🔉' : '🔊');
                showOsd(pct === 0 ? '🔇' : '🔊', 'Âm lượng: ' + pct + '%', pct);
            }

            function toggleMute() {
                var video = document.getElementById('video');
                var muteIcon = document.getElementById('muteIcon');
                var volSlider = document.getElementById('volSlider');
                if (!video) return;
                video.muted = !video.muted;
                if (muteIcon) muteIcon.innerText = video.muted ? '🔇' : '🔊';
                if (volSlider) volSlider.value = video.muted ? 0 : Math.round(video.volume * 100);
                showOsd(video.muted ? '🔇' : '🔊', video.muted ? 'Đã tắt tiếng' : 'Đã bật tiếng');
            }

            // FULLSCREEN
            function toggleFullscreen() {
                var fsIcon = document.getElementById('fsIcon');
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().then(function() {
                        if (fsIcon) fsIcon.innerText = '⛶';
                        showOsd('⛶', 'Toàn màn hình');
                        checkAutoRotateLandscape();
                    }).catch(function() {});
                } else {
                    document.exitFullscreen().then(function() {
                        if (fsIcon) fsIcon.innerText = '⛶';
                        showOsd('⛶', 'Thoát toàn màn hình');
                    }).catch(function() {});
                }
            }

            // AMBIENT GLOW
            function toggleAmbient() {
                isAmbientActive = !isAmbientActive;
                localStorage.setItem('tungnui_ambient', isAmbientActive ? 'true' : 'false');
                var canvas = document.getElementById('ambientCanvas');
                var btn = document.getElementById('btnAmbient');
                var txt = document.getElementById('ambientText');
                if (canvas) {
                    if (isAmbientActive) canvas.classList.remove('disabled');
                    else canvas.classList.add('disabled');
                }
                if (btn) btn.classList.toggle('active', isAmbientActive);
                if (txt) txt.innerText = isAmbientActive ? 'Ambient On' : 'Ambient Off';
                showOsd('✨', 'Ánh sáng môi trường: ' + (isAmbientActive ? 'BẬT' : 'TẮT'));
            }

            // PICTURE IN PICTURE
            async function togglePip() {
                var video = document.getElementById('video');
                try {
                    if (document.pictureInPictureElement) {
                        await document.exitPictureInPicture();
                        showOsd('🗗', 'Đã tắt PiP');
                    } else if (video && document.pictureInPictureEnabled) {
                        await video.requestPictureInPicture();
                        showOsd('🗗', 'Đã mở PiP');
                    }
                } catch(e) {
                    showOsd('⚠️', 'Trình duyệt không hỗ trợ PiP');
                }
            }

            // INFO HUD & REMOTE MODAL
            function toggleInfoHud() {
                var hud = document.getElementById('infoHud');
                var btn = document.getElementById('btnInfo');
                if (hud) {
                    hud.classList.toggle('show');
                    if (btn) btn.classList.toggle('active', hud.classList.contains('show'));
                }
            }

            function toggleRemoteModal() {
                var modal = document.getElementById('remoteModal');
                if (modal) modal.classList.toggle('show');
            }

            // KHỞI CHẠY TRÌNH PHÁT SIÊU CẤP SHAKA PLAYER
            async function initPlayer() {
                shaka.polyfill.installAll();
                const video = document.getElementById('video');
                const loadBox = document.getElementById('loadingBox');
                const loadText = document.getElementById('loading');
                const spinner = document.getElementById('spinner');
                const statusBadge = document.getElementById('statusBadge');
                const ambientCanvas = document.getElementById('ambientCanvas');
                const ambientCtx = ambientCanvas ? ambientCanvas.getContext('2d', { alpha: false, willReadFrequently: false }) : null;

                if (!shaka.Player.isBrowserSupported()) {
                    loadText.innerText = "❌ Trình duyệt không hỗ trợ Shaka Player!";
                    spinner.style.display = 'none';
                    return;
                }

                // Thiết lập canvas lấy mẫu màu nhẹ CPU
                if (ambientCanvas) {
                    ambientCanvas.width = 32;
                    ambientCanvas.height = 18;
                    if (!isAmbientActive) ambientCanvas.classList.add('disabled');
                }

                // Vòng lặp render hào quang điện ảnh
                var lastAmbientRender = 0;
                function renderAmbientFrame(timestamp) {
                    if (isAmbientActive && ambientCtx && video && !video.paused && !video.ended && video.readyState >= 2) {
                        if (timestamp - lastAmbientRender > 66) {
                            try {
                                ambientCtx.drawImage(video, 0, 0, 32, 18);
                            } catch(e) {}
                            lastAmbientRender = timestamp;
                        }
                    }
                    requestAnimationFrame(renderAmbientFrame);
                }
                requestAnimationFrame(renderAmbientFrame);

                // Áp dụng chế độ thu phóng đã lưu
                applyAspectRatio(currentAspectMode);

                const player = new shaka.Player(video);
                shakaPlayerInstance = player;
                smartFailoverInstance = new SmartFailoverPlayer(player, video, {
                    primaryUrl: rawStreamUrl,
                    backupUrls: backupUrls,
                    channelId: channelId,
                    channelName: channelName
                });

                // Cấu hình Shaka chống lỗi 4012 và đệm mượt
                const config = { 
                    streaming: { 
                        bufferingGoal: 20, 
                        rebufferingGoal: 4, 
                        retryParameters: { maxAttempts: 5, baseDelay: 1000, backoffFactor: 1.5 },
                        ignoreTextStreamFailures: true,
                        alwaysStreamText: false
                    },
                    manifest: {
                        dash: {
                            ignoreMinBufferTime: true
                        }
                    },
                    restrictions: {
                        minWidth: 0,
                        maxWidth: Infinity,
                        minHeight: 0,
                        maxHeight: Infinity,
                        minPixels: 0,
                        maxPixels: Infinity,
                        minFrameRate: 0,
                        maxFrameRate: Infinity,
                        minBandwidth: 0,
                        maxBandwidth: Infinity
                    }
                };

                // ClearKey DRM
                if (kidHex && keyHex) {
                    const cleanKid = kidHex.replace(/[-]/g, '').toLowerCase();
                    const cleanKey = keyHex.replace(/[-]/g, '').toLowerCase();
                    const clearKeysMap = { [cleanKid]: cleanKey };
                    if (cleanKid.length === 32) {
                        const dashed = cleanKid.slice(0,8)+'-'+cleanKid.slice(8,12)+'-'+cleanKid.slice(12,16)+'-'+cleanKid.slice(16,20)+'-'+cleanKid.slice(20);
                        clearKeysMap[dashed] = cleanKey;
                    }
                    config.drm = { clearKeys: clearKeysMap, preferredKeySystems: ['org.w3.clearkey'] };
                    statusBadge.innerText = "ClearKey DRM Đã Mở 🟢";
                }

                // Lọc bỏ Widevine/PlayReady tags để tránh lỗi 4012
                player.getNetworkingEngine().registerResponseFilter(function(type, response) {
                    if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
                        try {
                            let mpdStr = new TextDecoder('utf-8').decode(response.data);
                            mpdStr = mpdStr.replace(/<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*>[\\s\\S]*?<\\/ContentProtection>/gi, '');
                            mpdStr = mpdStr.replace(/<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*\\/>/gi, '');
                            mpdStr = mpdStr.replace(/<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*>[\\s\\S]*?<\\/ContentProtection>/gi, '');
                            mpdStr = mpdStr.replace(/<ContentProtection[^>]*9a04f079-9840-4286-ab92-e65be0885f95[^>]*\\/>/gi, '');
                            response.data = new TextEncoder().encode(mpdStr);
                        } catch(err) {}
                    }
                });

                player.configure(config);

                // TỰ ĐỘNG HỒI PHỤC KHI NGHẼN BỘ ĐỆM & SMART FAILOVER
                function triggerAutoHealing(reason) {
                    stallCount++;
                    console.warn('[AUTO-HEALING] Phục hồi luồng:', reason, 'Lần:', stallCount);
                    showOsd('🔄', 'Tự phục hồi kết nối (Lần ' + stallCount + ')...');

                    try {
                        if (player.isLive()) {
                            const seekRange = player.seekRange();
                            if (seekRange && seekRange.end) {
                                video.currentTime = Math.max(seekRange.start, seekRange.end - 1.5);
                                video.play().catch(function() {});
                                return;
                            }
                        }
                        if (stallCount <= 1) {
                            video.currentTime += 0.2;
                            video.play().catch(function() {});
                        } else if (smartFailoverInstance) {
                            smartFailoverInstance.attemptAutoFailover(reason);
                        } else if (fallbackUrl && fallbackUrl !== rawStreamUrl) {
                            showOsd('⚡', 'Chuyển mạch dự phòng...');
                            player.load(fallbackUrl).catch(function() {
                                video.src = fallbackUrl;
                                video.play().catch(function() {});
                            });
                        } else {
                            player.load(rawStreamUrl).catch(function() {});
                        }
                    } catch(e) {
                        console.error('Lỗi auto-healing:', e);
                    }
                }

                video.addEventListener('waiting', function() {
                    clearTimeout(stallRecoveryTimeout);
                    stallRecoveryTimeout = setTimeout(function() {
                        if (video.readyState < 3 && !video.paused) {
                            triggerAutoHealing('Buffer Stalled > 3.5s');
                        }
                    }, 3500);
                });

                video.addEventListener('playing', function() {
                    clearTimeout(stallRecoveryTimeout);
                    stallCount = 0;
                    var playIcon = document.getElementById('playIcon');
                    if (playIcon) playIcon.innerText = '⏸';
                });

                // CẬP NHẬT HUD THÔNG SỐ (PHÍM I)
                setInterval(function() {
                    var hud = document.getElementById('infoHud');
                    if (hud && hud.classList.contains('show')) {
                        if (video.videoWidth) {
                            document.getElementById('hudRes').innerText = video.videoWidth + 'x' + video.videoHeight;
                        }
                        var stats = player.getStats();
                        if (stats) {
                            var kbps = Math.round((stats.streamBandwidth || 0) / 1000);
                            document.getElementById('hudBitrate').innerText = kbps > 0 ? (kbps + ' kbps') : 'Adaptive Auto';
                            document.getElementById('hudBuffer').innerText = (stats.bufferingTime || 0).toFixed(1) + ' s';
                        }
                    }
                }, 1500);

                // ERROR HANDLER
                player.addEventListener('error', (event) => {
                    console.error('Shaka Player Error:', event.detail);
                    const code = event.detail?.code;
                    if (code === 4012) {
                        showOsd('⚠️', 'Bypass khóa 4012...');
                        setTimeout(() => { video.src = rawStreamUrl; video.play().catch(() => {}); }, 1000);
                    } else {
                        triggerAutoHealing('Shaka Error ' + (code || 'unknown'));
                    }
                });

                // TẢI LUỒNG & TỰ ĐỘNG THIẾT LẬP KHI CÓ HÌNH ẢNH
                try {
                    await player.load(rawStreamUrl);
                    loadBox.style.display = 'none';

                    // 🌟 1. TỰ ĐỘNG CHỌN CHẤT LƯỢNG CAO NHẤT (HIGHEST QUALITY)
                    selectHighestQuality();

                    // 🌟 2. TỰ ĐỘNG BẬT ÂM THANH (AUTO UNMUTE)
                    attemptAutoUnmute();

                    // 🌟 3. TỰ ĐỘNG XOAY NGANG NẾU MÀN HÌNH DỌC
                    checkAutoRotateLandscape();

                    // 🌟 4. TỰ ĐỘNG FULL MÀN HÌNH NẾU LÀ TV
                    checkAutoFullscreenTv();

                } catch (e) {
                    console.error('Load error', e);
                    var recovered = smartFailoverInstance ? await smartFailoverInstance.attemptAutoFailover('Initial load error: ' + e.message) : false;
                    if (recovered) {
                        loadBox.style.display = 'none';
                        attemptAutoUnmute();
                    } else {
                        loadBox.style.display = 'block';
                        spinner.style.display = 'none';
                        loadText.innerText = "❌ Đang chuyển chế độ dự phòng...";
                        video.src = rawStreamUrl;
                        attemptAutoUnmute();
                    }
                }

                // D-PAD & BÀN PHÍM TV REMOTE (10-FOOT UI)
                window.addEventListener('keydown', function(e) {
                    var modRem = document.getElementById('remoteModal');
                    var modExt = document.getElementById('modalExternal');

                    if (e.key === 'Escape') {
                        if (modRem && modRem.classList.contains('show')) { modRem.classList.remove('show'); return; }
                        if (modExt && modExt.classList.contains('show')) { modExt.classList.remove('show'); return; }
                    }

                    switch(e.key) {
                        case 'ArrowLeft':
                            e.preventDefault();
                            if (video) {
                                video.currentTime = Math.max(0, video.currentTime - 10);
                                showOsd('⏪', 'Tua lại 10s');
                            }
                            break;
                        case 'ArrowRight':
                            e.preventDefault();
                            if (video) {
                                video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
                                showOsd('⏩', 'Tua tiến 10s');
                            }
                            break;
                        case 'ArrowUp':
                            e.preventDefault();
                            if (video) {
                                video.muted = false;
                                video.volume = Math.min(1.0, video.volume + 0.05);
                                var p = Math.round(video.volume * 100);
                                var s = document.getElementById('volSlider'); if (s) s.value = p;
                                var t = document.getElementById('volText'); if (t) t.innerText = p + '%';
                                showOsd('🔊', 'Âm lượng: ' + p + '%', p);
                            }
                            break;
                        case 'ArrowDown':
                            e.preventDefault();
                            if (video) {
                                video.volume = Math.max(0.0, video.volume - 0.05);
                                var p = Math.round(video.volume * 100);
                                var s = document.getElementById('volSlider'); if (s) s.value = p;
                                var t = document.getElementById('volText'); if (t) t.innerText = p + '%';
                                showOsd(p === 0 ? '🔇' : '🔉', 'Âm lượng: ' + p + '%', p);
                            }
                            break;
                        case ' ':
                        case 'Enter':
                            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                                e.preventDefault();
                                togglePlayPause();
                            }
                            break;
                        case 'z':
                        case 'Z':
                            e.preventDefault();
                            cycleAspectRatio();
                            break;
                        case 'q':
                        case 'Q':
                            e.preventDefault();
                            toggleQualityMenu();
                            break;
                        case 'r':
                        case 'R':
                            e.preventDefault();
                            toggleRotateLandscape();
                            break;
                        case 'f':
                        case 'F':
                            e.preventDefault();
                            toggleFullscreen();
                            break;
                        case 'm':
                        case 'M':
                            e.preventDefault();
                            toggleMute();
                            break;
                        case 'a':
                        case 'A':
                            e.preventDefault();
                            toggleAmbient();
                            break;
                        case 'p':
                        case 'P':
                            e.preventDefault();
                            togglePip();
                            break;
                        case 'i':
                        case 'I':
                            e.preventDefault();
                            toggleInfoHud();
                            break;
                        case 'h':
                        case 'H':
                            e.preventDefault();
                            toggleRemoteModal();
                            break;
                    }
                });

                resetControlsAutohide();
            }

            document.addEventListener('DOMContentLoaded', initPlayer);
        </script>
    </body>
    </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

// CỔNG PROXY DRM THEO CHUẨN JSON DATA (DÀNH CHO NATIVE NUVIO)
app.all("/api/clearkey/:kidHex/:keyHex", (req, res) => {
    const hexToBase64Url = (hex) => Buffer.from(hex, 'hex').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try {
        const { kidHex, keyHex } = req.params;
        const responseJson = { keys: [{ kty: "oct", k: hexToBase64Url(keyHex), kid: hexToBase64Url(kidHex) }], type: "temporary" };
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(responseJson);
    } catch (e) { return res.status(500).json({ error: "Thất bại" }); }
});

// 4. ROUTE: CATALOG 
const pendingCatalogPromises = new Map();

app.get([
    "/catalog/:type/:id", "/catalog/:type/:id.json", "/catalog/:type/:id/:extra", "/catalog/:type/:id/:extra.json",
    "/:options/catalog/:type/:id", "/:options/catalog/:type/:id.json", "/:options/catalog/:type/:id/:extra", "/:options/catalog/:type/:id/:extra.json",
    "/config/:options/catalog/:type/:id", "/config/:options/catalog/:type/:id.json", "/config/:options/catalog/:type/:id/:extra", "/config/:options/catalog/:type/:id/:extra.json"
], async (req, res) => {
    const rawCatalogId = (req.params.id || "").replace(/\.json$/, '');
    const metaType = req.params.type;
    const extraRaw = (req.params.extra || "").replace(/\.json$/, '');
    const extraParams = new URLSearchParams(extraRaw.includes('=') ? extraRaw : '');
    
    let skip = 0;
    if (req.query.skip) {
        skip = parseInt(req.query.skip, 10) || 0;
    } else if (extraParams.get("skip")) {
        skip = parseInt(extraParams.get("skip"), 10) || 0;
    } else {
        const match = extraRaw.match(/skip[=:](\d+)/i);
        if (match) skip = parseInt(match[1], 10) || 0;
    }

    const search = (req.query.search || extraParams.get("search") || "").trim().toLowerCase();
    const genre = (req.query.genre || extraParams.get("genre") || "").trim();
    const page = Math.floor(skip / 24) + 1;
    const endpoints = sources.getEndpoints();

    if (metaType === "tv" || rawCatalogId.startsWith("tv_") || rawCatalogId.startsWith("cat_tv_") || rawCatalogId === "sports_live_matches") {
        const cleanCatalogId = rawCatalogId.replace(/^cat_/, '');

        if (cleanCatalogId === "sports_live_matches") {
            const matches = await sources.fetchLiveMatches(cache);
            return res.json({ metas: matches.map(m => {
                let safePoster = m.poster;
                return { id: m.id, type: "tv", name: m.name, poster: safePoster, description: m.description, posterShape: "landscape" };
            })});
        }

        let channels = await sources.fetchUnifiedTvChannels(cache);

        if (cleanCatalogId === "tv_vtv") { channels = channels.filter(c => sources.classifyTvChannel(c).category === "vtv"); } 
        else if (cleanCatalogId === "tv_vtvcab") { channels = channels.filter(c => sources.classifyTvChannel(c).category === "vtvcab"); } 
        else if (cleanCatalogId === "tv_quoc_te") { channels = channels.filter(c => sources.isInternationalChannel(c)); } 
        else if (cleanCatalogId === "tv_phim_truyen") { channels = channels.filter(c => sources.isMovieChannel(c)); } 
        else if (cleanCatalogId === "tv_the_thao") { channels = channels.filter(c => sources.classifyTvChannel(c).category === "the_thao"); } 
        else if (cleanCatalogId === "tv_thieu_nhi") { channels = channels.filter(c => sources.classifyTvChannel(c).category === "thieu_nhi"); } 
        else if (cleanCatalogId === "tv_giai_tri") { channels = channels.filter(c => sources.classifyTvChannel(c).category === "giai_tri"); } 
        else if (cleanCatalogId === "tv_dia_phuong") { channels = channels.filter(c => sources.classifyTvChannel(c).category === "dia_phuong"); } 
        else if (cleanCatalogId === "tv_trong_nuoc") { channels = channels.filter(c => ["vtv", "vtvcab", "giai_tri", "dia_phuong"].includes(sources.classifyTvChannel(c).category)); } 
        else if (cleanCatalogId === "tv_tong_hop" || cleanCatalogId === "viettv_live") {
            if (genre && !genre.includes("Tất Cả")) {
                const gLower = genre.toLowerCase();
                if (gLower.includes("vtv") && !gLower.includes("vtvcab")) { channels = channels.filter(c => sources.classifyTvChannel(c).category === "vtv"); } 
                else if (gLower.includes("vtvcab")) { channels = channels.filter(c => sources.classifyTvChannel(c).category === "vtvcab"); } 
                else if (gLower.includes("quốc tế")) { channels = channels.filter(c => sources.isInternationalChannel(c)); } 
                else if (gLower.includes("bóng đá") || gLower.includes("thể thao")) { channels = channels.filter(c => sources.classifyTvChannel(c).category === "the_thao"); } 
                else if (gLower.includes("thiếu nhi")) { channels = channels.filter(c => sources.classifyTvChannel(c).category === "thieu_nhi"); } 
                else if (gLower.includes("giải trí")) { channels = channels.filter(c => sources.classifyTvChannel(c).category === "giai_tri"); } 
                else if (gLower.includes("việt nam") || gLower.includes("trong nước")) { channels = channels.filter(c => ["vtv", "vtvcab", "giai_tri", "dia_phuong"].includes(sources.classifyTvChannel(c).category)); } 
                else if (gLower.includes("xem phim") || gLower.includes("phim")) { channels = channels.filter(c => sources.isMovieChannel(c)); } 
                else if (gLower.includes("địa phương") || gLower.includes("khác")) { channels = channels.filter(c => sources.classifyTvChannel(c).category === "dia_phuong"); }
            }
        }

        if (cleanCatalogId === "tv_vtv" || cleanCatalogId === "tv_phim_truyen" || cleanCatalogId === "tv_quoc_te") {
            channels.sort((a, b) => (sources.classifyTvChannel(a).sortIndex || 99) - (sources.classifyTvChannel(b).sortIndex || 99));
        }

        if (search) { channels = channels.filter(m => (m.name || "").toLowerCase().includes(search)); }

        const pageSize = 500;
        const pagedChannels = (skip && skip > 0) ? channels.slice(skip, skip + pageSize) : (cleanCatalogId === "tv_tong_hop" ? channels.slice(0, pageSize) : channels);

        const metas = pagedChannels.map(ch => ({ id: ch.id, type: "tv", name: ch.name, poster: ch.poster, description: ch.genre || "📺 Truyền Hình Trực Tiếp", posterShape: "landscape" }));
        return res.json({ metas });
    }

    if (rawCatalogId.includes("phim_18") || rawCatalogId.includes("adult")) {
        const metas = await sources.fetchAdultJav(page, rawCatalogId); return res.json({ metas });
    }

    if (search) {
        const searchResults = await sources.searchAllMovieSources(search, page); return res.json({ metas: searchResults });
    }

    // 🌟 HỖ TRỢ TRỰC TIẾP CATALOG QUỐC TẾ TỪ VIPTORRENT
    if (rawCatalogId.startsWith("viptorrent_")) {
        const vipCatCacheKey = `vip_cat_${metaType}_${rawCatalogId}_${skip}_${page}_${search}_${genre}`;
        const cachedVip = cache ? cache.get(vipCatCacheKey) : null;
        if (cachedVip && Array.isArray(cachedVip) && cachedVip.length > 0) {
            return res.json({ metas: cachedVip });
        }

        try {
            const vUrl = `https://viptorrent.nadan.cloud/catalog/${metaType}/${rawCatalogId}.json${extraRaw ? `/${extraRaw}` : ''}`;
            const vRes = await axios.get(vUrl, { 
                timeout: 3500,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
            });
            const metas = vRes.data?.metas || [];
            if (cache && metas.length > 0) cache.set(vipCatCacheKey, metas, 3600);
            return res.json({ metas });
        } catch (e) {
            return res.json({ metas: [] });
        }
    }

    const catCacheKey = `cat_v8_${rawCatalogId}_${metaType}_${page}_${search}_${genre}`;
    const cachedMetas = cache ? cache.get(catCacheKey) : null;
    if (cachedMetas && Array.isArray(cachedMetas) && cachedMetas.length > 0) {
        const cachedPag = cache ? cache.get(`${catCacheKey}_pag`) : null;
        return res.json({ metas: cachedMetas, pagination: cachedPag || { currentPage: page, totalPages: 120 } });
    }

    // In-flight request deduplication: nếu có nhiều request cùng catalog, cùng đợi Promise chung
    if (pendingCatalogPromises.has(catCacheKey)) {
        try {
            const sharedResult = await pendingCatalogPromises.get(catCacheKey);
            return res.json({
                metas: sharedResult?.metas || sharedResult || [],
                pagination: sharedResult?.pagination || { currentPage: page, totalPages: 120 }
            });
        } catch (e) {}
    }

    const catalogFetchPromise = (async () => {
        const normalizedId = rawCatalogId.replace(/^cat[_-]/, '').replace(/_/g, '-');
        const catItem = sources.ALL_CATALOGS.find(c => 
            c.id === normalizedId || 
            c.id === rawCatalogId || 
            `cat_${c.id.replace(/-/g, '_')}` === rawCatalogId || 
            c.id.replace(/-/g, '_') === rawCatalogId ||
            (c.id === "vo-thuat-long-tieng" && rawCatalogId.includes("nhat_thai"))
        );

        let apiPath = catItem?.apiPath || "danh-sach/phim-moi-cap-nhat";
        if (rawCatalogId.startsWith("the_loai_")) {
            apiPath = `the-loai/${rawCatalogId.replace(/^the_loai_/, '').replace(/_/g, '-')}`;
        } else if (rawCatalogId.startsWith("quoc_gia_")) {
            apiPath = `quoc-gia/${rawCatalogId.replace(/^quoc_gia_/, '').replace(/_/g, '-')}`;
        } else if (rawCatalogId.startsWith("danh_sach_")) {
            apiPath = `danh-sach/${rawCatalogId.replace(/^danh_sach_/, '').replace(/_/g, '-')}`;
        }

        try {
            let items = [];
            let totalPages = 120;
            // Tối ưu tải song song (Parallel Burst) để luôn lấy đủ >= 24 phim trong 1 nhịp duy nhất (~350ms)
            if (apiPath === "danh-sach/phim-moi-cap-nhat") {
                const startPg = (page - 1) * 3 + 1;
                const [r1, r2, r3] = await Promise.all([
                    axios.get(`${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${startPg}`, { timeout: 2200 }).catch(() => null),
                    axios.get(`${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${startPg + 1}`, { timeout: 2200 }).catch(() => null),
                    axios.get(`${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${startPg + 2}`, { timeout: 2200 }).catch(() => null)
                ]);
                const i1 = r1?.data?.data?.items || r1?.data?.items || [];
                const i2 = r2?.data?.data?.items || r2?.data?.items || [];
                const i3 = r3?.data?.data?.items || r3?.data?.items || [];
                items = [...i1, ...i2, ...i3];
                const pag = r1?.data?.data?.params?.pagination || r1?.data?.pagination;
                if (pag?.totalPages) totalPages = Math.max(1, Math.floor(pag.totalPages / 3));
                else if (pag?.totalItems) totalPages = Math.ceil(pag.totalItems / 24);
                if (items.length === 0) {
                    const fbRes = await axios.get(`${endpoints.ophim}/v1/api/danh-sach/phim-moi-cap-nhat?page=${page}`, { timeout: 2200 }).catch(() => null);
                    items = fbRes?.data?.data?.items || fbRes?.data?.items || [];
                }
            } else if (normalizedId === "phim-le" && page === 1) {
                const [r1, r2] = await Promise.all([
                    axios.get(`${endpoints.kkphim}/v1/api/${apiPath}?page=1&limit=24`, { timeout: 2200 }).catch(() => null),
                    axios.get(`${endpoints.kkphim}/v1/api/${apiPath}?page=2&limit=24`, { timeout: 2200 }).catch(() => null)
                ]);
                const i1 = r1?.data?.data?.items || r1?.data?.items || [];
                const i2 = r2?.data?.data?.items || r2?.data?.items || [];
                const pag = r1?.data?.data?.params?.pagination || r1?.data?.pagination;
                if (pag?.totalPages) totalPages = pag.totalPages;
                else if (pag?.totalItems) totalPages = Math.ceil(pag.totalItems / 24);
                items = [...i1, ...i2];
            } else {
                const url = `${endpoints.kkphim}/v1/api/${apiPath}?page=${page}&limit=24`;
                let response = null;
                try {
                    response = await axios.get(url, { timeout: 2200 });
                } catch (err) {
                    const ophimPath = apiPath.replace('danh-sach/', '');
                    const fallbackUrl = apiPath.startsWith("the-loai/") || apiPath.startsWith("quoc-gia/")
                        ? `${endpoints.ophim}/v1/api/${apiPath}?page=${page}`
                        : `${endpoints.ophim}/v1/api/danh-sach/${ophimPath}?page=${page}`;
                    response = await axios.get(fallbackUrl, { timeout: 2200 }).catch(() => null);
                }
                items = response?.data?.data?.items || response?.data?.items || [];
                const pag = response?.data?.data?.params?.pagination || response?.data?.pagination;
                if (pag?.totalPages) totalPages = pag.totalPages;
                else if (pag?.totalItems) totalPages = Math.ceil(pag.totalItems / 24);
            }

            const isAnimeCat = rawCatalogId.includes("hoat_hinh") || rawCatalogId.includes("thieu_nhi") || apiPath.includes("hoat-hinh");

            // Khi lọc theo Thể Loại hoặc Quốc Gia cụ thể thì giữ nguyên toàn bộ kết quả của chuyên mục đó
            const isExplicitGenreOrCountry = rawCatalogId.startsWith("the_loai_") || rawCatalogId.startsWith("quoc_gia_") || apiPath === "danh-sach/phim-moi-cap-nhat";
            if (!isExplicitGenreOrCountry) {
                if (isAnimeCat) {
                    items = items.filter(p => apiPath.includes("hoat-hinh") || sources.isAnimeMovie(p));
                } else {
                    items = items.filter(p => !sources.isAnimeMovie(p));
                }
            }

            if (normalizedId === "phim-moi-cap-nhat") {
                if (page === 1 && cache && items.length > 0) {
                    const newSlugs = items.map(p => p.slug).filter(Boolean);
                    cache.set("top_phim_moi_slugs", newSlugs, 3600);
                }
            } else if (normalizedId === "phim-le") {
                const topMoiSlugs = (cache && cache.get("top_phim_moi_slugs")) || [];
                if (topMoiSlugs.length > 0) {
                    items = items.filter(p => !topMoiSlugs.includes(p.slug));
                }
                items = items.filter(p => p.type !== "series" && (p.total_episodes || 1) <= 1);
            }

            // Đảm bảo luôn lấy đủ 24 phim (4 hàng x 6 cột) để không bị lẻ hàng cuối trên giao diện 6 cột
            if (items.length < 24) {
                try {
                    const nextPage = (normalizedId === "phim-le" && page === 1) ? 3 : page + 1;
                    let nextUrl = `${endpoints.kkphim}/v1/api/${apiPath}?page=${nextPage}&limit=24`;
                    if (apiPath === "danh-sach/phim-moi-cap-nhat") nextUrl = `${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${nextPage}`;
                    const nextRes = await axios.get(nextUrl, { timeout: 2200 }).catch(() => null);
                    let nextItems = nextRes?.data?.data?.items || nextRes?.data?.items || [];
                    if (!isExplicitGenreOrCountry) {
                        if (isAnimeCat) {
                            nextItems = nextItems.filter(p => apiPath.includes("hoat-hinh") || sources.isAnimeMovie(p));
                        } else {
                            nextItems = nextItems.filter(p => !sources.isAnimeMovie(p));
                        }
                    }
                    if (normalizedId === "phim-le") {
                        nextItems = nextItems.filter(p => p.type !== "series" && (p.total_episodes || 1) <= 1);
                    }
                    for (const ex of nextItems) {
                        if (ex?.slug && !items.some(it => it.slug === ex.slug)) items.push(ex);
                        if (items.length >= 24) break;
                    }
                } catch (e) {}
            }

            const isKids = rawCatalogId.includes("thieu_nhi");
            const forcedType = metaType || catItem?.type || "movie";

            // Luôn cắt chẵn bội số của 6 (tối đa 24 phim/trang) để lấp đầy hoàn toàn lưới 6 cột
            const targetCount = items.length >= 24 ? 24 : (items.length >= 6 ? Math.floor(items.length / 6) * 6 : items.length);
            const metas = items.slice(0, targetCount).map(phim => {
                const posterImg = sources.getImgUrl(phim.poster_url || phim.thumb_url);
                const backdropImg = sources.getImgUrl(phim.thumb_url || phim.poster_url);
                const inferredType =
                    phim.type === "series" ||
                    (phim.episode_current && /tập\s*\d+/i.test(phim.episode_current) && !/full/i.test(phim.episode_current))
                        ? "series"
                        : forcedType;
                return {
                    id: `phim_${phim.slug}`,
                    type: inferredType,
                    name: isKids ? `👶 [Thiếu Nhi] ${phim.name}` : phim.name,
                    poster: posterImg,
                    background: backdropImg,
                    description: `${phim.origin_name || ""} • Năm: ${phim.year || "N/A"}`,
                    originName: phim.origin_name || phim.original_name || "",
                    year: phim.year ? String(phim.year) : "2026",
                    episodeCurrent: phim.episode_current || (inferredType === "series" ? "Tập Mới" : "FULL"),
                    quality: phim.quality || "FHD",
                    lang: phim.lang || "Vietsub",
                    tmdbVote: phim.tmdb?.vote_average ? Number(phim.tmdb.vote_average).toFixed(1) : "8.2",
                    posterShape: "landscape"
                };
            });

            const paginationObj = { currentPage: page, totalPages: Math.max(page, totalPages) };
            if (cache && metas.length > 0) {
                cache.set(catCacheKey, metas, 43200); // 12 giờ cache
                cache.set(`${catCacheKey}_pag`, paginationObj, 43200);
            }

            // ⚡ TIÊN ĐOÁN TẢI TRANG TIẾP THEO (SPECULATIVE ASYNC PREFETCH)
            if (!search && page < 25) {
                setTimeout(() => {
                    [page + 1, page + 2].forEach(async (nextPg) => {
                        const nextCacheKey = `cat_v8_${rawCatalogId}_${metaType}_${nextPg}__${genre}`;
                        if (cache && !cache.get(nextCacheKey)) {
                            try {
                                const nextUrl = apiPath === "danh-sach/phim-moi-cap-nhat"
                                    ? `${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${nextPg}`
                                    : `${endpoints.kkphim}/v1/api/${apiPath}?page=${nextPg}&limit=24`;
                                const nRes = await axios.get(nextUrl, { timeout: 3000 }).catch(() => null);
                                const nItems = nRes?.data?.data?.items || nRes?.data?.items || [];
                                if (nItems.length >= 6) {
                                    const nTarget = nItems.length >= 24 ? 24 : Math.floor(nItems.length / 6) * 6;
                                    const nextMetas = nItems.slice(0, nTarget).map(p => ({
                                        id: `phim_${p.slug}`,
                                        type: forcedType,
                                        name: isKids ? `👶 [Thiếu Nhi] ${p.name}` : p.name,
                                        poster: sources.getImgUrl(p.poster_url || p.thumb_url),
                                        background: sources.getImgUrl(p.thumb_url || p.poster_url),
                                        description: `${p.origin_name || ""} • Năm: ${p.year || "N/A"}`,
                                        originName: p.origin_name || p.original_name || "",
                                        year: p.year ? String(p.year) : "2026",
                                        episodeCurrent: p.episode_current || "FULL",
                                        quality: p.quality || "FHD",
                                        lang: p.lang || "Vietsub",
                                        tmdbVote: p.tmdb?.vote_average ? Number(p.tmdb.vote_average).toFixed(1) : "8.2",
                                        posterShape: "landscape"
                                    }));
                                    cache.set(nextCacheKey, nextMetas, 43200);
                                }
                            } catch (e) {}
                        }
                    });
                }, 100);
            }

            return metas;
        } catch (e) {
            sources.failureTelemetry.recordFailure();
            return [];
        } finally {
            pendingCatalogPromises.delete(catCacheKey);
        }
    })();

    pendingCatalogPromises.set(catCacheKey, catalogFetchPromise);
    const resolvedMetas = await catalogFetchPromise;
    const pagination = (cache && cache.get(`${catCacheKey}_pag`)) || { currentPage: page, totalPages: 2538 };
    return res.json({ metas: resolvedMetas, pagination });
});

// 5. ROUTE: META
app.get([
    "/meta/:type/:id", "/meta/:type/:id.json",
    "/:options/meta/:type/:id", "/:options/meta/:type/:id.json",
    "/config/:options/meta/:type/:id", "/config/:options/meta/:type/:id.json"
], async (req, res) => {
    const rawId = req.params.id.replace(".json", "");
    const endpoints = sources.getEndpoints();

    if (rawId.startsWith("match_")) {
        const matches = await sources.fetchLiveMatches(cache);
        const m = matches.find(x => x.id === rawId);
        if (m) return res.json({ meta: { id: rawId, type: "tv", name: m.name, poster: m.poster, background: m.poster, logo: m.poster, description: m.description, genres: ["Trực Tiếp", "Thể Thao"], behaviorHints: { isLive: true, defaultVideoId: rawId }, videos: [{ id: rawId, title: m.name, released: new Date().toISOString() }] } });
    }

    if (rawId.startsWith("iptv_") || rawId.startsWith("vmttv_") || rawId.startsWith("vmt_") || rawId.startsWith("scraped_") || req.params.type === "tv") {
        const channels = await sources.fetchUnifiedTvChannels(cache);
        const targetKey = rawId.replace("iptv_", "").replace("vmttv_", "").replace("vmt_", "").replace("scraped_", "");
        const ch = channels.find(c => c.id === rawId || c.legacyId === rawId || c.key === targetKey || (c.id && c.id.replace("iptv_", "").replace("vmttv_", "").replace("vmt_", "").replace("scraped_", "") === targetKey) || (c.legacyId && c.legacyId.replace(/^vmt_/, "") === targetKey) || (c.vipId && c.vipId === rawId));
        const channelName = ch ? ch.name : "Kênh Truyền Hình Trực Tiếp";
        const channelPoster = ch ? ch.poster : "https://via.placeholder.com/300x200?text=TV";
        const channelGenre = ch ? ch.genre : "📺 Truyền Hình";
        const epgInfo = await sources.getChannelEpgInfo(channelName, cache);
        return res.json({ 
            meta: { 
                id: rawId, 
                type: "tv", 
                name: channelName, 
                poster: channelPoster, 
                background: channelPoster, 
                logo: channelPoster, 
                description: `${channelGenre}\n${epgInfo}`, 
                genres: ["Truyền Hình"], 
                behaviorHints: { isLive: true, defaultVideoId: rawId }, 
                videos: [{ id: rawId, title: channelName, released: new Date().toISOString() }] 
            } 
        });
    }

    if (rawId.startsWith("jav_")) {
        const meta = await sources.fetchAdultJavMeta(rawId);
        return res.json({ meta });
    }
    
    if (rawId.startsWith("tt")) return res.json({ meta: {} });

    // 🌟 MULTI-LAYER CACHING: Bộ nhớ đệm 48h cho Metadata chi tiết phim
    const metaCacheKey = `meta_v7_${rawId}`;
    const cachedMeta = cache ? cache.get(metaCacheKey) : null;
    if (cachedMeta) return res.json({ meta: cachedMeta });

    if (rawId.startsWith("vsmov_")) {
        const slug = rawId.replace("vsmov_", "");
        try {
            const resVS = await axios.get(`${endpoints.vsmov}/api/phim/${slug}`, { timeout: 3000 });
            const m = resVS.data?.movie || resVS.data?.data?.item || resVS.data;
            if (m) {
                const epList = resVS.data?.episodes?.[0]?.server_data || m.episodes?.[0]?.items || [];
                const isSeries = m.type === "series" || epList.length > 1;
                const metaObj = {
                    id: rawId,
                    type: isSeries ? "series" : "movie",
                    name: m.name,
                    poster: sources.getImgUrl(m.thumb_url || m.poster_url),
                    background: sources.getImgUrl(m.poster_url || m.thumb_url),
                    description: m.content ? m.content.replace(/<[^>]*>?/gm, '') : (m.description || ""),
                    releaseInfo: m.year ? String(m.year) : "",
                    genres: Array.isArray(m.category) ? m.category.map(c => c.name || c) : ["Phim"]
                };
                if (isSeries && epList.length > 0) {
                    metaObj.videos = epList.map((ep, idx) => ({
                        id: `${rawId}:1:${sources.parseEpisodeNumber(ep.name, idx)}`,
                        title: ep.name ? (ep.name.startsWith("Tập") ? ep.name : `Tập ${ep.name}`) : `Tập ${idx + 1}`,
                        season: 1,
                        episode: sources.parseEpisodeNumber(ep.name, idx),
                        released: new Date(m.year || 2024, 0, 1).toISOString()
                    }));
                } else {
                    metaObj.behaviorHints = { defaultVideoId: rawId };
                }
                if (cache) cache.set(metaCacheKey, metaObj, 86400 * 2);
                return res.json({ meta: metaObj });
            }
        } catch (e) { sources.failureTelemetry.recordFailure(); }
    }

    if (rawId.startsWith("nguonc_")) {
        const slug = rawId.replace("nguonc_", "");
        try {
            const resNC = await axios.get(`${endpoints.nguonc}/api/film/${slug}`, { timeout: 3000, headers: { "Accept": "application/json" } });
            const m = resNC.data?.movie;
            if (m) {
                const epList = m.episodes?.[0]?.items || [];
                const isSeries = m.type === "series" || epList.length > 1;
                const metaObj = {
                    id: rawId,
                    type: isSeries ? "series" : "movie",
                    name: m.name,
                    poster: sources.getImgUrl(m.thumb_url || m.poster_url),
                    background: sources.getImgUrl(m.poster_url || m.thumb_url),
                    description: m.description ? m.description.replace(/<[^>]*>?/gm, '') : "",
                    releaseInfo: m.year ? String(m.year) : "",
                    genres: Array.isArray(m.category) ? m.category.map(c => c.name || c) : ["Phim"]
                };
                if (isSeries && epList.length > 0) {
                    metaObj.videos = epList.map((ep, idx) => ({
                        id: `${rawId}:1:${sources.parseEpisodeNumber(ep.name, idx)}`,
                        title: ep.name ? (ep.name.startsWith("Tập") ? ep.name : `Tập ${ep.name}`) : `Tập ${idx + 1}`,
                        season: 1,
                        episode: sources.parseEpisodeNumber(ep.name, idx),
                        released: new Date(m.year || 2024, 0, 1).toISOString()
                    }));
                } else {
                    metaObj.behaviorHints = { defaultVideoId: rawId };
                }
                if (cache) cache.set(metaCacheKey, metaObj, 86400 * 2);
                return res.json({ meta: metaObj });
            }
        } catch (e) { sources.failureTelemetry.recordFailure(); }
    }

    const slug = rawId.replace(/^(phim_|custom_|ophim_|xink_)/, "");
    try {
        let m = null;
        let rawEps = [];

        try {
            const resKK = await axios.get(`${endpoints.kkphim}/phim/${slug}`, { timeout: 2600 });
            if (resKK.data?.movie) {
                m = resKK.data.movie;
                rawEps = resKK.data.episodes?.[0]?.server_data || [];
            }
        } catch (e) {}

        if (!m) {
            try {
                const resOP = await axios.get(`${endpoints.ophim}/phim/${slug}`, { timeout: 2600 });
                if (resOP.data?.movie) {
                    m = resOP.data.movie;
                    rawEps = resOP.data.episodes?.[0]?.server_data || [];
                }
            } catch (e) {}
        }

        if (m) {
            const isSeries = (m.type === "series" || rawEps.length > 1);
            const metaObj = {
                id: rawId,
                type: isSeries ? "series" : "movie",
                name: m.name,
                poster: sources.getImgUrl(m.thumb_url || m.poster_url),
                background: sources.getImgUrl(m.poster_url || m.thumb_url),
                description: m.content ? m.content.replace(/<[^>]*>?/gm, '') : (m.description || ""),
                releaseInfo: m.year ? String(m.year) : "",
                genres: Array.isArray(m.category) ? m.category.map(c => c.name || c) : ["Phim"]
            };
            if (isSeries && rawEps.length > 0) {
                metaObj.videos = rawEps.map((ep, idx) => ({
                    id: `${rawId}:1:${sources.parseEpisodeNumber(ep.name, idx)}`,
                    title: ep.name ? (ep.name.startsWith("Tập") ? ep.name : `Tập ${ep.name}`) : `Tập ${idx + 1}`,
                    season: 1,
                    episode: sources.parseEpisodeNumber(ep.name, idx),
                    released: new Date(m.year || 2024, 0, 1).toISOString()
                }));
            } else {
                metaObj.behaviorHints = { defaultVideoId: rawId };
            }
            if (cache) cache.set(metaCacheKey, metaObj, 86400 * 2);
            return res.json({ meta: metaObj });
        }
    } catch (e) { sources.failureTelemetry.recordFailure(); }
    res.json({ meta: {} });
});

// 6. ROUTE: SUBTITLES (TÍCH HỢP VIETSUB HARVESTER & ĐỒNG BỘ THỜI GIAN BLURAY/WEBDL)
app.all([
    "/subtitles/:type/:id", "/subtitles/:type/:id.json", "/subtitles/:type/:id/:extra", "/subtitles/:type/:id/:extra.json",
    "/subtitles/:type/:id/:season/:episode", "/subtitles/:type/:id/:season/:episode.json",
    "/:options/subtitles/:type/:id", "/:options/subtitles/:type/:id.json", "/:options/subtitles/:type/:id/:extra", "/:options/subtitles/:type/:id/:extra.json",
    "/:options/subtitles/:type/:id/:season/:episode", "/:options/subtitles/:type/:id/:season/:episode.json",
    "/config/:options/subtitles/:type/:id", "/config/:options/subtitles/:type/:id.json", "/config/:options/subtitles/:type/:id/:extra", "/config/:options/subtitles/:type/:id/:extra.json",
    "/config/:options/subtitles/:type/:id/:season/:episode", "/config/:options/subtitles/:type/:id/:season/:episode.json",
    "/subtitles/*",
    "/:options/subtitles/*",
    "/config/:options/subtitles/*"
], async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'HEAD') {
        return res.status(200).end();
    }

    try {
        let rawId = (req.params.id || "").replace(/\.json$/, "");
        let targetType = req.params.type || "movie";
        const extra = req.params.extra ? req.params.extra.replace(/\.json$/, "") : "";

        // Trích xuất path an toàn nếu gọi qua wildcard
        if (!rawId) {
            const fullPath = decodeURIComponent(req.path);
            const subIdx = fullPath.indexOf('/subtitles/');
            if (subIdx !== -1) {
                const after = fullPath.substring(subIdx + '/subtitles/'.length).replace(/\.json$/, '');
                const p = after.split('/');
                targetType = p[0] || "movie";
                rawId = p.slice(1).join(':') || "";
            }
        }

        rawId = decodeURIComponent(rawId);

        // Xử lý tham số season/episode hoặc extra cho series (ví dụ: season=1&episode=1)
        if (req.params.season && req.params.episode && !rawId.includes(':')) {
            rawId = `${rawId}:${req.params.season}:${req.params.episode.replace(/\.json$/, '')}`;
        } else if (extra && !rawId.includes(':')) {
            const seasonMatch = extra.match(/season=(\d+)/i);
            const episodeMatch = extra.match(/episode=(\d+)/i);
            if (seasonMatch && episodeMatch) {
                rawId = `${rawId}:${seasonMatch[1]}:${episodeMatch[1]}`;
            }
        }

        const host = req.get('host') || req.headers['host'] || 'localhost:3000';
        const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
        const protocol = req.headers['x-forwarded-proto'] || (isLocal ? 'http' : 'https');
        const hostUrl = `${protocol}://${host}`;

        // Lấy candidateStreams từ cache nếu có (giúp BOT Cấy Mắt trích xuất track nhúng)
        let candidateStreams = [];
        const cachedStreams = cache ? (cache.get(`streams_${rawId}_free_native`) || cache.get(`streams_${rawId}_rd_native`)) : null;
        if (Array.isArray(cachedStreams) && cachedStreams.length > 0) {
            candidateStreams = cachedStreams;
        }

        const subs = await subHarvester.fetchVietsubList(targetType, rawId, hostUrl, cache, candidateStreams);
        const formattedSubs = [];
        const seenIds = new Set();

        (Array.isArray(subs) ? subs : []).forEach((s, idx) => {
            const baseId = s.id || `sub_${idx}_${Math.random().toString(36).substring(7)}`;
            if (seenIds.has(baseId)) return;
            seenIds.add(baseId);

            const name = s.name || s.label || s.title || "🇻🇳 Tiếng Việt";
            let url = s.url;
            if (url && (url.includes('/api/sub-') || url.includes('/subtitles/'))) {
                url = url.replace(/^https?:\/\/[^/]+(\/api\/sub-[^?]+|\/subtitles\/[^?]+)/, `${hostUrl}$1`);
            }
            if (url && url.endsWith('?offset=0')) {
                url = url.replace('?offset=0', '');
            }
            const format = s.format || (url && url.includes('.srt') ? "srt" : "vtt");

            // Track chuẩn với ISO 639-1 (vi) cho Android Media3 / ExoPlayer / Nuvio Mobile
            formattedSubs.push({
                id: `${baseId}_vi`,
                url: url,
                lang: "vi",
                language: "vi",
                lang_code: "vi",
                locale: "vi",
                name: name,
                title: name,
                label: name,
                format: format
            });

            // Track tương thích ISO 639-2 (vie) cho Stremio
            formattedSubs.push({
                id: `${baseId}_vie`,
                url: url,
                lang: "vie",
                language: "vi",
                lang_code: "vi",
                locale: "vi",
                name: name,
                title: name,
                label: name,
                format: format
            });
        });

        // Bảo đảm không bao giờ trả về mảng rỗng cho Nuvio và Stremio
        if (formattedSubs.length === 0) {
            const defaultSmartTracks = [
                {
                    id: `smart_${rawId}_std`,
                    url: `${hostUrl}/api/sub-smart/${targetType}/${rawId}.vtt`,
                    name: "🇻🇳 Tiếng Việt [Khớp Chuẩn 0s]"
                },
                {
                    id: `smart_${rawId}_trim8`,
                    url: `${hostUrl}/api/sub-smart/${targetType}/${rawId}.vtt?offset=-8`,
                    name: "⚡ Tiếng Việt [Cắt 8s Intro]"
                },
                {
                    id: `smart_${rawId}_p25`,
                    url: `${hostUrl}/api/sub-smart/${targetType}/${rawId}.vtt?offset=2.5`,
                    name: "⏩ Tiếng Việt [Bù trễ +2.5s]"
                },
                {
                    id: `smart_${rawId}_m25`,
                    url: `${hostUrl}/api/sub-smart/${targetType}/${rawId}.vtt?offset=-2.5`,
                    name: "⏪ Tiếng Việt [Đẩy sớm -2.5s]"
                }
            ];
            defaultSmartTracks.forEach(t => {
                formattedSubs.push({
                    id: `${t.id}_vi`,
                    url: t.url,
                    lang: "vi",
                    language: "vi",
                    lang_code: "vi",
                    locale: "vi",
                    name: t.name,
                    title: t.name,
                    label: t.name,
                    format: "vtt"
                });
                formattedSubs.push({
                    id: `${t.id}_vie`,
                    url: t.url,
                    lang: "vie",
                    language: "vi",
                    lang_code: "vi",
                    locale: "vi",
                    name: t.name,
                    title: t.name,
                    label: t.name,
                    format: "vtt"
                });
            });
        }

        return res.json({ subtitles: formattedSubs.slice(0, 10) });
    } catch (e) {
        console.error("Subtitles route error:", e.message);
        return res.json({ subtitles: [] });
    }
});

// ENDPOINT 6.1: SUB-SYNC PROXY VÀ TỰ ĐỘNG BÙ ĐỘ LỆCH THỜI GIAN (?offset=-8 HOẶC ?offset=+2)
app.all(["/api/sub-sync/:id.vtt", "/api/sub-sync/*"], async (req, res) => {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.method === 'HEAD') {
        return res.status(200).end();
    }

    let rawUrl = req.query.url;
    if (req.query.b64) {
        try {
            rawUrl = Buffer.from(req.query.b64, 'base64url').toString('utf8');
        } catch (e) {}
    }
    const offsetSec = parseFloat(req.query.offset || "0") || 0;

    if (!rawUrl) {
        return res.send("WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n[Không tìm thấy đường dẫn phụ đề]");
    }

    const subCacheKey = `sub_sync_v4_${encodeURIComponent(rawUrl)}_${offsetSec}`;
    const cachedVtt = cache ? cache.get(subCacheKey) : null;
    if (cachedVtt) return res.send(cachedVtt);

    try {
        const subRes = await axios.get(rawUrl, { 
            timeout: 5000, 
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'TemporaryUserAgent' }
        });
        const buf = Buffer.from(subRes.data);
        let text = '';
        if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            text = zlib.gunzipSync(buf).toString('utf8');
        } else {
            text = buf.toString('utf8');
        }

        if (text.includes('1\r\n') || text.includes('1\n') || !text.startsWith('WEBVTT')) {
            text = subHarvester.convertSrtToVtt(text);
        }
        const shifted = subHarvester.shiftVtt(text, offsetSec);
        if (cache && shifted.length > 50) cache.set(subCacheKey, shifted, 86400); // 24h cache
        return res.send(shifted);
    } catch (e) {
        console.error("sub-sync error:", e.message);
        return res.send("WEBVTT\n\n00:00:01.000 --> 00:00:08.000\n[Lỗi nạp phụ đề từ nguồn]");
    }
});

// ENDPOINT 6.2: SUB-SMART - TỰ ĐỘNG LỰA CHỌN PHỤ ĐỀ TỐI ƯU NHẤT CHO PHIM / SERIES
app.all(["/api/sub-smart/:type/:id.vtt", "/api/sub-smart/:type/:id", "/api/sub-smart/*"], async (req, res) => {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.method === 'HEAD') {
        return res.status(200).end();
    }

    let type = req.params.type || "movie";
    let rawId = req.params.id ? req.params.id.replace(".vtt", "") : "";
    if (!rawId) {
        const parts = req.url.split('?')[0].replace('/api/sub-smart/', '').split('/');
        type = parts[0] || "movie";
        rawId = (parts[1] || "").replace('.vtt', '');
    }
    const offsetSec = parseFloat(req.query.offset || "0") || 0;

    const cacheKey = `sub_smart_v5_${type}_${rawId}_${offsetSec}`;
    const cached = cache ? cache.get(cacheKey) : null;
    if (cached) return res.send(cached);

    try {
        let vttContent = null;
        const imdbId = await subHarvester.resolveImdbForSubtitles(type, rawId, cache);

        if (imdbId) {
            const protocol = req.headers['x-forwarded-proto'] || (req.get('host').includes('localhost') ? 'http' : 'https');
            const hostUrl = `${protocol}://${req.get('host')}`;
            const parts = rawId.split(':');
            const season = parts[1];
            const episode = parts[2];

            // 1. Thử kho OpenSubtitles REST (chất lượng cao nhất cả phim lẻ và từng tập series)
            const osRestSubs = await subHarvester.fetchOpenSubtitlesRest(type, imdbId, season, episode, hostUrl);
            if (osRestSubs.length > 0) {
                const firstSub = osRestSubs[0];
                const b64Match = firstSub.url.match(/b64=([^&]+)/);
                if (b64Match) {
                    try {
                        const downUrl = Buffer.from(b64Match[1], 'base64url').toString('utf8');
                        const subRes = await axios.get(downUrl, { timeout: 4500, responseType: 'arraybuffer', headers: { 'User-Agent': 'TemporaryUserAgent' } });
                        const buf = Buffer.from(subRes.data);
                        let text = (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
                        if (!text.startsWith('WEBVTT')) text = subHarvester.convertSrtToVtt(text);
                        vttContent = subHarvester.shiftVtt(text, offsetSec);
                    } catch (e) {}
                }
            }

            // 2. Thử YTS-Subs (cho phim lẻ)
            if (!vttContent && (type === 'movie' || !season)) {
                const ytsSubs = await subHarvester.fetchYtsSubtitles(imdbId, hostUrl);
                if (ytsSubs.length > 0) {
                    const firstSub = ytsSubs[0];
                    const b64Match = firstSub.url.match(/\/api\/sub-yts\/([^.?]+)/);
                    if (b64Match) {
                        let subPath = "";
                        try {
                            subPath = Buffer.from(b64Match[1], 'base64url').toString('utf8');
                        } catch (e) {
                            subPath = decodeURIComponent(b64Match[1]);
                        }
                        if (subPath) {
                            vttContent = await subHarvester.downloadYtsSubtitle(subPath, offsetSec, cache);
                        }
                    }
                }
            }

            // 3. Fallback OpenSubtitles v3
            if (!vttContent) {
                const osQuery = (type === 'series' && season && episode) ? `${imdbId}:${season}:${episode}` : imdbId;
                let osRes = null;
                try {
                    osRes = await axios.get(`https://opensubtitles-v3.strem.io/subtitles/${type}/${osQuery}.json`, { timeout: 3500 });
                } catch (e) {}
                const allSubs = osRes?.data?.subtitles || [];
                let viSub = allSubs.find(s => s.lang === 'vie' || s.lang === 'vi' || s.lang === 'vn');

                if (viSub && viSub.url) {
                    const viRes = await axios.get(viSub.url, { timeout: 4000, responseType: 'text' });
                    let rawText = typeof viRes.data === 'string' ? viRes.data : '';
                    if (!rawText.startsWith('WEBVTT')) rawText = subHarvester.convertSrtToVtt(rawText);
                    vttContent = subHarvester.shiftVtt(rawText, offsetSec);
                }
            }
        }

        // 4. Fallback cho phim máy chủ Việt Nam (KKPhim, OPhim, VSMov) khi không có IMDb
        if (!vttContent) {
            const cleanSlug = rawId.replace(/^(phim_|vsmov_|nguonc_|ophim_|xink_|custom_|viptorrent_|viptorrent:)/, '').split(':')[0];
            try {
                const endpoints = sources.getEndpoints();
                const kkRes = await axios.get(`${endpoints.kkphim}/phim/${cleanSlug}`, { timeout: 2000 }).catch(() => null);
                const mData = kkRes?.data?.movie || kkRes?.data?.item;
                const epData = kkRes?.data?.episodes;
                if (mData) {
                    const extSubs = sources.extractExternalSubtitles(mData, epData?.[0]?.server_data?.[0], null);
                    if (extSubs.length > 0) {
                        const subUrl = extSubs[0].url;
                        const subRes = await axios.get(subUrl, { timeout: 3500, responseType: 'text' }).catch(() => null);
                        if (subRes && subRes.data) {
                            let raw = subRes.data;
                            if (!raw.startsWith('WEBVTT')) raw = subHarvester.convertSrtToVtt(raw);
                            vttContent = subHarvester.shiftVtt(raw, offsetSec);
                        }
                    }
                }
            } catch (e) {}
        }

        if (vttContent) {
            if (cache) cache.set(cacheKey, vttContent, 86400 * 7);
            return res.send(vttContent);
        }
    } catch (e) {
        console.error("sub-smart error:", e.message);
    }

    return res.send(`WEBVTT\n\n00:00:01.000 --> 00:00:10.000\n[🇻🇳 Phim có sẵn Thuyết Minh / Phụ đề tiếng Việt gốc]\n`);
});

// ENDPOINT 6.4: SUB-YTS - TẢI VÀ GIẢI NÉN PHỤ ĐỀ CHUẨN BLURAY / WEB-DL TỪ YTS-SUBS
app.get(["/api/sub-yts/:b64.vtt", "/api/sub-yts/*"], async (req, res) => {
    let rawPath = "";
    if (req.params.b64) {
        try {
            const decoded = Buffer.from(req.params.b64, 'base64url').toString('utf8');
            if (decoded.includes('subtitles') || decoded.startsWith('/')) {
                rawPath = decoded;
            }
        } catch (e) {}
    }
    if (!rawPath) {
        const fullUrl = req.url.split('?')[0].replace('/api/sub-yts/', '').replace(/\.vtt$/, '');
        rawPath = decodeURIComponent(fullUrl);
    }
    if (!rawPath.startsWith('/')) rawPath = '/' + rawPath;

    const offsetSec = parseFloat(req.query.offset || "0") || 0;
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (!rawPath || rawPath === '/') {
        return res.send("WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n[Không tìm thấy đường dẫn phụ đề]");
    }

    try {
        const vtt = await subHarvester.downloadYtsSubtitle(rawPath, offsetSec, cache);
        if (vtt) {
            return res.send(vtt);
        }
    } catch (e) {
        console.error("sub-yts error:", e.message);
    }
    return res.send("WEBVTT\n\n00:00:01.000 --> 00:00:08.000\n[Lỗi nạp phụ đề từ máy chủ YTS]");
});

// ENDPOINT 6.3: SUB-AI - ĐÃ CHUYỂN SANG PHỤ ĐỀ CÀO MIỄN PHÍ 100% (KHÔNG GỌI GEMINI API TRẢ PHÍ)
app.get("/api/sub-ai/:type/:id.vtt", (req, res) => {
    const { type, id } = req.params;
    const rawId = id.replace(".vtt", "");
    const offsetSec = parseFloat(req.query.offset || "0") || 0;
    return res.redirect(302, `/api/sub-smart/${type}/${rawId}.vtt?offset=${offsetSec}`);
});

// ENDPOINT 6.5: AI AUDIO-BASED SUBTITLE SYNCHRONIZER (MIỄN PHÍ 0Đ - KHÔNG GỌI GEMINI API)
app.post("/api/ai-audio-sync", async (req, res) => {
    try {
        const { referenceTime, cues } = req.body;
        const syncResult = await subHarvester.analyzeAudioAndSyncSubtitles({
            referenceTime: typeof referenceTime === 'number' ? referenceTime : parseFloat(referenceTime || 0),
            cues: Array.isArray(cues) ? cues : []
        });
        res.json(syncResult);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ENDPOINT 6.6: NẠP PHỤ ĐỀ ĐÃ ĐƯỢC AI CÂN CHỈNH ĐỒNG BỘ THEO OFFSET
app.get("/api/sub-ai-synced/:type/:id.vtt", async (req, res) => {
    const { type, id } = req.params;
    const rawId = id.replace(".vtt", "");
    const offsetSec = parseFloat(req.query.offset || "0") || 0;
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        const hostUrl = getHostUrl(req);

        // Nạp phụ đề smart gốc
        const smartRes = await axios.get(`${hostUrl}/api/sub-smart/${type}/${rawId}.vtt?offset=0`, { timeout: 6000 });
        let vtt = typeof smartRes.data === 'string' ? smartRes.data : '';
        if (vtt && offsetSec !== 0) {
            vtt = subHarvester.shiftVtt(vtt, offsetSec);
        }
        return res.send(vtt || "WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n[Phụ đề đã cân chỉnh]");
    } catch (e) {
        return res.send("WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n[Lỗi đồng bộ phụ đề]");
    }
});

// ==============================================================================
// 🌟 TUYẾN STREAM - GÁN EXTERNAL URL XÚC TÁC TRÌNH DUYỆT TỰ BẬT NHƯ VSMOV
// ==============================================================================
app.get([
    "/stream/:type/:id", "/stream/:type/:id.json",
    "/:options/stream/:type/:id", "/:options/stream/:type/:id.json",
    "/config/:options/stream/:type/:id", "/config/:options/stream/:type/:id.json"
], async (req, res) => {
    try {
        const endpoints = sources.getEndpoints();
        const rawId = req.params.id.replace(".json", "");
        const targetType = req.params.type;
        const config = sources.parseConfig(req.params.options || "");
        const debridKey = config.rd || "";
    const streamCacheKey = `streams_v5_${rawId}_${debridKey ? 'rd' : 'free'}_${config.mode || 'native'}`;
    const cachedStreamList = cache ? cache.get(streamCacheKey) : null;
    if (cachedStreamList && Array.isArray(cachedStreamList) && cachedStreamList.length > 0) {
        return res.json({ streams: cachedStreamList });
    }

    if (rawId.startsWith("jav_")) {
        const streams = await sources.fetchAdultJavStream(rawId);
        if (cache && streams.length > 0) cache.set(streamCacheKey, streams, 1800);
        return res.json({ streams: streams.length > 0 ? streams : [] });
    }

    if (rawId.startsWith("match_") || rawId.startsWith("iptv_") || rawId.startsWith("vmttv_") || rawId.startsWith("vmt_") || rawId.startsWith("scraped_") || targetType === "tv") {
        let streams = await sources.getChannelStreams(rawId, cache, debridKey);
        
        const hostUrl = getHostUrl(req);
        const finalParsedStreams = [];

        streams.forEach(originalSt => {
            const chName = originalSt.channelName || "Kênh Quốc Tế";
            const rawUrl = (originalSt.url || "")
                .replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn")
                .replace("vips-livecdn.fptplay.net", "live.fptplay53.net");

            if (originalSt.isClearkeyFlag && originalSt.kidHex && originalSt.keyHex) {
                const baseUrlTarget = rawUrl.substring(0, rawUrl.lastIndexOf("/") + 1);
                const b64Base = Buffer.from(baseUrlTarget).toString("base64url");
                const proxiedMpdUrl = `${hostUrl}/proxy/dash/${b64Base}/manifest.mpd`;
                const directProxyUrl = `${hostUrl}/proxy-stream?url=${encodeURIComponent(rawUrl)}`;
                const licenseUrl = `${hostUrl}/api/clearkey/${originalSt.kidHex}/${originalSt.keyHex}`;
                const webPlayerUrl = `${hostUrl}/api/player?url=${encodeURIComponent(rawUrl)}&kid=${originalSt.kidHex}&key=${originalSt.keyHex}&name=${encodeURIComponent(chName)}`;

                // 1. TÙY CHỌN 1 (CHUẨN AURAFLIX TV-FLIX): Luồng Direct CDN MPEG-DASH + ClearKey (CORS *, Tốc độ cao nhất)
                finalParsedStreams.push({
                    name: `⚡ [Direct Auraflix CDN] ${chName}`,
                    title: `📺 ${chName}\n💎 Luồng Trực Tiếp CDN MPEG-DASH + ClearKey Chuẩn AuraFlix`,
                    url: rawUrl,
                    isClearkeyFlag: true,
                    kidHex: originalSt.kidHex,
                    keyHex: originalSt.keyHex,
                    fallbackEmbedUrl: webPlayerUrl,
                    behaviorHints: {
                        isLive: true,
                        drm: "clearkey",
                        drmLicenseUri: licenseUrl
                    }
                });

                // 2. TÙY CHỌN 2: Luồng Stream Proxy MPEG-DASH Bẻ Khóa
                finalParsedStreams.push({
                    name: `🛡️ [Proxy Auraflix] ${chName}`,
                    title: `📺 ${chName}\n💎 Stream Proxy MPEG-DASH Vượt Chặn ISP (Tự Động Bẻ Khóa)`,
                    url: proxiedMpdUrl,
                    isClearkeyFlag: true,
                    kidHex: originalSt.kidHex,
                    keyHex: originalSt.keyHex,
                    fallbackEmbedUrl: webPlayerUrl,
                    behaviorHints: {
                        isLive: true,
                        drm: "clearkey",
                        drmLicenseUri: licenseUrl
                    }
                });

                // 3. TÙY CHỌN 3: Chế độ Webview Shaka Player
                finalParsedStreams.push({
                    name: `🌐 [Web Player] Vượt Màn Đen TV`,
                    title: `📺 ${chName}\n⚡ Khởi chạy Webview Shaka Player kèm chìa khóa ClearKey trực tiếp`,
                    externalUrl: webPlayerUrl,
                    embedUrl: webPlayerUrl
                });

                // 4. TÙY CHỌN 4: PIPE URL Thô (Kodi / Nuvio Style)
                finalParsedStreams.push({
                    name: `🔴 [PIPE Kodi] Thô`,
                    title: `📺 ${chName}\n💎 Nhúng Key vào đuôi URL`,
                    url: `${rawUrl}|drmScheme=clearkey&drmLicense=${encodeURIComponent(licenseUrl)}`,
                    isClearkeyFlag: true,
                    kidHex: originalSt.kidHex,
                    keyHex: originalSt.keyHex,
                    behaviorHints: { isLive: true }
                });

            } else if (originalSt.url && (originalSt.url.includes("mytvnet.vn") || originalSt.url.includes("mytvn.net") || originalSt.url.includes(".mpd"))) {
                const baseUrlTarget = rawUrl.substring(0, rawUrl.lastIndexOf("/") + 1);
                const b64Base = Buffer.from(baseUrlTarget).toString("base64url");
                const proxiedUrl = `${hostUrl}/proxy/dash/${b64Base}/manifest.mpd`;
                finalParsedStreams.push({
                    ...originalSt,
                    url: rawUrl,
                    behaviorHints: { isLive: true }
                });
                finalParsedStreams.push({
                    name: `🛡️ [Proxy Auraflix] ${originalSt.name || chName}`,
                    title: `📺 ${chName}\n⚡ Luồng chuyển tiếp qua Stream Proxy Server`,
                    url: proxiedUrl,
                    behaviorHints: { isLive: true }
                });
            } else {
                finalParsedStreams.push({
                    ...originalSt,
                    url: rawUrl || originalSt.url
                });
            }
        });

        // SẮP XẾP LUỒNG DỰA TRÊN TÙY CHỌN CỦA NGƯỜI DÙNG (NATIVE VS WEB PLAYER)
        if (config.mode === "web") {
            finalParsedStreams.sort((a, b) => {
                const aWeb = a.externalUrl ? 1 : 0;
                const bWeb = b.externalUrl ? 1 : 0;
                return bWeb - aWeb;
            });
        }

        if (finalParsedStreams.length > 0) return res.json({ streams: finalParsedStreams });
    }

    const cleanStreamId = rawId.replace(/^viptorrent[_:]/, '');
    const parts = cleanStreamId.split(":");
    let isImdb = cleanStreamId.startsWith("tt");
    let imdbId = isImdb ? parts[0] : null;
    let slug = !isImdb ? parts[0].replace(/^(phim_|custom_|vsmov_|nguonc_|ophim_|xink_)/, '') : "";
    let seasonNum = parts.length >= 3 ? parseInt(parts[1], 10) : 1;
    let targetEpisode = parts.length >= 3 ? parseInt(parts[2], 10) : (parts.length === 2 ? parseInt(parts[1], 10) : null);
    let allStreams = [];
    const seenStreamKeys = new Set();

    const pushUniqueStreams = (streams) => {
        if (!Array.isArray(streams) || streams.length === 0) return;
        streams.forEach(st => {
            if (!st) return;
            const k = `${st.name}_${st.url || st.externalUrl || st.infoHash || ''}`;
            if (!seenStreamKeys.has(k)) {
                seenStreamKeys.add(k);
                allStreams.push(st);
            }
        });
    };

    // TRẦN THỜI GIAN 6.5 GIÂY (6500ms) ĐẢM BẢO QUÉT ĐA NGUỒN CHÉO HOÀN TẤT TRƯỚC TIMEOUT VERCEL 10S
    const SEARCH_HARD_TIMEOUT_MS = 6500;

    const hostUrl = getHostUrl(req);

    // Khởi động song song việc tìm kiếm phụ đề (tiết kiệm 3.5s chờ tuần tự)
    const vietsubPromise = subHarvester.fetchVietsubList(targetType, rawId, hostUrl, cache, []).catch(() => []);

    const executeStreamSearch = async () => {
        if (isImdb) {
            let vipQuery = targetType === "series" && targetEpisode ? `${imdbId}:${seasonNum}:${targetEpisode}` : imdbId;
            pushUniqueStreams(sources.fetchWebAndNuvioMultiEmbedStreams({ imdbId, type: targetType, season: seasonNum, episode: targetEpisode || 1 }));

            const tasks = [
                sources.fetchTorrentio(targetType, imdbId, seasonNum, targetEpisode, debridKey).then(pushUniqueStreams).catch(() => {}),
                sources.fetchVipTorrentHttp(targetType, vipQuery).then(pushUniqueStreams).catch(() => {}),
                sources.fetchVNStream(targetType, rawId).then(pushUniqueStreams).catch(() => {}),
                hdhubSource.fetch4khdhubStreams({ imdbId, type: targetType, season: seasonNum, episode: targetEpisode, hostUrl }).then(pushUniqueStreams).catch(() => {})
            ];

            // 🌟 TÌM KIẾM CHÉO NGUỒN VIỆT NAM & CHÂU Á CHO PHIM QUỐC TẾ (IMDB TT...)
            const cineTask = sources.getCinemetaInfo(targetType, imdbId, cache).then(async (cine) => {
                if (cine?.name) {
                    const cYear = cine.year || null;
                    await Promise.allSettled([
                        sources.fetchAllVnStreamsByTitle(cine.name, cine.name, cYear, targetEpisode, imdbId).then(pushUniqueStreams).catch(() => {}),
                        sources.fetchMainstreamMacCmsStreams(cine.name, cine.name, targetEpisode, cYear).then(pushUniqueStreams).catch(() => {}),
                        hdhubSource.fetch4khdhubStreams({ title: cine.name, year: cYear, imdbId, type: targetType, season: seasonNum, episode: targetEpisode, hostUrl }).then(pushUniqueStreams).catch(() => {})
                    ]);
                }
            }).catch(() => {});
            tasks.push(cineTask);

            await Promise.allSettled(tasks);

            // Fallback chéo giữa Series và Movie nếu luồng VipTorrent/Torrentio của type hiện tại trả về rỗng
            const hasTorrent = allStreams.some(s => (s.name || '').includes('VipTorrent') || (s.name || '').includes('Torrent') || (s.name || '').includes('4KHDHub'));
            if (!hasTorrent) {
                const altType = targetType === "series" ? "movie" : "series";
                const altQuery = altType === "series" ? `${imdbId}:1:1` : imdbId;
                await Promise.allSettled([
                    sources.fetchTorrentio(altType, imdbId, 1, 1, debridKey).then(pushUniqueStreams).catch(() => {}),
                    sources.fetchVipTorrentHttp(altType, altQuery).then(pushUniqueStreams).catch(() => {}),
                    hdhubSource.fetch4khdhubStreams({ imdbId, type: altType, season: 1, episode: 1, hostUrl }).then(pushUniqueStreams).catch(() => {})
                ]);
            }
        } else {
            // MẢNG PHIM VIỆT NAM (phim_... hoặc slug):
            // 1. Kiểm tra cache mã IMDb đã lưu từ trước để kích hoạt nguồn quốc tế (VipTorrent, Torrentio, 4KHDHub) NGAY LẬP TỨC
            const slugCacheKey = `slug_to_imdb_v4_${slug}`;
            let cachedImdb = cache ? cache.get(slugCacheKey) : null;

            let resolvedMovieObj = null;
            let movieMetadataResolve = null;
            const metadataReadyPromise = new Promise(r => { movieMetadataResolve = r; });

            // 2. Chạy đồng thời toàn bộ các nhà cung cấp Việt Nam qua slug (< 800ms)
            const vnScrapers = [
                sources.fetchKKPhim(slug, targetEpisode).then(res => {
                    if (res?.streams) pushUniqueStreams(res.streams);
                    if (res?.movie && !resolvedMovieObj) { resolvedMovieObj = res.movie; movieMetadataResolve(res.movie); }
                }).catch(() => {}),
                sources.fetchVNStream(targetType, rawId).then(pushUniqueStreams).catch(() => {}),
                sources.fetchVSMOV(slug, targetEpisode).then(res => {
                    if (res?.streams) pushUniqueStreams(res.streams);
                    if (res?.movie && !resolvedMovieObj) { resolvedMovieObj = res.movie; movieMetadataResolve(res.movie); }
                }).catch(() => {}),
                sources.fetchNguonC(slug, targetEpisode).then(res => {
                    if (res?.streams) pushUniqueStreams(res.streams);
                    if (res?.movie && !resolvedMovieObj) { resolvedMovieObj = res.movie; movieMetadataResolve(res.movie); }
                }).catch(() => {}),
                sources.fetchOPhim(slug, targetEpisode).then(res => {
                    if (res?.streams) pushUniqueStreams(res.streams);
                    if (res?.movie && !resolvedMovieObj) { resolvedMovieObj = res.movie; movieMetadataResolve(res.movie); }
                }).catch(() => {}),
                sources.fetchXink(slug, targetEpisode).then(res => {
                    if (res?.streams) pushUniqueStreams(res.streams);
                    if (res?.movie && !resolvedMovieObj) { resolvedMovieObj = res.movie; movieMetadataResolve(res.movie); }
                }).catch(() => {})
            ];

            if (Array.isArray(endpoints.customMovieApis) && endpoints.customMovieApis.length > 0) {
                endpoints.customMovieApis.forEach(cUrl => {
                    vnScrapers.push(
                        sources.fetchFromCustomApi(cUrl, slug, targetEpisode).then(res => {
                            if (res?.streams) pushUniqueStreams(res.streams);
                            if (res?.movie && !resolvedMovieObj) { resolvedMovieObj = res.movie; movieMetadataResolve(res.movie); }
                        }).catch(() => {})
                    );
                });
            }

            // 3. 🌟 TÌM KIẾM CHÉO TOÀN BỘ NGUỒN VIỆT NAM THEO TÊN PHIM + CHÂU Á MACCMS + QUỐC TẾ (VIPTORRENT, TORRENTIO, 4KHDHUB, CLOUD EMBED)
            const internationalTask = (async () => {
                let imdbFound = cachedImdb;
                let mObj = await Promise.race([
                    metadataReadyPromise,
                    new Promise(r => setTimeout(() => r(null), 1400))
                ]);

                const activeMovie = mObj || resolvedMovieObj;
                if (!imdbFound && activeMovie) {
                    if (activeMovie.imdb?.id && String(activeMovie.imdb.id).startsWith("tt")) imdbFound = String(activeMovie.imdb.id);
                    else if (activeMovie.imdb?.id && /^\d+$/.test(String(activeMovie.imdb.id))) imdbFound = `tt${activeMovie.imdb.id}`;
                    else if (activeMovie.imdb_id && String(activeMovie.imdb_id).startsWith("tt")) imdbFound = String(activeMovie.imdb_id);
                    else if (activeMovie.imdb_id && /^\d+$/.test(String(activeMovie.imdb_id))) imdbFound = `tt${activeMovie.imdb_id}`;
                }

                const tmdbId = activeMovie?.tmdb?.id ? String(activeMovie.tmdb.id) : "";
                const tmdbSeason = activeMovie?.tmdb?.season ? Number(activeMovie.tmdb.season) : seasonNum;
                const movieYear = activeMovie?.year || null;
                const origTitle = activeMovie?.origin_name || activeMovie?.original_name || slug.replace(/[-_]/g, ' ');
                const title = activeMovie?.name || origTitle;

                // Khởi chạy ngay bộ nguồn Cloud Multi-Server Quốc Tế (tương thích cả Web Iframe lẫn Nuvio Webview)
                if (tmdbId || imdbFound) {
                    pushUniqueStreams(
                        sources.fetchWebAndNuvioMultiEmbedStreams({
                            imdbId: imdbFound,
                            tmdbId,
                            type: targetType,
                            season: tmdbSeason || seasonNum,
                            episode: targetEpisode || 1,
                            title: title || origTitle
                        })
                    );
                }

                const intPromises = [];

                if (origTitle || title) {
                    intPromises.push(
                        // Quét chéo cả 5 kho phim Việt Nam bằng Tên Tiếng Việt + Tên Gốc (phòng trường hợp lệch slug giữa KKPhim, OPhim, NguonC, VSMOV, Xink)
                        sources.fetchAllVnStreamsByTitle(title, origTitle, movieYear, targetEpisode, imdbFound || tmdbId)
                            .then(pushUniqueStreams)
                            .catch(() => {}),
                        // Đua đa gương 9 máy chủ Châu Á (BaoFeng, LiangZi, SuBo, TianKong, iKun, FeiSu, Kuaiche, XinLang, Modu)
                        sources.fetchMainstreamMacCmsStreams(origTitle, title, targetEpisode, movieYear)
                            .then(pushUniqueStreams)
                            .catch(() => {}),
                        hdhubSource.fetch4khdhubStreams({ title: origTitle || title, year: movieYear, type: targetType, season: seasonNum, episode: targetEpisode, hostUrl })
                            .then(pushUniqueStreams)
                            .catch(() => {})
                    );
                }

                // Nếu chưa có IMDb ID thì dò Cinemeta song song không chặn các luồng trên
                if (!imdbFound && (origTitle || title)) {
                    intPromises.push((async () => {
                        try {
                            let resolvedImdb = null;
                            if (origTitle) {
                                resolvedImdb = await sources.getImdbFromTitle(targetType, origTitle, movieYear, cache);
                            }
                            if (!resolvedImdb && title && title !== origTitle) {
                                resolvedImdb = await sources.getImdbFromTitle(targetType, title, movieYear, cache);
                            }
                            if (resolvedImdb && resolvedImdb.startsWith("tt")) {
                                imdbFound = resolvedImdb;
                                if (cache) cache.set(slugCacheKey, imdbFound, 86400 * 7);
                                if (!tmdbId) {
                                    pushUniqueStreams(
                                        sources.fetchWebAndNuvioMultiEmbedStreams({
                                            imdbId: imdbFound,
                                            tmdbId: "",
                                            type: targetType,
                                            season: seasonNum,
                                            episode: targetEpisode || 1,
                                            title: title || origTitle
                                        })
                                    );
                                }
                                const vQuery = targetType === "series" && targetEpisode ? `${imdbFound}:${seasonNum}:${targetEpisode}` : imdbFound;
                                await Promise.allSettled([
                                    sources.fetchTorrentio(targetType, imdbFound, seasonNum, targetEpisode, debridKey).then(pushUniqueStreams).catch(() => {}),
                                    sources.fetchVipTorrentHttp(targetType, vQuery).then(pushUniqueStreams).catch(() => {}),
                                    hdhubSource.fetch4khdhubStreams({ imdbId: imdbFound, type: targetType, season: seasonNum, episode: targetEpisode, hostUrl }).then(pushUniqueStreams).catch(() => {})
                                ]);
                            }
                        } catch (e) {}
                    })());
                }

                const customApis = endpoints.customMovieApis || [];
                if (customApis.length > 0) {
                    for (const customUrl of customApis) {
                        intPromises.push(
                            sources.fetchFromCustomApi(customUrl, slug, targetEpisode, title, origTitle)
                                .then(res => {
                                    if (res?.streams) pushUniqueStreams(res.streams);
                                    else if (Array.isArray(res)) pushUniqueStreams(res);
                                })
                                .catch(() => {})
                        );
                    }
                }

                // Khi có sẵn mã IMDb: Kéo toàn bộ nguồn quốc tế VipTorrent, Torrentio & 4KHDHub ngay lập tức
                if (imdbFound && imdbFound.startsWith("tt")) {
                    if (cache) cache.set(slugCacheKey, imdbFound, 86400 * 7);
                    const vQuery = targetType === "series" && targetEpisode ? `${imdbFound}:${seasonNum}:${targetEpisode}` : imdbFound;
                    
                    const torrentTasks = [
                        sources.fetchTorrentio(targetType, imdbFound, seasonNum, targetEpisode, debridKey).then(pushUniqueStreams).catch(() => {}),
                        sources.fetchVipTorrentHttp(targetType, vQuery).then(pushUniqueStreams).catch(() => {}),
                        hdhubSource.fetch4khdhubStreams({ imdbId: imdbFound, type: targetType, season: seasonNum, episode: targetEpisode, hostUrl }).then(pushUniqueStreams).catch(() => {})
                    ];
                    intPromises.push(...torrentTasks);
                }

                await Promise.allSettled(intPromises);
            })();

            // Chạy đồng thời cả nguồn VN và Quốc Tế
            await Promise.allSettled([
                Promise.allSettled(vnScrapers),
                internationalTask
            ]);
        }
    };

    // ÁP DỤNG TRẦN THỜI GIAN CỨNG 6.5 GIÂY CHO TOÀN BỘ QUÁ TRÌNH TÌM KIẾM ĐA NGUỒN
    await Promise.race([
        executeStreamSearch(),
        new Promise(resolve => setTimeout(resolve, SEARCH_HARD_TIMEOUT_MS))
    ]);

    // Lấy kết quả phụ đề đã chạy song song từ trước
    let vietsubTracks = [];
    try {
        vietsubTracks = await Promise.race([
            vietsubPromise,
            new Promise(r => setTimeout(() => r([]), 3000))
        ]);
    } catch (e) {}

    const enrichedStreams = subHarvester.injectSubtitlesIntoStreams(allStreams, targetType, rawId, hostUrl, vietsubTracks);
    const finalStreams = sources.sortStreamsByNewRule(enrichedStreams);

    // 🛡️ ANTI-403 PROXY CHO NGUONC / STREAMC & TẠO LUỒNG PROXY HLS CHỐNG CHẶN CORS CHO TRÌNH PHÁT WEB + NUVIO
    const proxyCompanionStreams = [];
    finalStreams.forEach(st => {
        if (!st || !st.url) return;
        if ((st.url.includes("nguonc") || st.url.includes("streamc") || st.url.includes("phim.nguonc.com")) && !st.url.includes("/proxy/hls")) {
            st.url = `${hostUrl}/proxy/hls?url=${encodeURIComponent(st.url)}&ref=${encodeURIComponent("https://phim.nguonc.com/")}`;
        } else if ((st.name?.includes("4KHDHub") || st.name?.includes("HubDrive")) && (st.url.includes("cloudflarestorage.com") || st.url.includes("hubcloud") || st.url.includes("workers.dev")) && !st.url.includes("/proxy/stream")) {
            const rawTitle = (st.title || "").split("\n")[0] || "video.mkv";
            const safeName = rawTitle.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '.').replace(/\.+/g, '.');
            const cleanName = safeName.endsWith(".mkv") || safeName.endsWith(".mp4") ? safeName : `${safeName}.mkv`;
            const sz = st.behaviorHints?.videoSize || 0;
            st.url = `${hostUrl}/proxy/stream/${encodeURIComponent(cleanName)}?url=${encodeURIComponent(st.url)}&size=${sz}`;
            if (st.behaviorHints) {
                st.behaviorHints.notWebReady = true;
                if (!st.behaviorHints.filename) st.behaviorHints.filename = cleanName;
            }
        } else if (st.url.includes(".m3u8") && !st.url.includes("/proxy/") && proxyCompanionStreams.length < 4) {
            const ref = st.behaviorHints?.proxyHeaders?.request?.Referer || "https://phimapi.com/";
            proxyCompanionStreams.push({
                ...st,
                name: `${st.name} • [Proxy Anti-Block]`,
                title: `${(st.title || "").split("\n")[0]}\n🛡️ Luồng Qua Proxy Vượt Tường Lửa ISP (Web & Nuvio)`,
                url: `${hostUrl}/proxy/hls?url=${encodeURIComponent(st.url)}&ref=${encodeURIComponent(ref)}`
            });
        }
    });

    const mergedFinalStreams = sources.sortStreamsByNewRule([...finalStreams, ...proxyCompanionStreams]);

    // Giới hạn 40 luồng chất lượng cao nhất để Web Player, Nuvio Mobile và TV tải siêu tốc
    const curatedStreams = mergedFinalStreams.slice(0, 40);

    if (cache && curatedStreams.length > 0) {
        cache.set(streamCacheKey, curatedStreams, 1800); // 30 phút micro-cache
    }
    return res.json({ streams: curatedStreams });
    } catch (err) {
        console.error("Stream route error:", err);
        return res.json({ streams: [] });
    }
});

// ==============================================================================
// ⚡ ENDPOINT REAL-TIME / PROGRESSIVE STREAMING (SERVER-SENT EVENTS - SSE)
// Hiển thị ngay lập tức khi tìm thấy luồng phát mà không cần đợi toàn bộ quá trình
// ==============================================================================
app.get([
    "/api/stream-live/:type/:id",
    "/:options/api/stream-live/:type/:id",
    "/config/:options/api/stream-live/:type/:id"
], async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const rawId = req.params.id.replace(".json", "");
    const targetType = req.params.type;
    const config = sources.parseConfig(req.params.options || "");
    const debridKey = config.rd || "";
    const cleanStreamId = rawId.replace(/^viptorrent[_:]/, '');
    const parts = cleanStreamId.split(":");
    let isImdb = cleanStreamId.startsWith("tt");
    let imdbId = isImdb ? parts[0] : null;
    let slug = !isImdb ? parts[0].replace(/^(phim_|custom_|vsmov_|nguonc_|ophim_|xink_)/, '') : "";
    let seasonNum = parts.length >= 3 ? parseInt(parts[1], 10) : 1;
    let targetEpisode = parts.length >= 3 ? parseInt(parts[2], 10) : (parts.length === 2 ? parseInt(parts[1], 10) : null);

    const protocol = req.headers['x-forwarded-proto'] || (req.get('host')?.includes('localhost') ? 'http' : 'https');
    const hostUrl = `${protocol}://${req.get('host')}`;

    const seenLive = new Set();
    const emitStreams = (providerName, streamList) => {
        if (!Array.isArray(streamList) || streamList.length === 0) return;
        const fresh = [];
        streamList.forEach(st => {
            const k = `${st.name}_${st.url || st.externalUrl || st.infoHash || ''}`;
            if (!seenLive.has(k)) {
                seenLive.add(k);
                fresh.push(st);
            }
        });
        if (fresh.length > 0) {
            const enriched = subHarvester.injectSubtitlesIntoStreams(fresh, targetType, rawId, hostUrl, []);
            res.write(`data: ${JSON.stringify({ type: "stream", provider: providerName, count: enriched.length, streams: enriched })}\n\n`);
        }
    };

    const liveTimeout = setTimeout(() => {
        res.write(`data: ${JSON.stringify({ type: "done", reason: "timeout_10s", total: seenLive.size })}\n\n`);
        res.end();
    }, 10000);

    try {
        if (isImdb) {
            let vipQuery = targetType === "series" && targetEpisode ? `${imdbId}:${seasonNum}:${targetEpisode}` : imdbId;
            await Promise.allSettled([
                sources.fetchTorrentio(targetType, imdbId, seasonNum, targetEpisode, debridKey).then(st => emitStreams("Torrentio", st)).catch(() => {}),
                sources.fetchVipTorrentHttp(targetType, vipQuery).then(st => emitStreams("VipTorrent", st)).catch(() => {}),
                hdhubSource.fetch4khdhubStreams({ imdbId, type: targetType, season: seasonNum, episode: targetEpisode, hostUrl }).then(st => emitStreams("4KHDHub", st)).catch(() => {}),
                sources.fetchVNStream(targetType, rawId).then(st => emitStreams("VNStream", st)).catch(() => {})
            ]);
            const cine = await sources.getCinemetaInfo(targetType, imdbId, cache);
            if (cine?.name) {
                await Promise.allSettled([
                    sources.fetchAllVnStreamsByTitle(cine.name, cine.name, cine.year, targetEpisode, imdbId).then(st => emitStreams("Vietnam Direct", st)).catch(() => {}),
                    sources.fetchMainstreamMacCmsStreams(cine.name, cine.name, targetEpisode, cine.year).then(st => emitStreams("Asia CDN", st)).catch(() => {})
                ]);
            }
        } else {
            const slugCacheKey = `slug_to_imdb_v4_${slug}`;
            let cachedImdb = cache ? cache.get(slugCacheKey) : null;
            let movieMeta = null;

            const vnTasks = [
                sources.fetchKKPhim(slug, targetEpisode).then(res => {
                    if (res?.streams) emitStreams("KKPhim", res.streams);
                    if (res?.movie && !movieMeta) movieMeta = res.movie;
                }).catch(() => {}),
                sources.fetchVSMOV(slug, targetEpisode).then(res => {
                    if (res?.streams) emitStreams("VSMOV", res.streams);
                    if (res?.movie && !movieMeta) movieMeta = res.movie;
                }).catch(() => {}),
                sources.fetchNguonC(slug, targetEpisode).then(res => {
                    if (res?.streams) emitStreams("NguonC", res.streams);
                    if (res?.movie && !movieMeta) movieMeta = res.movie;
                }).catch(() => {}),
                sources.fetchOPhim(slug, targetEpisode).then(res => {
                    if (res?.streams) emitStreams("OPhim", res.streams);
                    if (res?.movie && !movieMeta) movieMeta = res.movie;
                }).catch(() => {}),
                sources.fetchXink(slug, targetEpisode).then(res => {
                    if (res?.streams) emitStreams("Xink", res.streams);
                    if (res?.movie && !movieMeta) movieMeta = res.movie;
                }).catch(() => {})
            ];

            await Promise.allSettled(vnTasks);

            let imdbIdFinal = cachedImdb;
            if (!imdbIdFinal && movieMeta) {
                if (movieMeta.imdb?.id) imdbIdFinal = String(movieMeta.imdb.id);
                else if (movieMeta.imdb_id) imdbIdFinal = String(movieMeta.imdb_id);
                if (imdbIdFinal && /^\d+$/.test(imdbIdFinal)) imdbIdFinal = `tt${imdbIdFinal}`;
                if (!imdbIdFinal && (movieMeta.origin_name || movieMeta.name)) {
                    imdbIdFinal = await sources.getImdbFromTitle(targetType, movieMeta.origin_name || movieMeta.name, movieMeta.year, cache);
                }
            }

            if (imdbIdFinal && imdbIdFinal.startsWith("tt")) {
                if (cache) cache.set(slugCacheKey, imdbIdFinal, 86400 * 7);
                const vQuery = targetType === "series" && targetEpisode ? `${imdbIdFinal}:${seasonNum}:${targetEpisode}` : imdbIdFinal;
                await Promise.allSettled([
                    sources.fetchTorrentio(targetType, imdbIdFinal, seasonNum, targetEpisode, debridKey).then(st => emitStreams("Torrentio", st)).catch(() => {}),
                    sources.fetchVipTorrentHttp(targetType, vQuery).then(st => emitStreams("VipTorrent", st)).catch(() => {}),
                    hdhubSource.fetch4khdhubStreams({ imdbId: imdbIdFinal, type: targetType, season: seasonNum, episode: targetEpisode, hostUrl }).then(st => emitStreams("4KHDHub", st)).catch(() => {})
                ]);
            }
        }
    } catch (e) {}

    clearTimeout(liveTimeout);
    res.write(`data: ${JSON.stringify({ type: "done", total: seenLive.size })}\n\n`);
    res.end();
});

app.get("/api/health-check", async (req, res) => { res.json({ success: true, status: "PRO 4.1 Filter Regex Anti-6008 Ready!" }); });

// ENDPOINT BÁO CÁO VÀ KÍCH HOẠT LÀM MỚI BOT HARVESTER & CLEARKEY
app.get("/api/bot/status", (req, res) => {
    res.json({
        success: true,
        telemetry: sources.botSyncTelemetry || {}
    });
});

// ENDPOINT AI SOURCE FINDER & TỰ PHỤC HỒI TOÀN BỘ
app.get("/api/ai/heal", async (req, res) => {
    try {
        const aiHealer = require("../ai-source-finder");
        const result = await aiHealer.runSelfHealingCycle();
        if (cache) cache.del("unified_tv_channels");
        res.json({
            success: true,
            message: "Chu trình AI Dò Tìm & Tự Phục Hồi hoàn tất thành công!",
            result
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/api/ai/health", (req, res) => {
    try {
        const aiHealer = require("../ai-source-finder");
        res.json({
            success: true,
            matrix: aiHealer.systemHealthMatrix,
            botTelemetry: sources.botSyncTelemetry
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ==============================================================================
// 🌟 DYNAMIC URL SCRAPER & NETWORK INTERCEPTION API
// Bắt gói tin luồng media (.mpd, .m3u8, .mp4) bằng Headless Chromium
// ==============================================================================

// Bắt đầu quét mạng động cho một URL bất kỳ
app.post("/api/scraper/start", async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string" || !url.startsWith("http")) {
        return res.status(400).json({ success: false, error: "Vui lòng cung cấp URL hợp lệ (bắt đầu với http:// hoặc https://)" });
    }

    const currentJob = scraper.getCurrentScrapeJob();
    if (currentJob.status === "running") {
        return res.status(409).json({ success: false, error: "Đang có một tiến trình quét mạng đang chạy. Vui lòng đợi phiên hiện tại hoàn thành." });
    }

    // Khởi động tiến trình quét nền không chặn HTTP
    scraper.scrapeDynamicUrl(url).then(result => {
        if (cache) cache.del("unified_tv_channels");
    }).catch(err => {
        console.error("[SCRAPER API] Lỗi quét nền:", err.message);
    });

    res.json({
        success: true,
        message: "Đã khởi động tiến trình quét mạng Puppeteer!",
        targetUrl: url,
        status: "running"
    });
});

// Trạng thái trực tiếp của phiên quét
app.get("/api/scraper/status", (req, res) => {
    res.json({
        success: true,
        job: scraper.getCurrentScrapeJob()
    });
});

// Lấy danh sách các luồng đã thu thập
app.get("/api/scraped-streams", (req, res) => {
    const streams = scraper.loadScrapedStreams();
    res.json({
        success: true,
        count: streams.length,
        streams
    });
});

// Kiểm tra độ trễ luồng
app.post("/api/scraped-streams/test", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "Thiếu url luồng" });
    const result = await scraper.testStreamLatency(url);
    res.json({ success: true, result });
});

// Xóa một luồng đã thu thập
app.post("/api/scraped-streams/delete", (req, res) => {
    const { id, url } = req.body;
    let streams = scraper.loadScrapedStreams();
    const initialCount = streams.length;
    streams = streams.filter(s => s.id !== id && s.streamUrl !== url);
    scraper.saveScrapedStreams(streams);
    if (cache) cache.del("unified_tv_channels");
    res.json({ success: true, removed: initialCount - streams.length, count: streams.length });
});

// Xóa toàn bộ danh sách luồng đã thu thập
app.post("/api/scraped-streams/clear", (req, res) => {
    scraper.saveScrapedStreams([]);
    if (cache) cache.del("unified_tv_channels");
    res.json({ success: true, count: 0 });
});

// Kích hoạt thủ công Harvester Auraflix định kỳ
app.post("/api/scraper/crawl", async (req, res) => {
    const crawlerState = scraper.getAuraflixCrawlerState();
    if (crawlerState.isRunning) {
        return res.status(409).json({ success: false, error: "Harvester Auraflix đang chạy. Vui lòng đợi trong giây lát." });
    }

    scraper.crawlAuraflix().then(resCrawl => {
        if (cache) cache.del("unified_tv_channels");
    }).catch(err => {
        console.error("[CRAWL API] Lỗi cào Auraflix:", err.message);
    });

    res.json({
        success: true,
        message: "Đã kích hoạt chu kỳ quét Auraflix!",
        status: "running"
    });
});

// Kích hoạt bóc tách Bộ chọn Kênh Live TV trên Auraflix
app.post("/api/scraper/auraflix-live", async (req, res) => {
    const currentJob = scraper.getCurrentScrapeJob();
    if (currentJob.status === "running") {
        return res.status(409).json({ success: false, error: "Đang có tiến trình quét đang chạy. Vui lòng đợi phiên hiện tại hoàn thành." });
    }

    scraper.scrapeAuraflixLiveTv().then(resLive => {
        if (cache) cache.del("unified_tv_channels");
    }).catch(err => {
        console.error("[AURAFLIX LIVE API] Lỗi quét bộ chọn TV:", err.message);
    });

    res.json({
        success: true,
        message: "Đã khởi động tiến trình quét Bộ Chọn Kênh Truyền Hình (Live TV Selectors) trên Auraflix!",
        targetUrl: "https://auraflix.vip",
        status: "running"
    });
});

// Trạng thái của Harvester Auraflix định kỳ
app.get("/api/scraper/crawler-status", (req, res) => {
    res.json({
        success: true,
        crawler: scraper.getAuraflixCrawlerState()
    });
});

// ==============================================================================
// 🌟 SEPARATE DATABASE COLLECTIONS API (LIVE TV & MOVIE VOD)
// Quản lý riêng biệt 2 CSDL: CSDL Kênh Truyền Hình & CSDL Kho Phim
// ==============================================================================

// Thống kê & tổng quan 2 CSDL độc lập
app.get("/api/database/collections", (req, res) => {
    const liveChannels = scraper.loadLiveTvCollection();
    const movies = scraper.loadMovieCollection();
    const allStreams = scraper.loadScrapedStreams();

    res.json({
        success: true,
        stats: {
            totalLiveTv: liveChannels.length,
            totalMovies: movies.length,
            totalScrapedStreams: allStreams.length
        },
        liveTvSample: liveChannels.slice(0, 10),
        moviesSample: movies.slice(0, 10)
    });
});

// Lấy danh mục CSDL Kênh Truyền Hình độc lập
app.get("/api/database/live-tv", (req, res) => {
    const channels = scraper.loadLiveTvCollection();
    res.json({
        success: true,
        category: "tv",
        categoryLabel: "📺 CSDL Kênh Truyền Hình Trực Tiếp",
        total: channels.length,
        channels
    });
});

// Lấy danh mục CSDL Kho Phim độc lập
app.get("/api/database/movies", (req, res) => {
    const movies = scraper.loadMovieCollection();
    res.json({
        success: true,
        category: "vod",
        categoryLabel: "🎬 CSDL Kho Phim / VOD",
        total: movies.length,
        movies
    });
});

// ==============================================================================
// 🌟 LIVE TV HEALTH-CHECK & STREAMING ENDPOINTS
// Giám sát ping định kỳ & phân loại kênh phục vụ xem trực tiếp .mpd
// ==============================================================================
const liveTvHealth = require("../live-tv-health");

// Danh sách kênh Live TV đã phân loại và gắn trạng thái Active
app.get("/api/live-tv/channels", (req, res) => {
    const activeOnly = req.query.activeOnly === "true" || req.query.activeOnly === "1";
    const statusFilter = req.query.statusFilter || req.query.status || (activeOnly ? "working" : "all");
    const category = req.query.category || "all";
    const data = liveTvHealth.getFormattedLiveChannels(statusFilter, category);

    res.json({
        success: true,
        total: data.total,
        activeCount: data.activeCount,
        channels: data.channels,
        telemetry: data.telemetry
    });
});

// Kích hoạt thủ công chu trình Ping Health-Check toàn bộ kênh .mpd
app.post("/api/live-tv/health-check", async (req, res) => {
    try {
        const result = await liveTvHealth.runLiveTvHealthCheck();
        if (cache) cache.del("unified_tv_channels");
        res.json({
            success: true,
            result
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Trạng thái telemetry của bộ giám sát Health-Check
app.get("/api/live-tv/health-status", (req, res) => {
    res.json({
        success: true,
        telemetry: liveTvHealth.getHealthTelemetry()
    });
});

// Ping kiểm tra nhanh một luồng MPD đơn lẻ
app.post("/api/live-tv/ping", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "Thiếu url luồng" });
    const result = await liveTvHealth.pingMpdUrl(url);
    res.json({ success: true, result });
});

// ==============================================================================
// 🎬 MOVIE API ENDPOINTS CONFIGURATION (xink.pro & Custom Sources)
// ==============================================================================
app.get("/api/settings/movie-source", (req, res) => {
    res.json({
        success: true,
        endpoints: sources.getEndpoints()
    });
});

app.post("/api/settings/movie-source", (req, res) => {
    const { url, urls } = req.body;
    try {
        const filePath = path.join(__dirname, "../api_endpoints.json");
        let data = {};
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }

        let urlList = [];
        if (Array.isArray(urls) && urls.length > 0) {
            urlList = urls.map(u => String(u).trim().replace(/\/+$/, '')).filter(u => u.startsWith("http"));
        } else if (url && typeof url === "string" && url.trim()) {
            urlList = url.split(/[\s,;]+/).map(u => u.trim().replace(/\/+$/, '')).filter(u => u.startsWith("http"));
        }

        if (urlList.length > 0) {
            data.customMovieApis = urlList;
            data.customMovieApi = urlList[0];
            const xinkUrl = urlList.find(u => u.includes("xink.pro"));
            if (xinkUrl) data.xink = xinkUrl;
        } else {
            delete data.customMovieApis;
            delete data.customMovieApi;
        }
        data.lastUpdated = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        res.json({
            success: true,
            message: `Đã lưu và tích hợp ${urlList.length} nguồn phim API vào hệ thống!`,
            endpoints: sources.getEndpoints()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Kiểm tra trực tiếp độ phản hồi & cấu trúc dữ liệu của nguồn phim API mới
app.post("/api/settings/test-movie-api", async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
        return res.status(400).json({ success: false, error: "Thiếu URL nguồn API phim cần kiểm tra!" });
    }
    try {
        const testResult = await sources.testCustomMovieApi(url);
        res.json(testResult);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * ⚡ TỰ ĐỘNG LÀM ẤM (PRE-WARM) VÀ DUY TRÌ BỘ ĐỆM CACHE CHO CÁC CATALOG PHỔ BIẾN NHẤT
 * Đảm bảo Nuvio và Stremio khi mở lên nhận dữ liệu catalog ngay tức khắc (0-15ms)
 */
const prewarmTopCatalogs = async () => {
    try {
        const topCatalogs = [
            { type: "movie", id: "cat_phim_moi_cap_nhat", pages: 2 },
            { type: "movie", id: "cat_phim_le", pages: 2 },
            { type: "series", id: "cat_phim_bo", pages: 2 },
            { type: "series", id: "cat_hoat_hinh_anime", pages: 2 },
            { type: "movie", id: "cat_phim_le_thuyet_minh", pages: 2 },
            { type: "movie", id: "the_loai_hanh_dong", pages: 1 },
            { type: "movie", id: "quoc_gia_han_quoc", pages: 1 },
            { type: "movie", id: "quoc_gia_trung_quoc", pages: 1 },
            { type: "movie", id: "quoc_gia_au_my", pages: 1 }
        ];

        // Khởi động đồng thời cả kênh TV
        sources.fetchUnifiedTvChannels(cache).catch(() => {});

        const endpoints = sources.getEndpoints();
        await Promise.allSettled(topCatalogs.map(async (cat) => {
            const normalizedId = cat.id.replace(/^cat[_-]/, '').replace(/_/g, '-');
            const catItem = sources.ALL_CATALOGS.find(c =>
                c.id === normalizedId ||
                c.id === cat.id ||
                `cat_${c.id.replace(/-/g, '_')}` === cat.id ||
                c.id.replace(/-/g, '_') === cat.id
            );
            let apiPath = catItem?.apiPath || "danh-sach/phim-moi-cap-nhat";
            if (cat.id.startsWith("the_loai_")) {
                apiPath = `the-loai/${cat.id.replace(/^the_loai_/, '').replace(/_/g, '-')}`;
            } else if (cat.id.startsWith("quoc_gia_")) {
                apiPath = `quoc-gia/${cat.id.replace(/^quoc_gia_/, '').replace(/_/g, '-')}`;
            }

            for (let pg = 1; pg <= cat.pages; pg++) {
                const key = `cat_v8_${cat.id}_${cat.type}_${pg}__`;
                if (cache.get(key)) continue;

                try {
                    let items = [];
                    if (apiPath === "danh-sach/phim-moi-cap-nhat") {
                        const startPg = (pg - 1) * 3 + 1;
                        const [r1, r2, r3] = await Promise.all([
                            axios.get(`${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${startPg}`, { timeout: 3000 }).catch(() => null),
                            axios.get(`${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${startPg + 1}`, { timeout: 3000 }).catch(() => null),
                            axios.get(`${endpoints.kkphim}/danh-sach/phim-moi-cap-nhat?page=${startPg + 2}`, { timeout: 3000 }).catch(() => null)
                        ]);
                        items = [
                            ...(r1?.data?.data?.items || r1?.data?.items || []),
                            ...(r2?.data?.data?.items || r2?.data?.items || []),
                            ...(r3?.data?.data?.items || r3?.data?.items || [])
                        ];
                    } else if (normalizedId === "phim-le" && pg === 1) {
                        const [r1, r2] = await Promise.all([
                            axios.get(`${endpoints.kkphim}/v1/api/${apiPath}?page=1&limit=24`, { timeout: 3000 }).catch(() => null),
                            axios.get(`${endpoints.kkphim}/v1/api/${apiPath}?page=2&limit=24`, { timeout: 3000 }).catch(() => null)
                        ]);
                        items = [
                            ...(r1?.data?.data?.items || r1?.data?.items || []),
                            ...(r2?.data?.data?.items || r2?.data?.items || [])
                        ];
                    } else {
                        const url = `${endpoints.kkphim}/v1/api/${apiPath}?page=${pg}&limit=24`;
                        const res = await axios.get(url, { timeout: 3000 }).catch(() => null);
                        items = res?.data?.data?.items || res?.data?.items || [];
                    }

                    if (items.length > 0) {
                        const targetCount = items.length >= 24 ? 24 : (items.length >= 6 ? Math.floor(items.length / 6) * 6 : items.length);
                        const metas = items.slice(0, targetCount).map(phim => {
                            const inferredType =
                                phim.type === "series" ||
                                (phim.episode_current && /tập\s*\d+/i.test(phim.episode_current) && !/full/i.test(phim.episode_current))
                                    ? "series"
                                    : cat.type;
                            return {
                                id: `phim_${phim.slug}`,
                                type: inferredType,
                                name: phim.name,
                                poster: sources.getImgUrl(phim.poster_url || phim.thumb_url),
                                background: sources.getImgUrl(phim.thumb_url || phim.poster_url),
                                description: `${phim.origin_name || ""} • Năm: ${phim.year || "N/A"}`,
                                originName: phim.origin_name || phim.original_name || "",
                                year: phim.year ? String(phim.year) : "2026",
                                episodeCurrent: phim.episode_current || (inferredType === "series" ? "Tập Mới" : "FULL"),
                                quality: phim.quality || "FHD",
                                lang: phim.lang || "Vietsub",
                                tmdbVote: phim.tmdb?.vote_average ? Number(phim.tmdb.vote_average).toFixed(1) : "8.2",
                                posterShape: "landscape"
                            };
                        });
                        cache.set(key, metas, 43200);
                        cache.set(`${key}_pag`, { currentPage: pg, totalPages: 2538 }, 43200);
                    }
                } catch (err) {}
            }
        }));
    } catch (e) {}
};

app.prewarmTopCatalogs = prewarmTopCatalogs;
// Tự động làm ấm toàn bộ catalog chính ngay khi khởi động server để mở lần đầu hiển thị tức thì (< 10ms)
setTimeout(() => {
    prewarmTopCatalogs().catch(() => {});
}, 50);

if (require.main === module) { const PORT = process.env.PORT || 3000; const HOST = "0.0.0.0"; app.listen(PORT, HOST, () => { console.log(`Running on http://${HOST}:${PORT}`); }); }
module.exports = app;


