/**
 * TUNGNUI PRO 3.1 - BOT HARVESTER & TELEGRAM CANARY
 * - Quét Ping bảo lưu 100% kênh Việt Nam (Anti Geo-Block)
 * - Tự động nạp 3 nguồn Tivi cực mạnh: TQS, Coban66, Tinhlagi
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const scanTelegramCanary = async () => {
    console.log("🕵️ [TELEGRAM CANARY] Đang quét kênh truy tìm tên miền mới...");
    const newDomains = { kkphim: [], vsmov: [], nguonc: [] };
    const channels = [ { id: 'vsmov', url: 'https://t.me/s/vsmov_channel' }, { id: 'kkphim', url: 'https://t.me/s/phimapi' }, { id: 'nguonc', url: 'https://t.me/s/nguonccom' } ];
    for (const ch of channels) {
        try {
            const res = await axios.get(ch.url, { timeout: 3000 });
            const matches = res.data.match(/https:\/\/[a-zA-Z0-9-]+\.[a-zA-Z]+\/api/g) || [];
            matches.forEach(link => { if (!newDomains[ch.id].includes(link)) newDomains[ch.id].push(link); });
        } catch (e) {}
    }
    return newDomains;
};

const DOMAIN_CANDIDATES = {
    kkphim: ["https://phimapi.com", "https://kkphim.com"],
    vsmov: ["https://vsmov.com/api", "https://vsmov.com"],
    ophim: ["https://ophim17.cc", "https://ophim1.com", "https://ophimapi.com", "https://ophim.vip"],
    nguonc: ["https://phim.nguonc.com/api", "https://phim.nguonc.com"],
    xink: ["https://api.xink.pro/api", "https://api.xink.pro"]
};

const resolveLiveApiDomain = async (serviceName, candidates, customTestPath) => {
    const defaultPaths = {
        kkphim: "/danh-sach/phim-moi-cap-nhat?page=1",
        vsmov: "/tim-kiem?keyword=conan&limit=1",
        nguonc: "/films/phim-moi-cap-nhat?page=1",
        xink: "/content?page=1",
        ophim: "/v1/api/danh-sach/phim-moi-cap-nhat?page=1"
    };
    const testPath = customTestPath || defaultPaths[serviceName] || "/danh-sach/phim-moi-cap-nhat?page=1";
    for (const baseUrl of candidates) {
        if (!baseUrl) continue;
        try {
            const cleanBase = baseUrl.replace(/\/+$/, '');
            const testUrl = `${cleanBase}${testPath.startsWith('/') ? '' : '/'}${testPath}`;
            const res = await axios.get(testUrl, { timeout: 2500, signal: AbortSignal.timeout(2500), maxRedirects: 5, headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
            const finalUrl = res.request?.res?.responseUrl || testUrl;
            if (res.status === 200 && res.data && (res.data?.items || res.data?.data?.items || res.data?.status || res.data?.list)) {
                return serviceName === "vsmov" || serviceName === "nguonc" || serviceName === "xink" ? `${new URL(finalUrl).origin}/api` : new URL(finalUrl).origin;
            }
        } catch (e) {}
    }
    return candidates[0];
};

// ĐÃ THÊM 3 NGUỒN CỘNG ĐỒNG THEO YÊU CẦU
const GITHUB_SOURCES = [
    { author: "Tinhlagi", url: "https://thtt.pages.dev/tttt.m3u", isGlobalSource: false },
    { author: "Coban66", url: "https://dl.dropboxusercontent.com/s/o5vygit34v9ryly71gam4/coban66.m3u?rlkey=auyoon54hfubajt16nc7u7dbn&st=70gyvtcu&dl=0", isGlobalSource: false },
    { author: "TQS", url: "https://raw.githubusercontent.com/hieu-TQS/error/refs/heads/main/error.m3u", isGlobalSource: false },
    { author: "VMTTV VN", url: "https://raw.githubusercontent.com/vuminhthanh12/vuminhthanh12/main/vmttv", isGlobalSource: false },
    { author: "IPTV-Org VN", url: "https://iptv-org.github.io/iptv/countries/vn.m3u", isGlobalSource: false },
    { author: "IPTV-Org Sports", url: "https://iptv-org.github.io/iptv/categories/sports.m3u", isGlobalSource: true }
];

const FALLBACK_POOL = {
    "vtv1": ["https://live.fptplay53.net/live/media/vtv1/live247-hls-avc/index.m3u8", "https://vtv1.vtvgo.vn/live/index.m3u8"], "vtv3": ["https://live.fptplay53.net/live/media/vtv3/live247-hls-avc/index.m3u8", "https://vtv3.vtvgo.vn/live/index.m3u8"],
    "htv_the_thao": ["https://live.fptplay53.net/live/media/htvtt/live247-hls-avc/index.m3u8"], "vtc3": ["https://live.fptplay53.net/live/media/vtc3/live247-hls-avc/index.m3u8"]
};

const isVietnamChannel = (name, genre) => {
    const n = (name || "").toLowerCase(), g = (genre || "").toLowerCase();
    return n.includes("vtv") || n.includes("htv") || n.includes("vtc") || n.includes("k+") || n.includes("sctv") || n.includes("drt") || n.includes("thvl") || n.includes("on ") || n.includes("vtvcab") || g.includes("việt");
};

const isWantedChannel = (name, genre) => {
    if (isVietnamChannel(name, genre)) return true;
    const n = (name || "").toLowerCase(), g = (genre || "").toLowerCase();
    if (["hbo", "cinemax", "warner", "axn", "discovery", "cartoon", "disney", "fox", "national", "paramount", "animax", "bbc"].some(kw => n.includes(kw) || g.includes(kw))) return true;
    if (["bein", "spotv", "dazn", "sky sports", "espn", "astro", "ufc", "fight"].some(kw => n.includes(kw) || g.includes(kw))) return true;
    return false;
};

const normalizeChannelKey = (rawName) => { return (rawName || "").toLowerCase().replace(/\[.*?\]|\(.*?\)/g, '').replace(/fhd|hd|sd|4k|1080p|720p|live|24\/7|server\s*\d+|luồng\s*\d+/gi, '').replace(/k\s*\+/g, 'kplus').replace(/[^a-z0-9]/g, ''); };

const parseClearKey = (rawKey) => {
    if (!rawKey) return null;
    rawKey = rawKey.trim();
    if (rawKey.startsWith("{") && rawKey.includes("keys")) {
        try {
            const parsed = JSON.parse(rawKey);
            if (parsed.keys && parsed.keys.length > 0) {
                const item = parsed.keys[0];
                const base64UrlToHex = (b64) => {
                    let s = (b64 || "").replace(/-/g, '+').replace(/_/g, '/');
                    while (s.length % 4) s += '=';
                    return Buffer.from(s, 'base64').toString('hex');
                };
                return {
                    kidHex: base64UrlToHex(item.kid),
                    keyHex: base64UrlToHex(item.k)
                };
            }
        } catch (e) {}
    }
    if (rawKey.includes(":")) {
        const parts = rawKey.split(":");
        if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
            return {
                kidHex: parts[0].trim().toLowerCase(),
                keyHex: parts[1].trim().toLowerCase()
            };
        }
    }
    return null;
};

const testStreamLatency = async (url) => {
    if (!url || !url.startsWith("http")) return { alive: false, latency: 99999 };
    const start = Date.now();
    try {
        const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Range": "bytes=0-1024" };
        if (url.includes("mytvnet.vn") || url.includes("mytvn.net") || url.includes("auraflix")) {
            headers["Referer"] = "https://auraflix.vip/";
            headers["Origin"] = "https://auraflix.vip";
        }
        const res = await axios.get(url, { signal: AbortSignal.timeout(2200), headers });
        const content = typeof res.data === 'string' ? res.data : '';
        const isAlive = (res.status === 200 || res.status === 206) && (
            content.includes("#EXTM3U") || 
            content.includes("#EXTINF") || 
            content.includes("<MPD") ||
            (res.headers['content-type'] || '').includes('mpegurl') ||
            (res.headers['content-type'] || '').includes('dash')
        );
        return { alive: isAlive, latency: Date.now() - start };
    } catch (e) {
        if (e.response && (e.response.status === 403 || e.response.status === 200) && (url.includes("fptplay") || url.includes("tv360") || url.includes("vtvgo") || url.includes("vtc") || url.includes("mytvnet") || url.includes("mytvn.net"))) {
            return { alive: true, latency: 200 };
        }
        return { alive: false, latency: 99999 };
    }
};

const parseM3uContent = (content, sourceInfo) => {
    const lines = content.split("\n"); 
    const channels = []; 
    let cur = null;
    let currentKey = "";
    let currentUa = "Mozilla/5.0";
    let isClearkey = false;

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith("#EXTINF:")) {
            const nameMatch = line.match(/,(.+)$/); 
            const logoMatch = line.match(/tvg-logo="([^"]+)"/); 
            const groupMatch = line.match(/group-title="([^"]+)"/);
            const rawName = nameMatch ? nameMatch[1].trim() : "Kênh TV"; 
            const genre = groupMatch ? groupMatch[1] : "📺 Truyền Hình";
            if (sourceInfo.isGlobalSource && !isWantedChannel(rawName, genre)) { 
                cur = null; 
                continue; 
            }
            let logo = logoMatch ? logoMatch[1] : "";
            if (rawName.toLowerCase().includes("warner")) {
                logo = "https://i.postimg.cc/bJ4n1D6n/Warner-TV-Asia.png";
            }
            cur = { 
                rawName, 
                logo, 
                genre, 
                author: sourceInfo.author, 
                streamUrl: "" 
            };
            currentKey = "";
            isClearkey = false;
        } else if (line.startsWith("#EXTVLCOPT:http-user-agent=")) {
            currentUa = line.replace("#EXTVLCOPT:http-user-agent=", "").trim();
        } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=")) {
            currentKey = line.substring(line.indexOf("=") + 1).trim();
            isClearkey = true;
        } else if (line.startsWith("http") && cur) {
            let normalizedUrl = line.replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn");
            cur.streamUrl = normalizedUrl;
            cur.userAgent = currentUa;
            if (isClearkey && currentKey) {
                const parsed = parseClearKey(currentKey);
                if (parsed && parsed.kidHex && parsed.keyHex) {
                    cur.isClearkeyFlag = true;
                    cur.kidHex = parsed.kidHex;
                    cur.keyHex = parsed.keyHex;
                }
            }
            channels.push(cur); 
            cur = null;
        }
    }
    return channels;
};

const runMultiSourceBot = async () => {
    console.log("🤖 [BOT HARVESTER] BẮT ĐẦU QUÉT SIÊU TỐC TỪ 6 NGUỒN CỘNG ĐỒNG & CLEARKEY...");
    const teleDomains = await scanTelegramCanary();
    if (teleDomains.kkphim.length > 0) DOMAIN_CANDIDATES.kkphim.unshift(...teleDomains.kkphim);
    if (teleDomains.vsmov.length > 0) DOMAIN_CANDIDATES.vsmov.unshift(...teleDomains.vsmov);
    if (teleDomains.nguonc.length > 0) DOMAIN_CANDIDATES.nguonc.unshift(...teleDomains.nguonc);

    const [liveKkphim, liveVsmov, liveOphim, liveNguonc, liveXink] = await Promise.all([
        resolveLiveApiDomain("kkphim", DOMAIN_CANDIDATES.kkphim),
        resolveLiveApiDomain("vsmov", DOMAIN_CANDIDATES.vsmov),
        resolveLiveApiDomain("ophim", DOMAIN_CANDIDATES.ophim),
        resolveLiveApiDomain("nguonc", DOMAIN_CANDIDATES.nguonc),
        resolveLiveApiDomain("xink", DOMAIN_CANDIDATES.xink)
    ]);

    const endpointsFilePath = path.join(__dirname, "api_endpoints.json");
    let existingEndpointsData = {};
    try {
        if (fs.existsSync(endpointsFilePath)) {
            existingEndpointsData = JSON.parse(fs.readFileSync(endpointsFilePath, "utf-8"));
        }
    } catch (e) {}

    const updatedEndpoints = {
        ...existingEndpointsData,
        kkphim: liveKkphim,
        vsmov: liveVsmov,
        ophim: liveOphim,
        nguonc: liveNguonc,
        xink: liveXink,
        lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(endpointsFilePath, JSON.stringify(updatedEndpoints, null, 2));

    const fetchPromises = GITHUB_SOURCES.map(src => axios.get(src.url, { timeout: 6000 }).then(res => ({ source: src, data: res.data })).catch(() => null));
    const sourceResults = await Promise.allSettled(fetchPromises);
    let allRawStreams = [];
    sourceResults.forEach(r => { if (r.status === "fulfilled" && r.value) allRawStreams = allRawStreams.concat(parseM3uContent(r.value.data, r.value.source)); });

    const channelClusters = new Map();
    allRawStreams.forEach(item => {
        const key = normalizeChannelKey(item.rawName); 
        if (!key) return;
        if (!channelClusters.has(key)) {
            channelClusters.set(key, { 
                displayName: item.rawName, 
                logo: item.logo || "https://via.placeholder.com/300x200?text=TV", 
                genre: item.genre, 
                isVn: isVietnamChannel(item.rawName, item.genre), 
                candidateUrls: new Set(),
                clearkeyInfo: null
            });
        }
        const cluster = channelClusters.get(key);
        if (cluster.candidateUrls.size < 5 && item.streamUrl) {
            cluster.candidateUrls.add(item.streamUrl);
        }
        if (item.isClearkeyFlag && item.kidHex && item.keyHex && !cluster.clearkeyInfo) {
            cluster.clearkeyInfo = {
                kidHex: item.kidHex,
                keyHex: item.keyHex,
                userAgent: item.userAgent || "Dalvik/2.1.0"
            };
        }
    });

    const finalChannels = [];
    const entries = Array.from(channelClusters.entries());
    
    for (let i = 0; i < entries.length; i += 40) {
        await Promise.all(entries.slice(i, i + 40).map(async ([key, info]) => {
            const urls = Array.from(info.candidateUrls);
            let bestUrl = null, lowestLatency = 99999;

            for (const testUrl of urls) {
                const res = await testStreamLatency(testUrl);
                if (res.alive && res.latency < lowestLatency) { lowestLatency = res.latency; bestUrl = testUrl; break; }
            }
            if (!bestUrl && info.isVn && urls.length > 0) { bestUrl = urls[0]; lowestLatency = 200; }
            
            if (bestUrl) {
                const chObj = { 
                    id: "vmttv_" + Buffer.from(key).toString("hex").slice(0, 12), 
                    name: info.displayName, 
                    poster: info.logo, 
                    genre: info.genre, 
                    streamUrl: bestUrl, 
                    latency: lowestLatency 
                };
                if (info.clearkeyInfo) {
                    chObj.isClearkeyFlag = true;
                    chObj.kidHex = info.clearkeyInfo.kidHex;
                    chObj.keyHex = info.clearkeyInfo.keyHex;
                    chObj.userAgent = info.clearkeyInfo.userAgent;
                }
                finalChannels.push(chObj);
            }
        }));
    }
    
    finalChannels.sort((a, b) => {
        const priority = (name) => { 
            const n = (name || "").toLowerCase(); 
            return n.includes("warner") ? 0 : n.includes("hbo") ? 1 : n.includes("vtv") ? 2 : n.includes("on ") || n.includes("sctv") ? 3 : n.includes("sport") ? 4 : 5; 
        };
        const pA = priority(a.name), pB = priority(b.name);
        return pA !== pB ? pA - pB : a.latency - b.latency;
    });

    fs.writeFileSync(path.join(__dirname, "live_channels.json"), JSON.stringify(finalChannels, null, 2));
    console.log(`🎉 [BOT HARVESTER] Thu thập hoàn thành: ${finalChannels.length} Kênh. TQS, Coban66, Tinhlagi đã được tải!`);
    return finalChannels;
};

if (require.main === module) {
    runMultiSourceBot();
}

module.exports = { runMultiSourceBot, parseClearKey, testStreamLatency };

