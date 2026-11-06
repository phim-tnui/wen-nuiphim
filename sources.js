/**
 * TUNGNUI PRO 3.5 - ULTIMATE MERGE EDITION (WEBVIEW EXTERNAL URL)
 * - Tự động đẩy "isClearkeyFlag" kích hoạt chế độ phát qua Web (Shaka Player)
 * - Đưa ưu tiên luồng Player Vượt Kén lên vị trí Top 1 chống lỗi Màn Đen!
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");

// KHÔI PHỤC HẰNG SỐ VIPTORRENT
const VIPTORRENT_BASE = "https://viptorrent.nadan.cloud/%7B%22v%22%3A%226.2.0%22%7D";

const aiHealer = require("./ai-source-finder");
const { parseClearKey, atomicWriteJson, testStreamLatency, boundedParallel } = require("./common-utils");

// =========================================================================
// 0. BỘ TỰ ĐỘNG HEAL & KHỞI TẠO CẤU HÌNH API
// =========================================================================
const getEndpoints = () => {
    const defaults = { 
        kkphim: "https://phimapi.com", 
        vsmov: "https://vsmov.com", 
        ophim: "https://ophim1.com",
        nguonc: "https://phim.nguonc.com",
        xink: "https://api.xink.pro/api",
        customMovieApi: "",
        customMovieApis: []
    };

    const possiblePaths = [ 
        path.join(__dirname, "api_endpoints.json"), 
        path.join(process.cwd(), "api_endpoints.json") 
    ];

    for (const p of possiblePaths) {
        try { 
            if (fs.existsSync(p)) { 
                const data = JSON.parse(fs.readFileSync(p, "utf-8")); 
                if (data && (data.kkphim || data.xink || data.customMovieApi || data.customMovieApis)) {
                    const customList = Array.isArray(data.customMovieApis) ? data.customMovieApis : (data.customMovieApi ? [data.customMovieApi] : []);
                    return { 
                        kkphim: (data.kkphim || defaults.kkphim).replace(/\/api\/?$/, ''), 
                        vsmov: (data.vsmov || defaults.vsmov).replace(/\/api\/?$/, ''), 
                        ophim: (data.ophim || defaults.ophim).replace(/\/api\/?$/, ''),
                        nguonc: (data.nguonc || defaults.nguonc).replace(/\/api\/?$/, ''),
                        xink: (data.xink || defaults.xink).replace(/\/+$/, ''),
                        customMovieApi: data.customMovieApi ? data.customMovieApi.replace(/\/+$/, '') : "",
                        customMovieApis: customList.map(u => String(u).trim().replace(/\/+$/, '')).filter(u => u.length > 0)
                    }; 
                } 
            } 
        } catch (e) {}
    }
    return defaults;
};

const failureTelemetry = {
    count: 0, 
    lastTrigger: 0,
    recordFailure: async () => {
        failureTelemetry.count++; 
        const now = Date.now();
        if (failureTelemetry.count >= 5 && (now - failureTelemetry.lastTrigger > 15 * 60 * 1000)) {
            failureTelemetry.lastTrigger = now; 
            failureTelemetry.count = 0;
            const patToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT; 
            const repoSlug = process.env.GITHUB_REPOSITORY;
            
            if (patToken && repoSlug) { 
                try { 
                    await axios.post(
                        `https://api.github.com/repos/${repoSlug}/dispatches`, 
                        { event_type: "auto_heal" }, 
                        { headers: { "Authorization": `Bearer ${patToken}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "TungNui-Telemetry" }, timeout: 3000 }
                    ); 
                } catch (e) {} 
            }
        }
    }
};

const http = axios.create({ timeout: 3000, headers: { "User-Agent": "Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36", "Accept": "application/json, text/plain, */*" } });

const getImgUrl = (url) => { 
    if (!url || typeof url !== "string") return "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&h=450&fit=crop"; 
    const trimmed = url.trim();
    if (!trimmed) return "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&h=450&fit=crop";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed; 
    const cleanPath = trimmed.replace(/^\/+/, "");
    return `https://phimimg.com/${cleanPath}`; 
};

const parseEpisodeNumber = (name, index) => { 
    if (!name) return index + 1; 
    const match = name.toString().match(/\d+/); 
    return match ? parseInt(match[0], 10) : index + 1; 
};

const removeVietnameseTones = (str) => { 
    if (!str) return ""; 
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); 
};

/**
 * 🌟 BỘ CHUẨN HÓA PHỤ ĐỀ ĐA DẠNG NGUỒN (UNIVERSAL SUBTITLE TRACK NORMALIZER)
 * Tương thích 100% với cả Stremio và Nuvio Player (Android/TV/Desktop)
 * Cung cấp đầy đủ các thuộc tính: id, url, lang, language, lang_code, name, title, label, format, default
 */
const normalizeSubtitleTrack = (rawSub, index = 0, baseUrl = "") => {
    if (!rawSub) return null;

    let subUrl = "";
    let rawLang = "";
    let rawLabel = "";

    if (typeof rawSub === "string") {
        subUrl = rawSub.trim();
    } else if (typeof rawSub === "object") {
        subUrl = rawSub.url || rawSub.file || rawSub.src || rawSub.link || rawSub.path || rawSub.subtitle_url || rawSub.sub_url || rawSub.vtt || rawSub.srt || "";
        rawLang = String(rawSub.lang || rawSub.language || rawSub.lang_code || rawSub.code || rawSub.srclang || rawSub.iso || "").toLowerCase().trim();
        rawLabel = String(rawSub.label || rawSub.name || rawSub.title || rawSub.display_name || rawSub.language_name || "").trim();
    }

    if (typeof subUrl !== "string" || !subUrl.trim()) return null;
    subUrl = subUrl.trim();

    if (!subUrl.startsWith("http") && baseUrl) {
        subUrl = baseUrl.replace(/\/+$/, '') + (subUrl.startsWith('/') ? '' : '/') + subUrl;
    }
    if (!subUrl.startsWith("http")) return null;

    const isVietnamese = rawLang === 'vi' || rawLang === 'vie' || rawLang === 'vn' || rawLang.includes('viet') || 
                         rawLabel.toLowerCase().includes('việt') || rawLabel.toLowerCase().includes('viet') ||
                         /(?:^|[_\-./])(vi|vie|viet|vietnamese)(?:[_\-./]|$)/i.test(subUrl);

    const isEnglish = rawLang === 'en' || rawLang === 'eng' || rawLang.includes('english') || rawLabel.toLowerCase().includes('eng') || rawLabel.toLowerCase().includes('tiếng anh');
    const isChinese = rawLang === 'zh' || rawLang === 'chi' || rawLang === 'zho' || rawLang.includes('chinese') || rawLabel.toLowerCase().includes('trung') || rawLabel.toLowerCase().includes('中文');

    let normalizedLang = "vie";
    let langCode = "vi";
    if (isVietnamese) { normalizedLang = "vie"; langCode = "vi"; }
    else if (isEnglish) { normalizedLang = "eng"; langCode = "en"; }
    else if (isChinese) { normalizedLang = "zho"; langCode = "zh"; }
    else if (rawLang.length === 3) { normalizedLang = rawLang; langCode = rawLang.slice(0, 2); }
    else if (rawLang.length === 2) { normalizedLang = rawLang === 'ja' ? 'jpn' : (rawLang === 'ko' ? 'kor' : rawLang); langCode = rawLang; }

    let displayLabel = rawLabel;
    if (!displayLabel) {
        if (isVietnamese) displayLabel = "🇻🇳 Tiếng Việt";
        else if (isEnglish) displayLabel = "🇬🇧 English";
        else if (isChinese) displayLabel = "🇨🇳 中文字幕";
        else displayLabel = `Phụ đề (${normalizedLang.toUpperCase()})`;
    } else if (isVietnamese && !displayLabel.includes('🇻🇳') && !displayLabel.includes('Việt')) {
        displayLabel = `🇻🇳 ${displayLabel}`;
    }

    const subId = (rawSub && typeof rawSub === 'object' && rawSub.id) 
        ? String(rawSub.id) 
        : `sub_ext_${index}_${Buffer.from(subUrl).toString('base64url').slice(0, 10)}`;

    const isDef = Boolean(rawSub && typeof rawSub === 'object' && (rawSub.default || rawSub.isDefault));

    const finalLang = isVietnamese ? "vi" : normalizedLang;

    return {
        id: subId,
        url: subUrl,
        lang: finalLang,
        language: finalLang,
        lang_code: langCode,
        name: displayLabel,
        title: displayLabel,
        label: displayLabel,
        format: subUrl.includes('.srt') ? "srt" : "vtt",
        default: isDef,
        isDefault: isDef
    };
};

/**
 * Trích xuất toàn bộ phụ đề từ các đối tượng movie / episode / server do API ngoài cung cấp
 */
const extractExternalSubtitles = (movie, foundEp, server, baseUrl = "") => {
    const subs = [];
    const seenUrls = new Set();

    const addSub = (raw) => {
        const norm = normalizeSubtitleTrack(raw, subs.length, baseUrl);
        if (norm && norm.url && !seenUrls.has(norm.url)) {
            seenUrls.add(norm.url);
            subs.push(norm);
        }
    };

    if (foundEp) {
        const epSubs = foundEp.subtitles || foundEp.tracks || foundEp.sub || foundEp.captions || foundEp.subs || [];
        if (Array.isArray(epSubs)) epSubs.forEach(addSub);
        else if (typeof epSubs === 'string' || typeof epSubs === 'object') addSub(epSubs);

        if (foundEp.link_sub) addSub(foundEp.link_sub);
        if (foundEp.sub_url) addSub(foundEp.sub_url);
        if (foundEp.subtitle) addSub(foundEp.subtitle);
        if (foundEp.subtitle_url) addSub(foundEp.subtitle_url);
    }

    if (server) {
        const serverSubs = server.subtitles || server.tracks || server.sub || [];
        if (Array.isArray(serverSubs)) serverSubs.forEach(addSub);
    }

    if (movie) {
        const movieSubs = movie.subtitles || movie.tracks || movie.subs || movie.caption || [];
        if (Array.isArray(movieSubs)) movieSubs.forEach(addSub);
        else if (typeof movieSubs === 'string' || typeof movieSubs === 'object') addSub(movieSubs);

        if (movie.sub_url) addSub(movie.sub_url);
        if (movie.link_sub) addSub(movie.link_sub);
    }

    return subs;
};

const normalizeRomanOrArabic = (val) => {
    if (!val) return null;
    const v = val.toString().trim().toLowerCase();
    const romanMap = {
        'i': '1', '1': '1',
        'ii': '2', '2': '2',
        'iii': '3', '3': '3',
        'iv': '4', '4': '4',
        'v': '5', '5': '5',
        'vi': '6', '6': '6',
        'vii': '7', '7': '7',
        'viii': '8', '8': '8',
        'ix': '9', '9': '9',
        'x': '10', '10': '10'
    };
    return romanMap[v] || v;
};

const extractSequelNumber = (str) => {
    if (!str || typeof str !== 'string') return null;
    const s = str.toLowerCase();
    
    // 1. Khớp các định danh phần/tập rõ ràng: "phần 2", "part 2", "season 2", "ss2", "vol 2", "chap 2"
    const explicitMatch = s.match(/\b(?:part|phan|phần|season|ss|vol|volume|chap)\s*([0-9ivxlc]+)\b/i);
    if (explicitMatch) {
        return normalizeRomanOrArabic(explicitMatch[1]);
    }

    // 2. Khớp các số La Mã đứng độc lập ở cuối hoặc giữa tên (II, III, IV, V, VI, VII, VIII)
    const romanMatch = s.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/i);
    if (romanMatch) {
        return normalizeRomanOrArabic(romanMatch[1]);
    }

    // 3. Khớp số thứ tự phần phim 2-9 đứng riêng biệt (tránh nhầm năm phát hành như 2024, 1999)
    const trailingMatch = s.match(/\b([2-9])\b/);
    if (trailingMatch) {
        return trailingMatch[1];
    }

    return null;
};

const isStrictTitleMatch = (targetTitle, targetOrigTitle, candidateName, candidateOrigName, targetImdb = "", candidateImdb = "", targetYear = null, candidateYear = null) => {
    const tImdb = targetImdb ? String(targetImdb) : "";
    const cImdb = candidateImdb ? String(candidateImdb) : "";

    // 1. Khớp tuyệt đối theo mã IMDb nếu cả 2 cùng có mã hợp lệ bắt đầu bằng "tt"
    if (tImdb && cImdb && tImdb.startsWith("tt") && cImdb.startsWith("tt")) {
        return tImdb === cImdb;
    }

    // 2. Chống râu ông nọ cắm cằm bà kia: Kiểm tra số thứ tự phần phim (Sequel)
    // Nếu một bên là Phần 2/3/4 mà bên kia là Phần 1 (không có số) hoặc khác phần -> TUYỆT ĐỐI KHÔNG KHỚP
    const tNum = extractSequelNumber(`${targetTitle || ''} ${targetOrigTitle || ''}`);
    const cNum = extractSequelNumber(`${candidateName || ''} ${candidateOrigName || ''}`);
    if (tNum || cNum) {
        if (tNum !== cNum) {
            return false;
        }
    }

    // 3. Kiểm tra năm phát hành (Chống cắm nhầm giữa các bản remake/reboot khác năm)
    if (targetYear && candidateYear) {
        const y1 = parseInt(targetYear, 10);
        const y2 = parseInt(candidateYear, 10);
        if (!isNaN(y1) && !isNaN(y2) && Math.abs(y1 - y2) > 1) {
            return false;
        }
    }

    const normalize = (s) => {
        if (!s) return "";
        return removeVietnameseTones(s.toLowerCase())
            .replace(/\s*\(\d{4}\)/g, '')
            .replace(/\[.*?\]|\(.*?\)/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const t1 = normalize(targetTitle), t2 = normalize(targetOrigTitle);
    const c1 = normalize(candidateName), c2 = normalize(candidateOrigName);

    const targetList = [t1, t2].filter(s => s && s.length >= 2);
    const candList = [c1, c2].filter(s => s && s.length >= 2);

    for (const t of targetList) {
        for (const c of candList) {
            // Khớp chính xác 100% sau chuẩn hóa
            if (t === c) return true;

            // Khớp theo tập từ với độ tương đồng khắt khe >= 70% hoặc chứa nhau nếu có >= 2 từ
            const w1 = t.split(' ').filter(w => w.length > 1);
            const w2 = c.split(' ').filter(w => w.length > 1);
            if (w1.length >= 1 && w2.length >= 1) {
                if (w1.length === 1 && w2.length === 1) {
                    if (w1[0] === w2[0]) return true;
                } else if (w1.length >= 2 && w2.length >= 2) {
                    const s2 = new Set(w2);
                    const matchCount = w1.filter(w => s2.has(w)).length;
                    const ratio = matchCount / Math.max(w1.length, w2.length);
                    if (ratio >= 0.7) return true;
                    if ((t.includes(c) || c.includes(t)) && Math.min(w1.length, w2.length) >= 2) return true;
                }
            }
        }
    }

    return false;
};

// =========================================
// 0. HIDDEN BACKGROUND AUTOMATION CONSTANTS
// =========================================
const BACKGROUND_AUTOMATION_CONFIG = Object.freeze({
    streamMode: "native",
    streamProxyEnabled: true,
    clearKeyDecryptionEnabled: true,
    liveTvAutoHealthCheckEnabled: true,
    liveTvHealthIntervalMinutes: 10,
    liveFootballAutoSyncEnabled: true,
    liveFootballRefreshMinutes: 5,
    networkScraperAutoEnabled: true,
    capturedStreamsAutoPersist: true,
    auraflixAutoCrawlEnabled: true,
    auraflixAutoCrawlIntervalMinutes: 30,
    botHarvesterIntervalMinutes: 30
});

const ALLOWED_INTERNATIONAL_KEYS = new Set([
    "hbo",
    "warnertv",
    "cinemax",
    "axn",
    "cinemaworld",
    "cartoon",
    "dreamworks",
    "boomerang",
    "cbeebies",
    "ebskids",
    "discovery",
    "discoveryasia",
    "animalplanet",
    "bbcearth",
    "bbclifestyle",
    "dmax",
    "tlc",
    "fashiontv",
    "bbcworldnews",
    "cnn",
    "bloomberg",
    "france24",
    "dw",
    "aljazeera",
    "trtworld"
]);

const NON_ESSENTIAL_INTERNATIONAL_KEYWORDS = [
    "foxsports", "fox sport", "fox_sport", "fox news", "fox movies", "fox family", "fox life",
    "hgtv", "nhk", "mbc", "tvb", "capital", "cs tv", "g1",
    "national geographic", "nat geo", "natgeo", "paramount", "kbs", "tvn", "animax",
    "disney", "filmbox", "nickelodeon", "baby tv", "babytv"
];

// =========================================
// 1. PHÂN LOẠI KÊNH TRUYỀN HÌNH CHUẨN XÁC
// =========================================
const isAllowedInternationalChannel = (ch) => {
    if (!ch) return false;
    const rawKey = (ch.key || "").toLowerCase();
    if (ALLOWED_INTERNATIONAL_KEYS.has(rawKey)) return true;
    const n = (ch.name || "").toLowerCase();
    if (NON_ESSENTIAL_INTERNATIONAL_KEYWORDS.some(kw => n.includes(kw))) return false;
    if (n.includes("hbo")) return true;
    if (n.includes("warner") || n.includes("wbtv") || n.includes("wb tv")) return true;
    if (n.includes("cinemax")) return true;
    if (n.includes("axn")) return true;
    if (n.includes("cartoon network") || n === "cartoon" || n === "cn" || n.includes("cn hd")) return true;
    if (n.includes("dreamwork")) return true;
    if (n.includes("cartoonito") || n.includes("boomerang")) return true;
    if (n.includes("cbeebies")) return true;
    if (n.includes("ebs kids") || n.includes("ebskids")) return true;
    if (n.includes("cinemaworld") || n.includes("cinema world")) return true;
    if (n.includes("discovery")) return true;
    if (n.includes("animal planet") || n.includes("animalplanet")) return true;
    if (n.includes("bbc earth") || n.includes("bbcearth")) return true;
    if (n.includes("bbc lifestyle") || n.includes("bbclifestyle")) return true;
    if (n.includes("bbc news") || n.includes("bbc world") || n.includes("bbcworldnews")) return true;
    if (n.includes("dmax")) return true;
    if (n.includes("tlc") || n.includes("travel living")) return true;
    if (n.includes("fashion tv") || n.includes("fashiontv")) return true;
    if (n.includes("cnn")) return true;
    if (n.includes("bloomberg")) return true;
    if (n.includes("france 24") || n.includes("france24")) return true;
    if (n === "dw" || n.includes("deutsche welle") || n.includes("dw -")) return true;
    if (n.includes("al jazeera") || n.includes("aljazeera")) return true;
    if (n.includes("trt world") || n.includes("trtworld")) return true;
    return false;
};

const isNonEssentialInternationalChannel = (ch) => {
    if (!ch) return false;
    if (isAllowedInternationalChannel(ch)) return false;
    const rawKey = (ch.key || "").toLowerCase();
    const rawGenre = (ch.genre || "").toLowerCase();
    const rawName = (ch.name || "").trim();
    const n = `${rawName} ${rawKey} ${rawGenre}`.toLowerCase();

    // Filter out radio channels and event placeholders
    if (rawGenre.includes("radio") || n.includes("[radio]") || n.includes("kênh vov") || /\b(vov[1-9]|voh\s*fm|fm\s*\d{2,3})\b/i.test(n)) {
        return true;
    }
    if (rawName.toLowerCase().startsWith("tv360+") || rawName.toLowerCase().startsWith("tv360 promo") || rawName.toLowerCase().startsWith("vtvprime")) {
        return true;
    }

    // Filter out Cyrillic, Korean, Chinese, Arabic, Indian, European, and American non-essential channels
    if (/[\u0400-\u04FF]/.test(rawName)) return true;
    if (rawGenre.includes("nước ngoài") || rawGenre.includes("nuớc ngoài") || rawGenre.includes("trung quốc") || rawGenre.includes("hàn quốc") || rawGenre.includes("israel")) {
        return true;
    }
    if (NON_ESSENTIAL_INTERNATIONAL_KEYWORDS.some(kw => n.includes(kw))) return true;
    if (/\b(cctv\d*|cgtn|espn|arirang|sbs|tv\s*chosun|ytn|al\s*arabiya|al\s*saudiya|euronews|cna\b|cnbc|abc\s*australia|abc\s*news|abp\s*news|india\s*tv|zee\s|russia\s*today|rt\s*documentary|rai\s*italia|tv5\s*monde|canal\s*24|dubai\s*tv|korean\s*central|1\+1|2x2|7tv|fightbox|filmua|virgin\s*media|trace\s*urban|trace\s*latina|clubbing\s*tv|duck\s*tv|da\s*vinci|english\s*club|press\s*tv|republic\s*tv|tdm\s*macau|mcot)\b/i.test(n)) {
        return true;
    }
    return false;
};

const isRealVtvChannel = (ch) => {
    if (!ch) return false;
    const raw = (ch.name || "").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    if (raw.includes("vtvcab") || raw.includes("vtv cab") || raw.includes("vtvprime") || raw.includes("vtv prime")) return false;
    return /\bvtv\s*(10|[1-9]|can\s*tho)\b/i.test(raw);
};

const isVtvCabOrOnTvChannel = (ch) => {
    if (!ch) return false;
    const n = (ch.name || "").toLowerCase();
    const g = (ch.genre || "").toLowerCase();
    if (g.includes("vtvcab") || g.includes("vtv cab")) return true;
    if (n.includes("vtvcab") || n.includes("vtv cab") || n.includes("vfamily") || n.includes("vie giải trí") || n.includes("vie giai tri") || n.includes("vie dramas") || n.includes("vie drama") || n.includes("e channel") || n.includes("o2tv") || n.includes("on life")) return true;
    if (/\bon\s*(sports|football|cine|movies|kids|bibi|info|music|trending|style|o2tv|plus|golf|phim|vie|e\s*channel|vfamily|life)/i.test(n)) return true;
    return false;
};

const isProvincialLocalChannel = (ch) => {
    if (!ch) return false;
    const n = (ch.name || "").toLowerCase();
    const g = (ch.genre || "").toLowerCase();
    if (g.includes("địa phương") || g.includes("dia phuong")) return true;
    if (/\b(thvl|vinh\s*long|hanoitv|hà\s*nội|ha\s*noi|\bh1\b|\bh2\b|thp|hải\s*phòng|hai\s*phong|qtv|quảng\s*ninh|quang\s*ninh|btv|bắc\s*ninh|bac\s*ninh|bình\s*dương|binh\s*duong|đnnrtv|dnnrtv|đồng\s*nai|dong\s*nai|cần\s*thơ|can\s*tho|thđt|thdt|đồng\s*tháp|dong\s*thap|atv|an\s*giang|ntv|natv|nghệ\s*an|nghe\s*an|ttv|thanh\s*hóa|thanh\s*hoa|tuyên\s*quang|ktv|khánh\s*hòa|khanh\s*hoa|đnrt|dnrt|đà\s*nẵng|da\s*nang|ltv|lâm\s*đồng|lam\s*dong|lai\s*châu|ctv|cà\s*mau|ca\s*mau|ptv|phú\s*thọ|phu\s*tho|hytv|hưng\s*yên|hung\s*yen|nbtv|ninh\s*bình|ninh\s*binh|bhttv|hà\s*tĩnh|ha\s*tinh|qngtv|quảng\s*ngãi|quang\s*ngai|qttv|quảng\s*trị|quang\s*tri|stv|snews|sơn\s*la|son\s*la|thlc|lào\s*cai|lao\s*cai|lstv|lạng\s*sơn|lang\s*son|crtv|cao\s*bằng|cao\s*bang|đtv|điện\s*biên|dien\s*bien|drt|đắk\s*lắk|dak\s*lak|gtv|gia\s*lai|huế|hue\s*tv|tây\s*ninh|tay\s*ninh|thái\s*nguyên|thai\s*nguyen|tiền\s*giang|tien\s*giang|trà\s*vinh|tra\s*vinh|ninh\s*thuận|ninh\s*thuan|quảng\s*nam|quang\s*nam|báo\s*và\s*ptth|đài\s*ptth)\b/i.test(n)) {
        return true;
    }
    return false;
};

const classifyTvChannel = (ch) => {
    const n = (ch.name || "").toLowerCase();
    const nAscii = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    if (n.includes(" vs ") || n.includes("⚽") || n.includes("🏐") || n.includes("🏀") || n.includes("🎾") || n.includes("🎮")) return { category: "the_thao", categoryName: "⚽ Kênh Thể Thao", sortIndex: 40 };
    if (isRealVtvChannel(ch)) {
        let sortIndex = 99;
        if (/\bvtv\s*1\b/.test(nAscii)) sortIndex = 1;
        else if (/\bvtv\s*2\b/.test(nAscii)) sortIndex = 2;
        else if (/\bvtv\s*3\b/.test(nAscii)) sortIndex = 3;
        else if (/\bvtv\s*4\b/.test(nAscii)) sortIndex = 4;
        else if (/\bvtv\s*5\b/.test(nAscii) && !nAscii.includes("tay nguyen") && !nAscii.includes("tay nam")) sortIndex = 5;
        else if (/\bvtv\s*6\b/.test(nAscii) || nAscii.includes("can tho")) sortIndex = 6;
        else if (/\bvtv\s*7\b/.test(nAscii)) sortIndex = 7;
        else if (/\bvtv\s*8\b/.test(nAscii)) sortIndex = 8;
        else if (/\bvtv\s*9\b/.test(nAscii)) sortIndex = 9;
        else if (/\bvtv\s*10\b/.test(nAscii)) sortIndex = 10;
        else if (nAscii.includes("tay nam")) sortIndex = 11;
        else if (nAscii.includes("tay nguyen")) sortIndex = 12;
        return { category: "vtv", categoryName: "🔴 Kênh VTV", sortIndex };
    }
    if (isAllowedInternationalChannel(ch)) {
        let sortIndex = 65;
        if (n.includes("hbo")) sortIndex = 60;
        else if (n.includes("warner") || n.includes("wbtv")) sortIndex = 61;
        else if (n.includes("cinemax")) sortIndex = 62;
        else if (n.includes("axn")) sortIndex = 63;
        else if (n.includes("cartoon")) sortIndex = 64;
        else if (n.includes("cinemaworld") || n.includes("cinema world")) sortIndex = 65;
        else if (n.includes("discovery")) sortIndex = 66;
        return { category: "quoc_te", categoryName: "🌐 Kênh Quốc Tế", sortIndex };
    }
    // Ưu tiên nhận diện toàn bộ hệ thống kênh VTVcab & ON TV (ON Football, ON Sports, ON Movies, ON Cine, ON Vie, ON Phim Việt, ON BiBi, ON Kids...)
    if (isVtvCabOrOnTvChannel(ch)) {
        let sortIndex = 25;
        if (n.includes("football") || n.includes("sports")) sortIndex = 20;
        else if (n.includes("movies") || n.includes("cine") || n.includes("phim")) sortIndex = 21;
        else if (n.includes("vie") || n.includes("e channel")) sortIndex = 22;
        return { category: "vtvcab", categoryName: "📺 Kênh VTVcab & ON TV", sortIndex };
    }
    // Kênh HTV, SCTV, VTC, ANTV, QPVN
    if (n.includes("htv") || n.includes("sctv") || n.includes("vtc") || n.includes("todaytv") || n.includes("thuần việt") || n.includes("antv") || n.includes("qpvn")) {
        return { category: "giai_tri", categoryName: "🎭 Kênh HTV • SCTV • Giải Trí", sortIndex: 35 };
    }
    // Kênh Địa Phương 63 Tỉnh Thành (THVL Vĩnh Long, Hà Nội, Hải Phòng, Bắc Ninh, Đồng Nai, Cần Thơ, Nghệ An, Đà Nẵng...)
    if (isProvincialLocalChannel(ch)) {
        let sortIndex = 50;
        if (n.includes("thvl") || n.includes("vinh long") || n.includes("vĩnh long")) sortIndex = 45;
        else if (n.includes("h1") || n.includes("h2") || n.includes("hà nội") || n.includes("hanoitv")) sortIndex = 46;
        return { category: "dia_phuong", categoryName: "📡 Kênh Địa Phương", sortIndex };
    }
    if (n.includes("thiếu nhi") || n.includes("bibi") || n.includes("kids")) return { category: "thieu_nhi", categoryName: "👶 Kênh Thiếu Nhi", sortIndex: 30 };
    if (n.includes("phim") || n.includes("cinema") || n.includes("movie") || n.includes("box movie")) {
        return { category: "phim_truyen", categoryName: "🎬 Kênh Phim", sortIndex: 55 };
    }
    if (n.includes("thể thao") || n.includes("sport") || n.includes("k+") || n.includes("golf")) return { category: "the_thao", categoryName: "⚽ Kênh Thể Thao", sortIndex: 40 };
    return { category: "dia_phuong", categoryName: "📡 Kênh Địa Phương", sortIndex: 80 };
};

const isMovieChannel = (ch) => { const n = (ch.name || "").toLowerCase(); return ["hbo", "cinemax", "warner", "cinema world", "cinemaworld", "axn", "box movie", "phim", "cinema", "movie", "cine"].some(kw => n.includes(kw)); };
const isInternationalChannel = (ch) => isAllowedInternationalChannel(ch);

// =========================================
// 2. CONFIG: BẢNG MENU CATALOG (4 BỘ LỌC LIVE TV CHUẨN)
// =========================================
const TV_CATALOGS = [
    { id: "tv_tong_hop", name: "📺 Toàn Bộ Kênh TV", type: "tv", apiPath: "live", defaultChecked: true },
    { id: "tv_quoc_te", name: "🌐 Kênh Quốc Tế", type: "tv", apiPath: "live", defaultChecked: true },
    { id: "tv_vtv", name: "🔴 Kênh VTV", type: "tv", apiPath: "live", defaultChecked: true },
    { id: "sports_live_matches", name: "⚽ Bóng Đá Live", type: "tv", apiPath: "live", defaultChecked: true }
];

const MOVIE_CATALOGS = [
    { id: "phim-le", name: "Phim Lẻ", type: "movie", posterShape: "landscape", apiPath: "danh-sach/phim-le", defaultChecked: true },
    { id: "phim-4k", name: "Phim Lẻ TM", type: "movie", posterShape: "landscape", apiPath: "danh-sach/phim-chieu-rap", defaultChecked: true },
    { id: "phim-moi-cap-nhat", name: "Phim Mới", type: "movie", posterShape: "landscape", apiPath: "danh-sach/phim-moi-cap-nhat", defaultChecked: true },
    { id: "phim-bo", name: "Phim Bộ", type: "series", posterShape: "landscape", apiPath: "danh-sach/phim-bo", defaultChecked: true },
    { id: "phim-thieu-nhi", name: "Thiếu Nhi", type: "movie", posterShape: "landscape", apiPath: "the-loai/hoat-hinh", defaultChecked: true },
    { id: "phim-le-thuyet-minh", name: "Phim Thuyết Minh", type: "movie", posterShape: "landscape", apiPath: "danh-sach/phim-thuyet-minh", defaultChecked: true },
    { id: "bxh-phim-thang", name: "BXH Phim Tháng", type: "movie", posterShape: "landscape", apiPath: "danh-sach/phim-moi-cap-nhat", defaultChecked: true },
    { id: "phim-chieu-rap", name: "Phim Chiếu Rạp", type: "movie", posterShape: "landscape", apiPath: "danh-sach/phim-chieu-rap", defaultChecked: true },
    { id: "hanh-dong", name: "Hành Động / Phiêu Lưu", type: "movie", posterShape: "landscape", apiPath: "the-loai/hanh-dong", defaultChecked: true },
    { id: "kinh-di", name: "Kinh Dị / Giật Gân", type: "movie", posterShape: "landscape", apiPath: "the-loai/kinh-di", defaultChecked: true },
    { id: "au-my", name: "Phim Âu Mỹ", type: "movie", posterShape: "landscape", apiPath: "quoc-gia/au-my", defaultChecked: true },
    { id: "han-trung", name: "Hàn Quốc / Trung Quốc", type: "series", posterShape: "landscape", apiPath: "quoc-gia/han-quoc", defaultChecked: true },
    { id: "vo-thuat-long-tieng", name: "Võ Thuật / Lồng Tiếng", type: "movie", posterShape: "landscape", apiPath: "the-loai/vo-thuat", defaultChecked: true },
    { id: "khoa-hoc-vien-tuong", name: "🛸 Khoa Học Viễn Tưởng", type: "movie", posterShape: "landscape", apiPath: "the-loai/vien-tuong", defaultChecked: true },
    { id: "hoat-hinh-anime", name: "Hoạt Hình & Anime", type: "series", posterShape: "landscape", apiPath: "danh-sach/hoat-hinh", defaultChecked: true }
];

const ADULT_SUB_CATALOGS = [
    {
        id: "phim_18_series",
        name: "🔞 Series JUQ, STAR...",
        type: "movie",
        tag: "Series Độc Quyền",
        primaryKw: "JUQ",
        secondaryKw: "STAR",
        keywords: ["JUQ", "STAR", "SSIS", "IPX", "MIDE", "FSDSS", "PRED", "WANZ"]
    },
    {
        id: "phim_18_massage",
        name: "🔞 Massage thư giãn",
        type: "movie",
        tag: "Massage thư giãn",
        primaryKw: "エステ",
        secondaryKw: "マッサージ",
        keywords: ["エステ", "マッサージ", "油压", "SPA", "按摩"]
    },
    {
        id: "phim_18_vung_trom",
        name: "🔞 Vụng trộm / Kịch tính",
        type: "movie",
        tag: "Vụng trộm / Kịch tính",
        primaryKw: "不倫",
        secondaryKw: "寝取",
        keywords: ["不倫", "寝取", "人妻", "偷情", "出轨"]
    },
    {
        id: "phim_18_bo_chong",
        name: "🔞 Bố chồng / Con dâu",
        type: "movie",
        tag: "Bố chồng / Con dâu",
        primaryKw: "公公",
        secondaryKw: "儿媳",
        keywords: ["公公", "儿媳", "義父", "義母", "丈母娘"]
    }
];

const ALL_CATALOGS = [...TV_CATALOGS, ...MOVIE_CATALOGS, ...ADULT_SUB_CATALOGS];
const TOP_MAIN_CATALOGS = TV_CATALOGS.slice(0, 4);
const SUB_GRID_CATALOGS = [...MOVIE_CATALOGS];

const DEFAULT_ACTIVE_IDS = [
    "tv_tong_hop", "tv_quoc_te", "tv_vtv", "sports_live_matches",
    "phim-le", "phim-4k", "phim-moi-cap-nhat", "phim-bo", "phim-thieu-nhi", "hoat-hinh-anime", "phim-le-thuyet-minh",
    "bxh-phim-thang", "phim-chieu-rap", "hanh-dong", "kinh-di", "au-my", "han-trung", "vo-thuat-long-tieng", "khoa-hoc-vien-tuong"
];

// THỐNG KÊ HOẠT ĐỘNG BOT HARVESTER & CLEARKEY
const botSyncTelemetry = {
    lastSync: Date.now(),
    channelCount: 0,
    clearKeyCount: 0,
    status: "Active 🟢",
    syncLog: []
};

// NẠP CONFIG MỞ RỘNG (HARDCODED BACKGROUND STREAM PROXY & NATIVE MODE BY DEFAULT)
const parseConfig = (rawParam) => {
    if (!rawParam) return { catalogs: DEFAULT_ACTIVE_IDS, rd: "", ai: "", mode: BACKGROUND_AUTOMATION_CONFIG.streamMode };
    try {
        let b64 = rawParam.replace(/-/g, '+').replace(/_/g, '/'); while (b64.length % 4) b64 += '=';
        const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
        return { 
            catalogs: parsed.c || parsed.catalogs || DEFAULT_ACTIVE_IDS, 
            rd: parsed.rd || "", 
            ai: parsed.ai || parsed.gemini || "",
            mode: parsed.m || parsed.mode || BACKGROUND_AUTOMATION_CONFIG.streamMode
        };
    } catch (e) { return { catalogs: rawParam.split(','), rd: "", ai: "", mode: BACKGROUND_AUTOMATION_CONFIG.streamMode }; }
};

const buildManifest = (optionsStr) => {
    const config = parseConfig(optionsStr);
    const activeCatalogs = [];
    const tvCategoriesList = [
        { id: "tv_quoc_te", name: "🌐 Kênh Quốc Tế", posterShape: "landscape" },
        { id: "tv_vtv", name: "🔴 Kênh VTV", posterShape: "landscape" },
        { id: "sports_live_matches", name: "⚽ Bóng Đá Live", posterShape: "landscape" }
    ];

    if (config.catalogs.includes("tv_tong_hop")) {
        activeCatalogs.push({
            type: "tv",
            id: "tv_tong_hop",
            name: "📺 Toàn Bộ Kênh TV",
            posterShape: "landscape",
            extra: [
                {
                    name: "genre",
                    options: [
                        "🌟 Tất Cả",
                        "🌐 Kênh Quốc Tế",
                        "🔴 Kênh VTV",
                        "⚽ Bóng Đá Live"
                    ],
                    isRequired: false
                },
                { name: "search", isRequired: false },
                { name: "skip", isRequired: false }
            ]
        });
    }

    tvCategoriesList.forEach(t => { 
        if (config.catalogs.includes(t.id)) activeCatalogs.push({ type: "tv", id: t.id, name: t.name, posterShape: "landscape", extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }] }); 
    });

    const handledSpecial = [...tvCategoriesList.map(t => t.id), "tv_tong_hop"];
    ALL_CATALOGS.filter(cat => !handledSpecial.includes(cat.id) && (config.catalogs.includes(cat.id) || config.catalogs.includes(cat.id.replace(/-/g, '_')) || config.catalogs.includes('cat_' + cat.id.replace(/-/g, '_')))).forEach(cat => { 
        activeCatalogs.push({ 
            type: cat.type, 
            id: `cat_${cat.id.replace(/-/g, '_')}`, 
            name: cat.icon ? `${cat.icon} ${cat.name}` : cat.name, 
            posterShape: "landscape", 
            extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }] 
        }); 
    });

    return { 
        id: "community.nuvio.addon", 
        version: "3.7.0", 
        name: "TUNGNUI-ADDON AI", 
        description: "Hệ thống Truyền Hình, Phim Đa Nguồn và Phụ đề AI dịch.", 
        resources: [
            "catalog", 
            "meta", 
            "stream", 
            "subtitles"
        ], 
        types: ["movie", "series", "tv"], 
        idPrefixes: [
            "tt", "phim_", "vsmov_", "nguonc_", "ophim_", "xink_", "custom_",
            "viptorrent_", "viptorrent:", "match_", "iptv_", "vmttv_", "vmt_", "scraped_", "jav_", "tmdb"
        ], 
        behaviorHints: {
            configurable: true,
            configurationRequired: false
        },
        catalogs: [ 
            ...activeCatalogs, 
            { type: "movie", id: "search_movie", name: "🔍 Tìm Kiếm Phim", posterShape: "landscape", extra: [{ name: "search", isRequired: true }] }, 
            { type: "series", id: "search_series", name: "🔍 Tìm Kiếm Phim Bộ", posterShape: "landscape", extra: [{ name: "search", isRequired: true }] } 
        ] 
    };
};

const isAnimeMovie = (p) => {
    if (!p) return false; 
    const typeStr = (p.type || "").toLowerCase(); 
    if (typeStr === "hoathinh" || typeStr === "anime" || typeStr === "animation") return true;

    // 1. Kiểm tra danh mục chuyên mục (Category)
    if (p.category && Array.isArray(p.category)) { 
        const hasCart = p.category.some(c => { 
            const s = (c.slug || "").toLowerCase(); 
            const n = (c.name || "").toLowerCase(); 
            return s.includes("hoat-hinh") || s.includes("anime") || s.includes("donghua") || s.includes("animation") || 
                   n.includes("hoạt hình") || n.includes("anime") || n.includes("hoathinh"); 
        }); 
        if (hasCart) return true; 
    }

    // 2. Kiểm tra chuỗi tên đầy đủ, tên gốc, slug
    const nameLower = `${p.name || ""} ${p.origin_name || p.original_name || ""} ${p.slug || ""}`.toLowerCase(); 
    if (nameLower.includes("hoạt hình") || nameLower.includes("anime") || nameLower.includes("donghua") || 
        nameLower.includes("animation") || nameLower.includes("animated") || nameLower.includes("cartoon")) {
        return true;
    }

    // 3. Từ khóa Donghua (Hoạt hình 3D / Tu tiên Trung Quốc)
    const donghuaKeywords = [
        "vạn giới", "phàm nhân", "đấu la", "đấu phá", "thôn phệ", "hoàn mỹ thế giới", "già thiên", "nghịch thiên", 
        "tiên nghịch", "linh kiếm tôn", "vũ canh kỷ", "tây hành kỷ", "tu tiên", "đại lục linh", "linh võ", "yêu thần ký", 
        "trùng sinh", "tuyết ưng", "bách luyện", "thương nguyên", "sư huynh", "võ thần", "linh vũ", "võ luyện", 
        "tinh thần biến", "nguyên tôn", "thần ấn vương tọa", "nhất niệm vĩnh hằng", "luyện khí mười vạn năm", 
        "luyện khí 10 vạn năm", "tuyệt thế đường môn", "toàn chức pháp sư", "toàn chức cao thủ", "ma đạo tổ sư", 
        "thiên quan tứ phúc", "trấn hồn nhai", "thần mộ", "trường an tam vạn dặm", "họa giang hồ", "bạch xà", 
        "tân phong thần", "na tra", "tây du ký tái thế", "khương tử nha", "tinh thần biến", "thôn phệ tinh không",
        "wan jie", "fan ren", "dou luo", "dou po", "swallowed star", "perfect world", "renegade immortal", "soul land",
        "battle through the heavens", "shrouding the heavens", "a will eternal", "martial universe"
    ];
    if (donghuaKeywords.some(kw => nameLower.includes(kw))) return true;

    // 4. Từ khóa Anime Nhật Bản (Tên tiếng Việt, tiếng Anh và Romaji)
    const animeKeywords = [
        "one piece", "naruto", "boruto", "conan", "dragon ball", "jujutsu kaisen", "kimetsu", "demon slayer", 
        "bleach", "attack on titan", "hunter x hunter", "solo leveling", "mushoku tensei", "re:zero", "slime", 
        "sword art online", "haikyu", "chainsaw man", "spy x family", "tokyo ghoul", "doraemon", "pokemon",
        "digimon", "gundam", "beyblade", "thanh gươm diệt quỷ", "chú thuật hồi chiến", "đại chiến titan",
        "thám tử lừng danh", "thất hình đại tội", "học viện siêu anh hùng", "thợ săn tiền thưởng", "vua hải tặc",
        "bảy viên ngọc rồng", "đao kiếm thần vực", "vô thức tái sinh", "chuyển sinh thành slime", "vua trò chơi",
        "thủ lĩnh thẻ bài", "shin cậu bé bút chì", "áo giáp vàng", "vùng đất linh hồn", "lâu đài bay của howl",
        "hàng xóm của tôi là totoro", "mộ đom đóm", "inuyasha", "ranma", "sailor moon", "ghibli", "danmachi",
        "frieren", "kaiju no. 8", "wind breaker", "oshi no ko", "blue lock", "hell's paradise", "vinland saga",
        "jojo", "dr. stone", "shangri-la frontier", "mashle", "bocchi", "delicious in dungeon", "evangelion",
        "black clover", "tokyo revengers", "gintama", "overlord", "fate/stay", "fate/zero", "monogatari",
        "death note", "fullmetal alchemist", "one punch man", "mob psycho", "steins;gate", "code geass",
        "tate no yuusha", "isekai", "bungo stray dogs", "classroom of the elite", "kaguya-sama"
    ];
    if (animeKeywords.some(kw => nameLower.includes(kw))) return true;

    // 5. Kiểm tra quốc gia Nhật Bản kết hợp đặc thù phim hoạt họa
    if (p.country && Array.isArray(p.country)) {
        const isJapan = p.country.some(c => (c.slug || "").includes("nhat-ban") || (c.name || "").toLowerCase().includes("nhật bản"));
        if (isJapan) {
            const epStr = `${p.episode_total || ""} ${p.episode_current || ""} ${p.time || ""}`.toLowerCase();
            if (epStr.includes("24 phút") || epStr.includes("23 phút") || epStr.includes("25 phút")) return true;
        }
    }

    return false;
};

// =========================================================================
// 3. TRUYỀN HÌNH ĐA NGUỒN (TÍCH HỢP BIẾN MỒI WEBVIEW CLEARKEY)
// =========================================================================
const FALLBACK_TV_POOLS = {
    "vtv1": ["https://freem3u.xyz/api/live/play.m3u8?vid=2", "https://vmttv.dpdns.org/tv360/?id=vtv1", "https://luuchieu.truyenhinhso.vn/media/live/C90B082632CD4A75F4B3EDB3/index.m3u8"],
    "vtv2": ["https://vmttv.dpdns.org/tv360/?id=vtv2"],
    "vtv3": ["https://vmttv.dpdns.org/tv360/?id=vtv3"],
    "vtv4": ["https://vmttv.dpdns.org/tv360/?id=vtv4"],
    "vtv5": ["https://vmttv.dpdns.org/tv360/?id=vtv5", "https://freem3u.xyz/api/live/play.m3u8?vid=110"],
    "vtv6": ["https://vmttv.dpdns.org/tv360/?id=vtv6"],
    "vtv7": ["https://vmttv.dpdns.org/tv360/?id=vtv7"],
    "vtv8": ["https://vmttv.dpdns.org/tv360/?id=vtv8"],
    "vtv9": ["https://vmttv.dpdns.org/tv360/?id=vtv9"],
    "vtv10": ["https://vmttv.dpdns.org/tv360/?id=vtv10"],
    "htv_the_thao": ["https://vmttv.dpdns.org/tv360/?id=htv-the-thao"],
    "vtc3": ["https://vmttv.dpdns.org/tv360/?id=vtc3"],
    "warner": ["http://cdn4.skygo.mn/live/disk1/Warner/HLSv3-FTA/Warner.m3u8"]
};

// (parseClearKey is imported from common-utils.js)

// NGUỒN 25 KÊNH QUỐC TẾ CAO CẤP TỪ AURAFLIX TV-FLIX (MPEG-DASH CLEARKEY & HLS CHUẨN 100%)
const AURAFLIX_PREMIUM_CHANNELS = [
    {
        id: "iptv_hbo",
        key: "hbo",
        name: "HBO HD (Vietsub)",
        poster: "https://i.pinimg.com/originals/8b/02/00/8b020050690f955ccb306cdf51324aea.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/hbo.smil/manifest.mpd",
        kidHex: "09ddfe3d63863cafaeb79d0546b098ab",
        keyHex: "3de0f38dcf014827dfd5bec38743c6a2",
        isClearkeyFlag: true
    },
    {
        id: "iptv_warnertv",
        key: "warnertv",
        name: "Warner TV HD",
        poster: "https://i.postimg.cc/bJ4n1D6n/Warner-TV-Asia.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/wtv.smil/manifest.mpd",
        kidHex: "086d09a40bff3a00aa6dd4dbaf9c13b2",
        keyHex: "34f1908cfe2e05ee060046d40f14aec9",
        isClearkeyFlag: true
    },
    {
        id: "iptv_cinemax",
        key: "cinemax",
        name: "Cinemax HD (Vietsub)",
        poster: "https://raw.githubusercontent.com/vuminhthanh12/Logo/refs/heads/main/cinemax.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/max.smil/manifest.mpd",
        kidHex: "acb4c23471063327adc732e283c0847f",
        keyHex: "e9868f5f473d0fd8699ede48d531c2b0",
        isClearkeyFlag: true
    },
    {
        id: "iptv_axn",
        key: "axn",
        name: "AXN HD",
        poster: "https://raw.githubusercontent.com/vuminhthanh12/Logo/refs/heads/main/axn.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s7771.cdn.mytvnet.vn/pkg20/live_dzones/axn.smil/manifest.mpd",
        kidHex: "9d29f87efdec3c9fab368f724a62ad0e",
        keyHex: "6f1c09c035eab36323d60d1454db3d20",
        isClearkeyFlag: true
    },
    {
        id: "iptv_cinemaworld",
        key: "cinemaworld",
        name: "CinemaWorld HD",
        poster: "https://i.postimg.cc/fyF9j3B2/ciww.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/cinemaworld.smil/manifest.mpd",
        kidHex: "ee7915564d7439d09bd3556ffccc87a4",
        keyHex: "b35e12a75a42a6f9184723a90ff42d9c",
        isClearkeyFlag: true
    },
    {
        id: "iptv_cartoon",
        key: "cartoon",
        name: "Cartoon Network HD",
        poster: "https://freight.cargo.site/w/1200/i/3cf72163d993c4d87263e6d4990ec4ccdd1e14b09ce89e6e35dee1de83ef4985/CN.jpg",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/cn.smil/manifest.mpd",
        kidHex: "3c20166660a93a75ac77db81567389f7",
        keyHex: "3cc1add43aecce3fe31c9c6a2a5b8c21",
        isClearkeyFlag: true
    },
    {
        id: "iptv_dreamworks",
        key: "dreamworks",
        name: "DreamWorks HD",
        poster: "https://i.postimg.cc/L68SjCPK/16fabdd762a9-480-270-(1).png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/dreamwork.smil/manifest.mpd",
        kidHex: "67dae20527c63dadaaae609aa91577cb",
        keyHex: "59328f621d56767bc5ff9404a8940683",
        isClearkeyFlag: true
    },
    {
        id: "iptv_boomerang",
        key: "boomerang",
        name: "Cartoonito / Boomerang HD",
        poster: "https://i.postimg.cc/05Xs9GzT/di0vg3q-ef892734-f9c6-4b84-bae4-d06c558f4de1.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/boomerang.smil/manifest.mpd",
        kidHex: "b1f0d759e914369db388b3b0dc815971",
        keyHex: "5678d317e17007a88a9b9539e4526512",
        isClearkeyFlag: true
    },
    {
        id: "iptv_cbeebies",
        key: "cbeebies",
        name: "BBC CBeebies HD",
        poster: "https://s72140.cdn.mytvnet.vn/vimages/7d/d5/58/8c/ce/ea/7d58c-pcbeebieshd-channel-unkn.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/cbb.smil/manifest.mpd",
        kidHex: "cca73a006b4b39a595207ceb5ed9ca0a",
        keyHex: "b833d1f40c261ef78896f97e06f80cdc",
        isClearkeyFlag: true
    },
    {
        id: "iptv_ebskids",
        key: "ebskids",
        name: "EBS Kids TV HD",
        poster: "https://i.postimg.cc/ryBfGz3R/EBS-KIDS-2000.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://ebsonairios.ebs.co.kr/ebsutablet500k/tablet500k/playlist.m3u8",
        isClearkeyFlag: false
    },
    {
        id: "iptv_discovery",
        key: "discovery",
        name: "Discovery Channel HD",
        poster: "https://img-zlr1.tv360.vn/image1/2021/09/30/17/1632999438220/cb5b2ef01b69_480_270.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s7770.cdn.mytvnet.vn/pkg20/live_dzones/dsc.smil/manifest.mpd",
        kidHex: "eb4160ea553a321d899553e4e796fec2",
        keyHex: "bea5a07157e0c4d17b11ab399517f952",
        isClearkeyFlag: true
    },
    {
        id: "iptv_discoveryasia",
        key: "discoveryasia",
        name: "Discovery Asia HD",
        poster: "https://i.postimg.cc/ZYsSJP94/disa.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/dscasia.smil/manifest.mpd",
        kidHex: "934907b134be3963a6263a453846924c",
        keyHex: "788e2835fb98568aed2f47bbdc091515",
        isClearkeyFlag: true
    },
    {
        id: "iptv_animalplanet",
        key: "animalplanet",
        name: "Animal Planet HD",
        poster: "https://i.postimg.cc/tCHWwG9R/143.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/ap.smil/manifest.mpd",
        kidHex: "ec6f072c7125377a9bc0ae61598095f4",
        keyHex: "1d5388e0781415ebcec9914f5ad75875",
        isClearkeyFlag: true
    },
    {
        id: "iptv_bbcearth",
        key: "bbcearth",
        name: "BBC Earth HD",
        poster: "https://i.postimg.cc/HLrS45Y9/BBC-Earth-Meta.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s7771.cdn.mytvnet.vn/pkg20/live_dzones/bbcearth.smil/manifest.mpd",
        kidHex: "5014941a2c42379880b5edf72304c165",
        keyHex: "f3fa0fe3cd39a52f4eefd36ff7161e89",
        isClearkeyFlag: true
    },
    {
        id: "iptv_bbclifestyle",
        key: "bbclifestyle",
        name: "BBC Lifestyle HD",
        poster: "https://i.postimg.cc/BZrm5tk8/life-style.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s7770.cdn.mytvnet.vn/pkg20/live_dzones/bbclifestyle.smil/manifest.mpd",
        kidHex: "58b949986ed13294bc01b0f330abc527",
        keyHex: "23e8c5f2fe202906ac2d6554d9527299",
        isClearkeyFlag: true
    },
    {
        id: "iptv_dmax",
        key: "dmax",
        name: "DMAX HD",
        poster: "https://i.imgur.com/vHmt91V.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/dmax.smil/manifest.mpd",
        kidHex: "53b26f904ae03a20b56477cfb9c5dca2",
        keyHex: "0c64ccfb978e7390bd33344075492aec",
        isClearkeyFlag: true
    },
    {
        id: "iptv_tlc",
        key: "tlc",
        name: "TLC (Travel & Living) HD",
        poster: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/TLC_Logo.svg/1280px-TLC_Logo.svg.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s129135.cdn.mytvnet.vn/pkg20/live_dzones/tlc.smil/manifest.mpd",
        kidHex: "b6908629732639ada4814a6208296d9c",
        keyHex: "7ca9bf03623f77b5e2f16df0b53f274d",
        isClearkeyFlag: true
    },
    {
        id: "iptv_fashiontv",
        key: "fashiontv",
        name: "Fashion TV HD",
        poster: "https://i.postimg.cc/26fKkyYW/ftv-Photoroom.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/ftv.smil/manifest.mpd",
        kidHex: "c1d9f25701023508bfa6737e3a8c7001",
        keyHex: "30c3613e9b06e0f7cc201014f31bf5d8",
        isClearkeyFlag: true
    },
    {
        id: "iptv_bbcworldnews",
        key: "bbcworldnews",
        name: "BBC News HD",
        poster: "https://i.postimg.cc/1XKhh6Nt/BBC-World-News-Photoroom.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s7771.cdn.mytvnet.vn/pkg20/live_dzones/bbcworldnews.smil/manifest.mpd",
        kidHex: "c7ba46086dda345a929e29bf155e459c",
        keyHex: "d374b8f39904bf572689ea347ae86591",
        isClearkeyFlag: true
    },
    {
        id: "iptv_cnn",
        key: "cnn",
        name: "CNN International HD",
        poster: "https://i.postimg.cc/jdWQ1KV3/CNN-Logo-wine.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s7771.cdn.mytvnet.vn/pkg20/live_dzones/cnn.smil/manifest.mpd",
        kidHex: "714cc8ed05a03abb9ac61bd4bbd1d8a0",
        keyHex: "1acf58ff8d4cd87c2d3c12d22248efb1",
        isClearkeyFlag: true
    },
    {
        id: "iptv_bloomberg",
        key: "bloomberg",
        name: "Bloomberg TV HD",
        poster: "https://i.imgur.com/rxFZgIK.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/bloomberg.smil/manifest.mpd",
        kidHex: "1071393f8fc237f3a9a28028142110f7",
        keyHex: "7a0f8c3c72e0ffff811d534c929c57c2",
        isClearkeyFlag: true
    },
    {
        id: "iptv_france24",
        key: "france24",
        name: "France 24 English HD",
        poster: "https://i.postimg.cc/1zzppZKc/France-24-logo-(2013)-svg.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_5000.m3u8",
        isClearkeyFlag: false
    },
    {
        id: "iptv_dw",
        key: "dw",
        name: "DW (Deutsche Welle) HD",
        poster: "https://img-zlr1.tv360.vn/image1/2022/05/10/15/1652170991466/3334568ab702_480_270.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8",
        isClearkeyFlag: false
    },
    {
        id: "iptv_aljazeera",
        key: "aljazeera",
        name: "Al Jazeera English HD",
        poster: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Aljazeera_eng.svg/512px-Aljazeera_eng.svg.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://live-hls-web-aje-gcp.thehlive.com/AJE/01.m3u8",
        isClearkeyFlag: false
    },
    {
        id: "iptv_trtworld",
        key: "trtworld",
        name: "TRT World HD",
        poster: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/TRT_World_logo.svg/512px-TRT_World_logo.svg.png",
        genre: "🌐 Kênh Quốc Tế",
        streamUrl: "https://tv-trtworld.medya.trt.com.tr/master_1080.m3u8",
        isClearkeyFlag: false
    }
];

const normalizeTvKey = (rawName) => { 
    if (!rawName) return ""; 
    let k = rawName.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, 'd')
        .replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/-\s*(bao va ptth|dai ptth).*$/i, '')
        .replace(/fhd|hd|sd|4k|1080p|1080i|720p|576i|50fps|live|24\/7|server\s*\d+|luong\s*\d+|vietsub\s*tqs|vietsub/gi, '')
        .replace(/k\s*\+/g, 'kplus')
        .replace(/[^a-z0-9]/g, ''); 
    if (k === "cartoonnetwork" || k === "cartoon" || k === "cn") return "cartoon";
    if (k === "boomerang" || k === "cartoonito" || k === "cartoonitoboomerang") return "boomerang";
    if (k === "dreamwork" || k === "dreamworks") return "dreamworks";
    if (k === "bbccbeebies" || k === "cbeebies" || k === "cbb") return "cbeebies";
    if (k === "ebskidstv" || k === "ebskids") return "ebskids";
    if (k === "wbtv" || k === "warnertv" || k === "warner") return "warnertv";
    if (k === "hbo") return "hbo";
    if (k === "cinemax" || k === "max") return "cinemax";
    if (k === "axn") return "axn";
    if (k === "foxsport" || k === "foxsports" || k === "foxsport1" || k === "foxsports1") return "foxsports1";
    if (k === "foxsport2" || k === "foxsports2") return "foxsports2";
    if (k === "cinemaworld") return "cinemaworld";
    if (k === "discoveryasia" || k === "dscasia") return "discoveryasia";
    if (k === "discovery" || k === "discoverychannel" || k === "dsc") return "discovery";
    if (k === "animalplanet" || k === "ap") return "animalplanet";
    if (k === "bbcearth") return "bbcearth";
    if (k === "bbclifestyle") return "bbclifestyle";
    if (k === "bbcnews" || k === "bbcworldnews" || k === "bbcworld") return "bbcworldnews";
    if (k === "cnn" || k === "cnninternational") return "cnn";
    if (k === "bloomberg" || k === "bloombergtv") return "bloomberg";
    if (k === "france24" || k === "france24english" || k === "france24eng") return "france24";
    if (k === "dw" || k === "dwdeutschewelle" || k === "deutschewelle") return "dw";
    if (k === "aljazeera" || k === "aljazeeraenglish") return "aljazeera";
    if (k === "trtworld") return "trtworld";
    if (k === "tlc" || k === "travellivingchannel" || k === "travelliving") return "tlc";
    if (k === "dmax") return "dmax";
    if (k === "fashiontv" || k === "fashion" || k === "ftv") return "fashiontv";
    if (k === "vtv5taynambo" || k === "vtv5tnb") return "vtv5taynambo";
    if (k === "vtv5taynguyen" || k === "vtv5tn") return "vtv5taynguyen";
    if (k === "htvthethao" || k === "htvsports" || k === "htvsport") return "htvthethao";
    if (/^thvinhlong([1-5])$/.test(k)) return k.replace("thvinhlong", "thvl");
    return k;
};

const isScrapedMatchOrJunkEntry = (ch) => {
    if (!ch) return true;
    const rawName = (ch.name || "").trim();
    const n = rawName.toLowerCase();
    const g = (ch.genre || "").toLowerCase();
    if (!rawName || n.startsWith("updated") || g.startsWith("updated")) return true;
    if (n.includes(" vs ") || n.includes("⚽") || n.includes("🏀") || n.includes("🏐") || n.includes("🎾") || n.includes("🎮") || n.includes("\uFFFD")) return true;
    if (/^\d{1,2}:\d{2}\s+\d{1,2}\/\d{1,2}/.test(n) || /^[🟢🟡🔴⏳]\s*\d{1,2}:\d{2}/.test(rawName)) return true;
    if (n.startsWith("blv ") || g.includes("vua sân cỏ") || g.includes("cola tv") || g.includes("gà vàng") || g.includes("xôi") || g.includes("sút bóng") || g.includes("giờ vàng") || g.includes("phá làng") || g.includes("s8 tv") || g.includes("live events")) return true;
    if (n.includes("vtvprime") || n.includes("tv360+") || g.includes("sự kiện vtvprime") || g.includes("sự kiện tv360")) return true;
    return false;
};

// XẾP HẠNG KÊNH TRUYỀN HÌNH CHUẨN XÁC:
const getTvSortRank = (name, genre) => {
    const n = (name || "").toLowerCase();
    
    // 1. HBO HD (Vietsub)
    if (n.includes("hbo")) return { rank: 1, sub: 1 };
    // 2. Warner TV HD
    if (n.includes("warner") || n.includes("wbtv") || n.includes("wb tv")) return { rank: 1, sub: 2 };
    // 3. Cinemax HD
    if (n.includes("cinemax")) return { rank: 1, sub: 3 };
    // 4. AXN HD
    if (n.includes("axn")) return { rank: 1, sub: 4 };
    // 5. CinemaWorld HD
    if (n.includes("cinema world") || n.includes("cinemaworld")) return { rank: 1, sub: 5 };
    // 6. Cartoon Network HD
    if (n.includes("cartoon network") || n === "cartoon" || n === "cn" || n.includes("cn hd")) return { rank: 1, sub: 6 };
    // 7. DreamWorks HD
    if (n.includes("dreamwork")) return { rank: 1, sub: 7 };
    // 8. Cartoonito / Boomerang
    if (n.includes("cartoonito") || n.includes("boomerang")) return { rank: 1, sub: 8 };
    // 9. Discovery Channel & Discovery Asia
    if (n.includes("discovery asia") || n.includes("discoveryasia") || n.includes("dscasia")) return { rank: 1, sub: 9 };
    if (n.includes("discovery")) return { rank: 1, sub: 10 };
    // 10. Animal Planet, BBC Earth, BBC Lifestyle, DMAX, TLC, Fashion TV, News
    if (n.includes("animal planet") || n.includes("animalplanet")) return { rank: 1, sub: 11 };
    if (n.includes("bbc earth") || n.includes("bbcearth")) return { rank: 1, sub: 12 };
    if (n.includes("bbc lifestyle") || n.includes("bbclifestyle")) return { rank: 1, sub: 13 };
    if (n.includes("dmax")) return { rank: 1, sub: 14 };
    if (n.includes("tlc") || n.includes("travel")) return { rank: 1, sub: 15 };
    if (n.includes("fashion")) return { rank: 1, sub: 16 };
    if (n.includes("cbeebies")) return { rank: 1, sub: 17 };
    if (n.includes("ebs kids") || n.includes("ebskids")) return { rank: 1, sub: 18 };
    if (n.includes("bbc news") || n.includes("bbc world")) return { rank: 1, sub: 19 };
    if (n.includes("cnn")) return { rank: 1, sub: 20 };
    if (n.includes("bloomberg")) return { rank: 1, sub: 21 };
    if (n.includes("france 24") || n.includes("france24")) return { rank: 1, sub: 22 };
    if (n.includes("deutsche welle") || n.startsWith("dw")) return { rank: 1, sub: 23 };
    if (n.includes("al jazeera") || n.includes("aljazeera")) return { rank: 1, sub: 24 };
    if (n.includes("trt world") || n.includes("trtworld")) return { rank: 1, sub: 25 };
    
    // Tiếp theo: Các đài truyền hình Việt Nam & thể thao
    if (isRealVtvChannel({ name })) {
        const c = classifyTvChannel({ name });
        return { rank: 2, sub: c.sortIndex || 50 };
    }
    if (n.includes("htv") || n.includes("vtc") || n.includes("thvl")) return { rank: 3, sub: 0 };
    if (n.includes("on ") || n.includes("sctv")) return { rank: 4, sub: 0 };
    if (n.includes("k+") || n.includes("kplus") || n.includes("sport") || n.includes("thể thao")) return { rank: 5, sub: 0 };
    return { rank: 6, sub: 0 };
};

const fetchUnifiedTvChannels = async (cache) => {
    const cached = cache ? cache.get("unified_tv_channels_v5") : null; 
    if (cached) return cached;
    
    const channelMap = new Map();

    // 1. NẠP 25 KÊNH QUỐC TẾ TIÊU CHUẨN TỪ AURAFLIX (MPEG-DASH & CLEARKEY + HLS CHUẨN)
    AURAFLIX_PREMIUM_CHANNELS.forEach(ch => {
        channelMap.set(ch.key, {
            id: ch.id,
            key: ch.key,
            name: ch.name,
            poster: ch.poster,
            genre: ch.genre,
            streams: [
                ch.isClearkeyFlag ? {
                    name: "⚡ [Auraflix Direct CDN] Bẻ Khóa",
                    title: `📺 ${ch.name}\n💎 Luồng MPEG-DASH + ClearKey Chuẩn AuraFlix`,
                    url: ch.streamUrl,
                    isClearkeyFlag: true,
                    channelName: ch.name,
                    kidHex: ch.kidHex,
                    keyHex: ch.keyHex,
                    behaviorHints: { isLive: true }
                } : {
                    name: "⚡ [Auraflix Direct HLS]",
                    title: `📺 ${ch.name}\n⚡ Luồng Quốc Tế HLS Tốc Độ Cao`,
                    url: ch.streamUrl,
                    channelName: ch.name,
                    behaviorHints: { isLive: true }
                }
            ]
        });
    });

    const possiblePaths = [path.join(__dirname, "live_channels.json"), path.join(process.cwd(), "live_channels.json")];
    let vmttvChannels = [];
    
    for (const p of possiblePaths) { 
        try { if (fs.existsSync(p)) { vmttvChannels = JSON.parse(fs.readFileSync(p, "utf-8")); if (vmttvChannels.length > 0) break; } } catch (e) {} 
    }

    vmttvChannels.forEach(ch => {
        let cleanName = (ch.name || "").trim();
        if (cleanName.includes("group-title=") || cleanName.includes("token=") || cleanName.includes(".png") || cleanName.includes(".jpg")) {
            const idx = cleanName.lastIndexOf(",");
            if (idx !== -1) cleanName = cleanName.substring(idx + 1).replace(/^[\s",]+|[\s",]+$/g, "").trim();
        }
        if (isScrapedMatchOrJunkEntry({ ...ch, name: cleanName })) return;
        const key = normalizeTvKey(cleanName); if (!key) return;
        // Eliminate non-essential international streams
        if (isNonEssentialInternationalChannel({ key, name: cleanName, genre: ch.genre })) return;
        const channelId = `iptv_${key}`;
        if (key === "vtv5taynambo") cleanName = "VTV5 TÂY NAM BỘ HD";
        if (key === "vtv5taynguyen") cleanName = "VTV5 TÂY NGUYÊN HD";
        if (!channelMap.has(key)) { 
            channelMap.set(key, { 
                id: channelId, 
                key, 
                legacyId: ch.id,
                name: cleanName, 
                poster: ch.poster || "https://via.placeholder.com/300x200?text=TV", 
                genre: ch.genre && ch.genre !== "Undefined" ? ch.genre : "📺 Truyền Hình", 
                streams: [] 
            }); 
        } else {
            const existing = channelMap.get(key);
            if (!existing.legacyId && ch.id) existing.legacyId = ch.id;
            if (ch.poster && ch.poster.includes("postimg.cc")) existing.poster = ch.poster;
            if (key === "vtv5taynambo" || key === "vtv5taynguyen") existing.name = cleanName;
        }
        if (ch.streamUrl) {
            const normUrl = ch.streamUrl
                .replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn")
                .replace("vips-livecdn.fptplay.net", "live.fptplay53.net");
            if (ch.isClearkeyFlag && ch.kidHex && ch.keyHex) {
                const existingStreams = channelMap.get(key).streams;
                if (!existingStreams.some(s => s.url === normUrl)) {
                    existingStreams.push({
                        name: "⚡ [Auraflix Proxy] Bẻ Khóa",
                        title: `📺 ${cleanName}\n💎 Khởi chạy luồng Vượt kén bảo vệ (Bot Harvester)`,
                        url: normUrl,
                        isClearkeyFlag: true,
                        channelName: cleanName,
                        kidHex: ch.kidHex,
                        keyHex: ch.keyHex,
                        behaviorHints: { isLive: true, proxyHeaders: { request: { "User-Agent": ch.userAgent || "Dalvik/2.1.0" } } }
                    });
                }
            } else {
                const existingStreams = channelMap.get(key).streams;
                if (!existingStreams.some(s => s.url === normUrl)) {
                    existingStreams.push({ name: "⚡ [Mạng Nội Bộ CDN]", title: `📺 ${cleanName}\n⚡ Luồng Máy Chủ HLS Tốc Độ Cao`, url: normUrl, behaviorHints: { isLive: true } });
                }
            }
        }
    });

    try {
        const tqsRes = await axios.get("https://raw.githubusercontent.com/hieu-TQS/error/refs/heads/main/error.m3u", { timeout: 3500 });
        const lines = tqsRes.data.split("\n"); 
        
        let currentName = "", currentLogo = "", currentUa = "Dalvik/2.1.0", currentKey = "", isClearkey = false;
        
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith("#EXTINF:")) {
                const lMatch = line.match(/tvg-logo="([^"]+)"/); const lastCommaIdx = line.lastIndexOf(',');
                if (lastCommaIdx !== -1) currentName = line.substring(lastCommaIdx + 1).replace(/^[\s",]+|[\s",]+$/g, '').trim();
                if (lMatch) currentLogo = lMatch[1]; currentKey = ""; isClearkey = false;
            } else if (line.startsWith("#EXTVLCOPT:http-user-agent=")) { currentUa = line.replace("#EXTVLCOPT:http-user-agent=", "").trim();
            } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=")) { 
                currentKey = line.substring(line.indexOf("=") + 1).trim(); 
                isClearkey = true;
            } else if (line.startsWith("http") && currentName) {
                const nLower = currentName.toLowerCase();
                let isMovieTarget = ["hbo", "warner", "cinemax", "axn", "cinema"].some(k => nLower.includes(k));
                let finalName = currentName; if (isMovieTarget && !nLower.includes("vietsub")) finalName += " (Vietsub TQS)";
                
                const key = normalizeTvKey(currentName);
                if (key && !isNonEssentialInternationalChannel({ key, name: currentName })) {
                    let targetLogo = currentLogo || "https://via.placeholder.com/300x200?text=TV";
                    if (key.includes("warner")) targetLogo = "https://i.postimg.cc/bJ4n1D6n/Warner-TV-Asia.png";

                    if (!channelMap.has(key)) { 
                        channelMap.set(key, { id: `iptv_${key}`, key, name: finalName, poster: targetLogo, genre: "📺 Kênh Phim Đặc Sắc", streams: [] }); 
                    } else if (key.includes("warner")) {
                        channelMap.get(key).poster = "https://i.postimg.cc/bJ4n1D6n/Warner-TV-Asia.png";
                    }

                    const ch = channelMap.get(key); 
                    const isMpd = line.includes(".mpd");
                    const normalizedLine = line
                        .replace("s2129134.cdn.mytvn.net", "s2129134.cdn.mytvnet.vn")
                        .replace("vips-livecdn.fptplay.net", "live.fptplay53.net");
                    
                    if (isClearkey && currentKey) {
                        const parsedKey = parseClearKey(currentKey);
                        if (parsedKey && parsedKey.kidHex && parsedKey.keyHex) {
                            const { kidHex, keyHex } = parsedKey;
                            if (!ch.streams.some(s => s.url === normalizedLine)) {
                                ch.streams.push({
                                    name: "⚡ [Auraflix Proxy] Bẻ Khóa",
                                    title: `📺 ${finalName}\n💎 Khởi chạy luồng Vượt kén bảo vệ`,
                                    url: normalizedLine,
                                    isClearkeyFlag: true,
                                    channelName: finalName,
                                    kidHex: kidHex, keyHex: keyHex,
                                    behaviorHints: { isLive: true, proxyHeaders: { request: { "User-Agent": currentUa || "Dalvik/2.1.0" } } }
                                });
                            }
                        }
                    } else if (!ch.streams.some(s => s.url === normalizedLine)) {
                        ch.streams.push({ name: isMpd ? "🔴 [Vietsub TQS] Giải mã nội bộ" : "🔴 [Phụ Đề] TQS Server", title: isMpd ? `📺 ${finalName}\n⚡ Luồng Không Bọc Khóa Bản Quyền` : `📺 ${finalName}\n⚡ Luồng HLS Nhanh & Dịch Phụ đề Tiếng Việt Chuẩn`, url: normalizedLine, behaviorHints: { isLive: true, proxyHeaders: { request: { "User-Agent": currentUa || "Dalvik/2.1.0" } } } });
                    }
                    if (key.includes("warner") && !ch.streams.some(s => s.url.includes("skygo.mn"))) {
                        ch.streams.push({ name: "⚡ [Dự Phòng] Warner HD Mở Rộng", title: `📺 Warner TV HD\n⚡ Phân Phát Máy Chủ Ngoại`, url: "http://cdn4.skygo.mn/live/disk1/Warner/HLSv3-FTA/Warner.m3u8", behaviorHints: { isLive: true } });
                    }
                }
                currentName = ""; currentUa = "Dalvik/2.1.0";
            }
        }
    } catch(e) {}

    try {
        const vRes = await axios.get(`${VIPTORRENT_BASE}/catalog/tv/viptorrent_iptv_vn.json`, { timeout: 1500 }).catch(() => null);
        const vipMetas = vRes?.data?.metas || [];
        vipMetas.forEach(v => {
            if (isScrapedMatchOrJunkEntry(v)) return;
            const key = normalizeTvKey(v.name); if (!key) return;
            if (isNonEssentialInternationalChannel({ key, name: v.name })) return;
            const channelId = `iptv_${key}`;
            if (!channelMap.has(key)) { 
                channelMap.set(key, { 
                    id: channelId, 
                    key, 
                    name: v.name, 
                    poster: v.poster || "https://via.placeholder.com/300x200?text=TV", 
                    genre: "📺 Truyền Hình", 
                    streams: [] 
                }); 
            }
            const item = channelMap.get(key);
            if (!item.poster || item.poster.includes("placeholder")) { item.poster = v.poster; } item.vipId = v.id;
            item.streams.push({ name: "🔴 [VipTorrent IPTV]", title: `📺 ${v.name}\n💎 Luồng Chính Thức Máy Chủ VipTorrent`, url: `${VIPTORRENT_BASE}/stream/tv/${v.id}.json`, isVipApi: true, behaviorHints: { isLive: true } });
        });
    } catch (e) {}

    const result = Array.from(channelMap.values()).sort((a, b) => { const sA = getTvSortRank(a.name, a.genre); const sB = getTvSortRank(b.name, b.genre); if (sA.rank !== sB.rank) return sA.rank - sB.rank; if (sA.sub !== sB.sub) return sA.sub - sB.sub; return (a.name || "").localeCompare(b.name || ""); });
    if (result.length > 0 && cache) cache.set("unified_tv_channels_v5", result, 1800); 
    
    // Cập nhật thống kê Bot Harvester
    let keyCount = 0;
    result.forEach(ch => { if (ch.streams && ch.streams.some(st => st.isClearkeyFlag)) keyCount++; });
    botSyncTelemetry.channelCount = result.length;
    botSyncTelemetry.clearKeyCount = keyCount;
    botSyncTelemetry.lastSync = Date.now();
    botSyncTelemetry.status = "Active & Synced 🟢";

    return result;
};

// BỘ LÀM MỚI KÊNH VÀ CLEARKEY TỰ ĐỘNG THEO LỊCH HOẶC THEO YÊU CẦU
const refreshChannelsAndClearKeys = async (cache, force = false) => {
    if (!force && cache && cache.get("unified_tv_channels_v5")) {
        const cached = cache.get("unified_tv_channels_v5");
        botSyncTelemetry.channelCount = cached.length;
        botSyncTelemetry.clearKeyCount = cached.filter(c => c.streams?.some(s => s.isClearkeyFlag)).length;
        return cached;
    }
    try {
        if (cache && force) cache.del("unified_tv_channels_v5");
        const channels = await fetchUnifiedTvChannels(cache);
        botSyncTelemetry.syncLog.unshift(`[${new Date().toLocaleTimeString('vi-VN')}] Đã đồng bộ ${channels.length} kênh (${botSyncTelemetry.clearKeyCount} ClearKey DRM)`);
        if (botSyncTelemetry.syncLog.length > 10) botSyncTelemetry.syncLog.pop();
        return channels;
    } catch (err) {
        botSyncTelemetry.status = "Sync Failed ⚠️";
        console.error("Bot sync error:", err.message);
        return [];
    }
};

const getChannelEpgInfo = async (channelName, cache) => {
    const clean = (channelName || "").toLowerCase(); const h = (new Date().getUTCHours() + 7) % 24; const m = new Date().getUTCMinutes(); const time = `${h < 10 ? '0'+h : h}:${m < 10 ? '0'+m : m}`;
    if (clean.includes("hbo") || clean.includes("warner")) return `📺 Đang Phát Tới 24h: Các Tác Phẩm Bom Tấn (Đã Có Vietsub)`; if (clean.includes("vtv3")) return `📺 Lịch phát sóng [${time}]: Phim Giờ Vàng`; if (clean.includes("sport")) return `⚽ Trực Tiếp Thể Thao [${time}]`; return `📺 Truyền Hình Trực Tiếp [${time}]`;
};

// =========================================================================
// 4. BÓNG ĐÁ M3U EXTRACTOR & COLA TV (VUMINHTHANH) CHRONOLOGICAL SORTER
// =========================================================================
const COLA_TV_LOGO = "https://raw.githubusercontent.com/quanlehong539/VTC-Now/refs/heads/main/ColaTV_logo.png";
const GAVANG_33_LOGO = "https://raw.githubusercontent.com/quanlehong539/VTC-Now/refs/heads/main/GaVang33_logo.png";
const KHANDAI_TV_LOGO = "https://khandai1.link/images/logo-220.webp";
const GAVANG_24H_LOGO = "https://cdn.gavangtv2026c.com/2026/07/cropped-gavangtv-logo.webp";
const XOICHE_TV_LOGO = "https://xoiche2.live/images/logo-220.webp";
const COLA_TV_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const COLA_TV_STREAMS = [
    { id: "cola_aqua", name: "BLV Aqua", streamUrl: "https://live05.msdht.app/live/18812304.m3u8" },
    { id: "cola_bidao", name: "BLV Bí Đao", streamUrl: "https://live05.msdht.app/live/99121525.m3u8" },
    { id: "cola_casting", name: "BLV Casting", streamUrl: "https://live05.msdht.app/live/84753337.m3u8" },
    { id: "cola_coca", name: "BLV Coca", streamUrl: "https://live05.msdht.app/live/24561735.m3u8" },
    { id: "cola_cozy", name: "BLV Cozy", streamUrl: "https://live05.msdht.app/live/87379114.m3u8" },
    { id: "cola_c2", name: "BLV C2", streamUrl: "https://live05.msdht.app/live/08552895.m3u8" },
    { id: "cola_drthanh", name: "BLV Dr Thanh", streamUrl: "https://live05.msdht.app/live/79665343.m3u8" },
    { id: "cola_fanta", name: "BLV Fanta", streamUrl: "https://live05.msdht.app/live/71426314.m3u8" },
    { id: "cola_gialang", name: "BLV Già Làng", streamUrl: "https://live05.msdht.app/live/14830711.m3u8" },
    { id: "cola_hovan", name: "BLV Hổ Vằn", streamUrl: "https://live05.msdht.app/live/07428422.m3u8" },
    { id: "cola_khongdo", name: "BLV Không Độ", streamUrl: "https://live05.msdht.app/live/41943555.m3u8" },
    { id: "cola_lavie", name: "BLV Lavie", streamUrl: "https://live05.msdht.app/live/75748097.m3u8" },
    { id: "cola_monster", name: "BLV Monster", streamUrl: "https://live05.msdht.app/live/75915087.m3u8" },
    { id: "cola_mountaindew", name: "BLV Mountain Dew", streamUrl: "https://live05.msdht.app/live/87547578.m3u8" },
    { id: "cola_olong", name: "BLV Ôlong", streamUrl: "https://live05.msdht.app/live/97312754.m3u8" },
    { id: "cola_pepsi", name: "BLV Pepsi", streamUrl: "https://live05.msdht.app/live/43612277.m3u8" },
    { id: "cola_pocari", name: "BLV Pocari", streamUrl: "https://live05.msdht.app/live/19919577.m3u8" },
    { id: "cola_redbull", name: "BLV Redbull", streamUrl: "https://live05.msdht.app/live/68848594.m3u8" },
    { id: "cola_revive", name: "BLV Revive", streamUrl: "https://live05.msdht.app/live/33982309.m3u8" },
    { id: "cola_rockstar", name: "BLV Rockstar", streamUrl: "https://live05.msdht.app/live/82054853.m3u8" },
    { id: "cola_rongdo", name: "BLV Rồng Đỏ", streamUrl: "https://live05.msdht.app/live/88508431.m3u8" },
    { id: "cola_samurai", name: "BLV Samurai", streamUrl: "https://live05.msdht.app/live/07808742.m3u8" },
    { id: "cola_soda", name: "BLV Soda", streamUrl: "https://live05.msdht.app/live/02456966.m3u8" },
    { id: "cola_sprite", name: "BLV Sprite", streamUrl: "https://live05.msdht.app/live/03698521.m3u8" }
].map(ch => ({
    ...ch,
    shortGroup: "COLA TV",
    group: "🔴 ⚽ COLA TV",
    poster: COLA_TV_LOGO,
    userAgent: COLA_TV_UA
}));

const GAVANG_33_STREAMS = [
    { id: "gavang33_sieubeu", name: "BLV Gà Siêu Bệu", streamUrl: "https://live2.zktsva.app/live/289650.m3u8" },
    { id: "gavang33_sieukieu", name: "BLV Gà Siêu Kiêu", streamUrl: "https://live2.zktsva.app/live/741294.m3u8" },
    { id: "gavang33_sieungo", name: "BLV Gà Siêu Ngố", streamUrl: "https://live2.zktsva.app/live/301238.m3u8" },
    { id: "gavang33_sieunhi", name: "BLV Gà Siêu Nhí", streamUrl: "https://live2.zktsva.app/live/301263.m3u8" },
    { id: "gavang33_sieupeo", name: "BLV Gà Siêu Péo", streamUrl: "https://live2.zktsva.app/live/303098.m3u8" },
    { id: "gavang33_sieuquy", name: "BLV Gà Siêu Quỷ", streamUrl: "https://live2.zktsva.app/live/304565.m3u8" },
    { id: "gavang33_sieuto", name: "BLV Gà Siêu Tồ", streamUrl: "https://live2.zktsva.app/live/796315.m3u8" },
    { id: "gavang33_sieutoc", name: "BLV Gà Siêu Tốc", streamUrl: "https://live2.zktsva.app/live/307240.m3u8" },
    { id: "gavang33_sieugay", name: "BLV Gà Siêu Gáy", streamUrl: "https://live2.zktsva.app/live/294335.m3u8" },
    { id: "gavang33_sieuson", name: "BLV Gà Siêu Son", streamUrl: "https://live2.zktsva.app/live/306290.m3u8" }
].map(ch => ({
    ...ch,
    shortGroup: "GÀ VÀNG 33",
    group: "🔴 ⚽ GÀ VÀNG 33",
    poster: GAVANG_33_LOGO,
    userAgent: COLA_TV_UA
}));

const GAVANG_33_SV2_STREAMS = [
    { id: "gavang33_sv2_olong", name: "BLV Gà Ô Long", streamUrl: "https://live2.zktsva.app/live/432017.flv" },
    { id: "gavang33_sv2_sieubeu", name: "BLV Gà Siêu Bệu", streamUrl: "https://live2.zktsva.app/live/289650.flv" },
    { id: "gavang33_sv2_sieukieu", name: "BLV Gà Siêu Kiêu", streamUrl: "https://live2.zktsva.app/live/741294.flv" },
    { id: "gavang33_sv2_sieungo", name: "BLV Gà Siêu Ngố", streamUrl: "https://live2.zktsva.app/live/301238.flv" },
    { id: "gavang33_sv2_sieunhi", name: "BLV Gà Siêu Nhí", streamUrl: "https://live2.zktsva.app/live/301263.flv" },
    { id: "gavang33_sv2_sieupeo", name: "BLV Gà Siêu Péo", streamUrl: "https://live2.zktsva.app/live/303098.flv" },
    { id: "gavang33_sv2_sieuquy", name: "BLV Gà Siêu Quỷ", streamUrl: "https://live2.zktsva.app/live/304565.flv" },
    { id: "gavang33_sv2_sieuto", name: "BLV Gà Siêu Tồ", streamUrl: "https://live2.zktsva.app/live/796315.flv" },
    { id: "gavang33_sv2_sieutoc", name: "BLV Gà Siêu Tốc", streamUrl: "https://live2.zktsva.app/live/307240.flv" },
    { id: "gavang33_sv2_sieugay", name: "BLV Gà Siêu Gáy", streamUrl: "https://live2.zktsva.app/live/294335.flv" },
    { id: "gavang33_sv2_sieuson", name: "BLV Gà Siêu Son", streamUrl: "https://live2.zktsva.app/live/306290.flv" }
].map(ch => ({
    ...ch,
    shortGroup: "GÀ VÀNG 33 SV2",
    group: "🔴 ⚽ GÀ VÀNG 33 SV2",
    poster: GAVANG_33_LOGO,
    userAgent: COLA_TV_UA
}));

const KHANDAI_TV_STREAMS = [
    { id: "khandai_chimnho", name: "BLV Chim Nhỏ", streamUrl: "https://luong.phaohoa.live/live/phaohoa5/index.m3u8" },
    { id: "khandai_enzo", name: "BLV Enzo", streamUrl: "https://luong.phaohoa.live/live/phaohoa2/index.m3u8" },
    { id: "khandai_famy", name: "BLV Famy", streamUrl: "https://luong.phaohoa.live/live/phaohoa6/index.m3u8" },
    { id: "khandai_nguoikien", name: "BLV Người Kiến", streamUrl: "https://luong.phaohoa.live/live/phaohoa1/index.m3u8" },
    { id: "khandai_kaka", name: "BLV KaKa", streamUrl: "https://luong.phaohoa.live/live/phaohoa7/index.m3u8" },
    { id: "khandai_phaothu", name: "BLV Pháo Thủ", streamUrl: "https://luong.phaohoa.live/live/phaohoa4/index.m3u8" },
    { id: "khandai_tay", name: "BLV Tày", streamUrl: "https://luong.phaohoa.live/live/phaohoa8/index.m3u8" },
    { id: "khandai_tieumay", name: "BLV Tiểu Mây", streamUrl: "https://luong.phaohoa.live/live/phaohoa9/index.m3u8" },
    { id: "khandai_vanminh", name: "BLV Văn Minh", streamUrl: "https://luong.phaohoa.live/live/phaohoa3/index.m3u8" },
    { id: "khandai_leesin", name: "BLV Lee Sin", streamUrl: "https://luong.phaohoa.live/live/phaohoa10/index.m3u8" }
].map(ch => ({
    ...ch,
    shortGroup: "KHÁN ĐÀI TV",
    group: "🔴 ⚽ 🏐 KHÁN ĐÀI TV",
    poster: KHANDAI_TV_LOGO,
    userAgent: COLA_TV_UA
}));

const GAVANG_24H_STREAMS = [
    { id: "gavang24h_suplo", name: "BLV SÚP LƠ", streamUrl: "https://playback.livetl004.com/live/6a9a5525864ea536c2577392.flv" },
    { id: "gavang24h_cris", name: "BLV CRIS", streamUrl: "https://playback.livetl004.com/live/69aa9525f5ec459ae275b43f.flv" },
    { id: "gavang24h_giangadan", name: "BLV GIÀNG A DÂN", streamUrl: "https://playback.livetl004.com/live/69f42e961f739deff81510c0.flv" },
    { id: "gavang24h_saitama", name: "BLV SAITAMA", streamUrl: "https://playback.livetl004.com/live/69f42e961f739deff81510c0.flv" },
    { id: "gavang24h_sieuquay", name: "BLV SIÊU QUẬY", streamUrl: "https://playback.livetl002.com/live/6a2a59b347bbddd62a8dc4e4.flv" },
    { id: "gavang24h_cotunghiem", name: "BLV CỐ TƯ NGHIÊM", streamUrl: "https://playback.livetl004.com/live/69a1aaa7230584579e2d5ce1.flv" },
    { id: "gavang24h_kayti", name: "BLV KAYTI", streamUrl: "https://playback.livetl004.com/live/69b8e6f43bcf2231c35d5144.flv" },
    { id: "gavang24h_camap", name: "BLV CÁ MẬP", streamUrl: "https://playback.livetl006.com/live/6a0c7c4b1ae4d6db02433c48.flv" },
    { id: "gavang24h_lubo", name: "BLV LỮ BỐ", streamUrl: "https://playback.livetl006.com/live/6a9776215126529dede9bf51.flv" },
    { id: "gavang24h_thichduthu", name: "BLV THÍCH ĐỦ THỨ", streamUrl: "https://playback.livetl002.com/live/6a704ad865997681f18c2160.flv" },
    { id: "gavang24h_khanghi", name: "BLV KHANG HI", streamUrl: "https://playback.livetl006.com/live/6a7c0d8f65997681f18cacc4.flv" },
    { id: "gavang24h_rio", name: "BLV RIO", streamUrl: "https://playback.livetl004.com/live/6a01a2511e8555d7a3685f5c.flv" },
    { id: "gavang24h_mannui", name: "BLV MÁN NÚI", streamUrl: "https://playback.livetl002.com/live/69cf6331585c5992182f4160.flv" },
    { id: "gavang24h_along", name: "BLV A LONG", streamUrl: "https://playback.livetl004.com/live/69ef10b47146e04fbe6d4363.flv" },
    { id: "gavang24h_meomeo", name: "BLV MEOMEO", streamUrl: "https://playback.livetl004.com/live/69be75e0a0a45974afb67776.flv" },
    { id: "gavang24h_doandu", name: "BLV ĐOÀN DỰ", streamUrl: "https://playback.livetl006.com/live/6a5df755b89dded67b39b8bc.flv" },
    { id: "gavang24h_nguoikien", name: "BLV NGƯỜI KIẾN", streamUrl: "https://playback.livetl004.com/live/6a439a7fb89dded67b208b87.flv" },
    { id: "gavang24h_titan", name: "BLV Titan", streamUrl: "https://playback.livetl006.com/live/69d37c3a4da3e15776b6db56.flv" }
].map(ch => ({
    ...ch,
    shortGroup: "GÀ VÀNG 24h",
    group: "🔴 ⚽ 🏐 GÀ VÀNG 24h",
    poster: GAVANG_24H_LOGO,
    userAgent: COLA_TV_UA
}));

const XOICHE_TV_STREAMS = [
    { id: "xoiche_xoixeo", name: "BLV Xôi Xéo", streamUrl: "https://live.khoga.space/live/livehub1/index.m3u8" },
    { id: "xoiche_xoiga", name: "BLV Xôi Gà", streamUrl: "https://live.khoga.space/live/livehub2/index.m3u8" },
    { id: "xoiche_xoixoai", name: "BLV Xôi Xoài", streamUrl: "https://live.khoga.space/live/livehub3/index.m3u8" },
    { id: "xoiche_garung", name: "BLV Gà Rừng", streamUrl: "https://live.khoga.space/live/livehub4/index.m3u8" },
    { id: "xoiche_khoche", name: "BLV Khô Chè", streamUrl: "https://live.khoga.space/live/livehub5/index.m3u8" },
    { id: "xoiche_gatre", name: "BLV Gà Tre", streamUrl: "https://live.khoga.space/live/livehub6/index.m3u8" },
    { id: "xoiche_tammao", name: "BLV Tam Mao", streamUrl: "https://live.khoga.space/live/livehub8/index.m3u8" },
    { id: "xoiche_khocay", name: "BLV Khô Cay", streamUrl: "https://live.khoga.space/live/livehub9/index.m3u8" },
    { id: "xoiche_tay", name: "BLV Tày", streamUrl: "https://live.khoga.space/live/livehub10/index.m3u8" }
].map(ch => ({
    ...ch,
    shortGroup: "XÔI CHÈ TV",
    group: "🔴 ⚽ 🏐 XÔI CHÈ TV",
    poster: XOICHE_TV_LOGO,
    userAgent: COLA_TV_UA
}));

const ALL_COMMENTATOR_STREAMS = [
    ...COLA_TV_STREAMS,
    ...GAVANG_33_STREAMS,
    ...GAVANG_33_SV2_STREAMS,
    ...KHANDAI_TV_STREAMS,
    ...GAVANG_24H_STREAMS,
    ...XOICHE_TV_STREAMS
];

function getVietnamNow() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (7 * 3600000));
}

function parseMatchKickoffTime(rawTitle) {
    if (!rawTitle) return { timestamp: null, status: 'undated', formattedTime: '', diffMinutes: 0 };
    const vnNow = getVietnamNow();
    const currentYear = vnNow.getFullYear();
    const currentMonth = vnNow.getMonth() + 1;
    const currentDay = vnNow.getDate();

    let hour = null, minute = null, day = null, month = null, year = currentYear;
    let isExplicitLive = /(?:^|\s|\[)(?:live|trực tiếp|đang đá|hiệp 1|hiệp 2)(?:\s|\]|$)/i.test(rawTitle);

    // Pattern 1: 19:30 18/10 or 19h30 18-10 or 19:30 18/10/2026
    const p1 = rawTitle.match(/(?:^|[^\d])(\d{1,2})[h:](\d{2})\s*[-/|\s]\s*(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/i);
    // Pattern 2: 18/10 19:30 or 18/10/2026 19:30
    const p2 = rawTitle.match(/(?:^|[^\d])(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\s*[-/|\s]\s*(\d{1,2})[h:](\d{2})/i);
    // Pattern 3: [19:30] or 19h30
    const p3 = rawTitle.match(/(?:^|[^\d])(\d{1,2})[h:](\d{2})(?![h:\d])/i);

    if (p1) {
        hour = parseInt(p1[1], 10); minute = parseInt(p1[2], 10);
        day = parseInt(p1[3], 10); month = parseInt(p1[4], 10);
        if (p1[5]) year = parseInt(p1[5], 10);
    } else if (p2) {
        day = parseInt(p2[1], 10); month = parseInt(p2[2], 10);
        if (p2[3]) year = parseInt(p2[3], 10);
        hour = parseInt(p2[4], 10); minute = parseInt(p2[5], 10);
    } else if (p3) {
        hour = parseInt(p3[1], 10); minute = parseInt(p3[2], 10);
        day = currentDay; month = currentMonth;
    }

    if (hour !== null && minute !== null && day !== null && month !== null) {
        const matchVnDate = new Date(year, month - 1, day, hour, minute, 0);
        const diffMinutes = (vnNow.getTime() - matchVnDate.getTime()) / (60 * 1000);
        const formattedTime = (hour < 10 ? '0' + hour : hour) + ':' + (minute < 10 ? '0' + minute : minute) + ' ' + (day < 10 ? '0' + day : day) + '/' + (month < 10 ? '0' + month : month);

        let status = 'upcoming';
        if (isExplicitLive || (diffMinutes >= -15 && diffMinutes <= 135)) {
            status = 'live';
        } else if (diffMinutes > 135) {
            status = 'ended';
        }

        return {
            timestamp: matchVnDate.getTime(),
            status,
            formattedTime,
            diffMinutes,
            hour, minute, day, month, year
        };
    }

    return {
        timestamp: null,
        status: isExplicitLive ? 'live' : 'undated',
        formattedTime: isExplicitLive ? 'LIVE' : '',
        diffMinutes: 0
    };
}

function sortFootballMatchesChronologically(matches) {
    return matches.sort((a, b) => {
        const tA = a.timing || parseMatchKickoffTime(a.name || a.rawName || '');
        const tB = b.timing || parseMatchKickoffTime(b.name || b.rawName || '');

        const statusWeight = { 'live': 1, 'upcoming': 2, 'undated': 3, 'ended': 4 };
        const wA = statusWeight[tA.status] || 3;
        const wB = statusWeight[tB.status] || 3;

        if (wA !== wB) return wA - wB;

        // Both are LIVE: most recent kickoff first (or highest stream count)
        if (tA.status === 'live' && tB.status === 'live') {
            if (tA.timestamp && tB.timestamp) return b.timestamp - a.timestamp;
            return (b.streams?.length || 0) - (a.streams?.length || 0);
        }

        // Both are UPCOMING: earliest kickoff first (nearest future)
        if (tA.status === 'upcoming' && tB.status === 'upcoming') {
            if (tA.timestamp && tB.timestamp) return tA.timestamp - tB.timestamp;
        }

        // Concluded / ended: most recent first
        if (tA.status === 'ended' && tB.status === 'ended') {
            if (tA.timestamp && tB.timestamp) return b.timestamp - a.timestamp;
        }

        return (b.streams?.length || 0) - (a.streams?.length || 0);
    });
}

function generateFootballM3uPlaylist(matches, options = {}) {
    const lines = [
        '#EXTM3U name="TUNGNUI PRO - Trực Tiếp Bóng Đá & Cola TV"',
        `# Lịch Phát Sóng Cập Nhật Theo Giờ Việt Nam (GMT+7) - ${new Date().toISOString()}`,
        `# Tự Động Phân Loại: Đang Diễn Ra (LIVE) -> Sắp Khởi Tranh (Sắp Diễn Ra)`
    ];
    const groupFilter = options.group || 'all';

    for (const m of matches) {
        if (!m || !Array.isArray(m.streams)) continue;
        if (groupFilter === 'cola' && !m.name?.includes('COLA TV') && !m.genre?.includes('COLA TV') && !m.id?.includes('cola_')) continue;

        for (let i = 0; i < m.streams.length; i++) {
            const st = m.streams[i];
            if (!st.url || !st.url.startsWith('http')) continue;

            const streamLabel = m.streams.length > 1 ? `${m.name} (${st.name || `Link ${i + 1}`})` : m.name;
            const groupTitle = m.genre || (m.name?.includes('COLA TV') ? "🔴 ⚽ COLA TV" : "🔴 ⚽ TRỰC TIẾP HÔM NAY");
            const logo = m.poster || COLA_TV_LOGO;
            const ua = st.behaviorHints?.proxyHeaders?.request?.["User-Agent"] || COLA_TV_UA;

            lines.push(`#EXTINF:-1 group-title="${groupTitle}" tvg-logo="${logo}", ${streamLabel}`);
            if (ua) {
                lines.push(`#EXTVLCOPT:http-user-agent=${ua}`);
            }
            lines.push(st.url);
        }
    }

    return lines.join("\n");
}

const fetchLiveMatches = async (cache) => {
    const cached = cache ? cache.get("live_sports_matches_v2") : null;
    if (cached) return cached;

    const matchesMap = new Map();
    // Use dedicated sports & football live schedule M3U (excluding general TV playlists)
    const M3U_BONG_DA = [ 
        "https://thtt.pages.dev/tttt.m3u"
    ];

    const TV_IGNORE_KEYWORDS = [
        'vtv', 'htv', 'vtvcab', 'sctv', 'thvl', 'antv', 'qpvn', 'vtc', 
        'radio', 'vov', 'voh', 'trong nước', 'địa phương', 'thiết yếu', 
        'phim truyện', 'hài', 'ca nhạc', 'giải trí', 'truyền hình', 'thời sự'
    ];

    for (const m3uUrl of M3U_BONG_DA) {
        try {
            const res = await axios.get(m3uUrl, { timeout: 4500, headers: { "User-Agent": "Mozilla/5.0" } });
            const lines = res.data.split("\n");
            let currentMeta = null;

            for (let line of lines) {
                line = line.trim();
                if (line.startsWith("#EXTINF:")) {
                    const nameMatch = line.match(/,(.+)$/);
                    const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                    const groupMatch = line.match(/group-title="([^"]+)"/);

                    if (nameMatch) {
                        const rawName = nameMatch[1].replace(/\uFFFD/g, '').trim();
                        const rawNameLower = rawName.toLowerCase();
                        const groupStr = (groupMatch ? groupMatch[1] : "").toLowerCase();

                        // Skip changelog/updated markers
                        if (rawNameLower.startsWith("updated") || groupStr.startsWith("updated")) {
                            currentMeta = null;
                            continue;
                        }

                        // Strictly exclude general TV / radio channels
                        const isTvChannel = TV_IGNORE_KEYWORDS.some(k => rawNameLower.includes(k) || groupStr.includes(k));
                        const timing = parseMatchKickoffTime(rawName);
                        const hasTiming = timing.status !== 'undated';
                        const isSportsMatch = rawNameLower.includes(" vs ") || 
                                              rawName.includes("⚽") || 
                                              rawName.includes("🏀") || 
                                              rawName.includes("🏐") || 
                                              rawName.includes("🎮") || 
                                              hasTiming;

                        if (isSportsMatch && !isTvChannel) {
                            // Extract clean match title by stripping leading emojis, replacement chars, timestamps, and trailing commentator parentheses
                            let cleanMatchName = rawName
                                .replace(/^([^\w\d\u00C0-\u1EF9]+)?(\d{1,2}[h:]\d{2}\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\s+)?([^\w\d\u00C0-\u1EF9]+)?/i, '')
                                .split(/\[|\(|\- |\|/)[0]
                                .trim();
                            if (!cleanMatchName) cleanMatchName = rawName;

                            const matchKey = cleanMatchName
                                .toLowerCase()
                                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                                .replace(/\b(fc|clb|sc|cf|ac|afc|fk)\b/g, '')
                                .replace(/[^a-z0-9]/g, '');

                            let displayName = `⚽ ${cleanMatchName}`;
                            if (timing.status === 'live') {
                                displayName = `🔴 [LIVE] ${timing.formattedTime ? `${timing.formattedTime} • ` : ''}${cleanMatchName}`;
                            } else if (timing.status === 'upcoming' && timing.formattedTime) {
                                displayName = `⏳ [${timing.formattedTime}] ${cleanMatchName}`;
                            }

                            const hashKey = matchKey || Buffer.from(cleanMatchName).toString("hex");
                            currentMeta = { 
                                rawName, 
                                matchKey: hashKey,
                                matchName: cleanMatchName, 
                                displayName,
                                matchId: "match_m3u_" + hashKey.slice(0, 24), 
                                poster: logoMatch ? logoMatch[1] : "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=500&q=80", 
                                group: groupMatch ? groupMatch[1] : "⚽ Trực Tiếp Hôm Nay",
                                timing
                            };
                        } else {
                            currentMeta = null;
                        }
                    }
                } else if (line.startsWith("http") && currentMeta) {
                    const mapKey = currentMeta.matchKey || currentMeta.matchName;
                    if (!matchesMap.has(mapKey)) { 
                        matchesMap.set(mapKey, { 
                            id: currentMeta.matchId, 
                            name: currentMeta.displayName, 
                            poster: currentMeta.poster, 
                            genre: currentMeta.group, 
                            description: `Trực Tiếp Thể Thao Đỉnh Cao (M3U)${currentMeta.timing.formattedTime ? ` • Giờ đá: ${currentMeta.timing.formattedTime}` : ''}`, 
                            timing: currentMeta.timing,
                            streams: [] 
                        }); 
                    }
                    const matchEntry = matchesMap.get(mapKey);

                    // Extract commentator from parentheses e.g. (Tào Duệ), (Nguyễn Ánh)
                    const blvMatch = currentMeta.rawName.match(/\(([^)]+)\)/);
                    const blvName = blvMatch ? blvMatch[1].trim() : '';
                    let streamName = blvName ? `🎙️ BLV ${blvName}` : (currentMeta.rawName.replace(currentMeta.matchName, "").trim() || 'Link Trực Tiếp');
                    if (streamName.startsWith('🔴 [M3U]')) streamName = `🎙️ BLV Tiếng Việt`;

                    let headerInject = { "User-Agent": "Mozilla/5.0" };
                    if (line.includes("gavang")) headerInject = { "Referer": "https://gavang.tv/", "Origin": "https://gavang.tv/" }; 
                    if (line.includes("socolive") || line.includes("vebo")) headerInject = { "Referer": "https://socolive.pro/" };

                    matchEntry.streams.push({ 
                        name: streamName.substring(0, 35), 
                        title: `⚽ ${currentMeta.rawName}\n⚡ Luồng Phát Trực Tiếp M3U`, 
                        url: line, 
                        behaviorHints: { isLive: true, proxyHeaders: { request: headerInject } } 
                    }); 
                    currentMeta = null;
                }
            }
        } catch (e) {}
    }

    // Nạp toàn bộ 81 kênh BLV Thể Thao Trực Tiếp (Gà Vàng 33, Gà Vàng 24h, Xôi Chè, Cola TV, Khán Đài TV)
    ALL_COMMENTATOR_STREAMS.forEach(ch => {
        matchesMap.set(ch.id, {
            id: `match_${ch.id}`,
            name: `🔴 [${ch.shortGroup || 'BLV'}] ${ch.name}`,
            poster: ch.poster,
            genre: ch.group,
            description: `Kênh BLV ${ch.name} - Trực Tiếp Thể Thao & Bóng Đá (${ch.group})`,
            timing: { timestamp: null, status: 'undated', formattedTime: '24/7', diffMinutes: 0 },
            streams: [
                {
                    name: `🔴 [${ch.shortGroup || 'BLV'}] ${ch.name}`,
                    title: `📺 BLV ${ch.name} (${ch.group})\n⚡ Phát Sóng Trực Tiếp`,
                    url: ch.streamUrl,
                    behaviorHints: { isLive: true, proxyHeaders: { request: { "User-Agent": ch.userAgent } } }
                }
            ]
        });
    });

    let matches = Array.from(matchesMap.values());
    if (matches.length === 0) { 
        matches.push({ 
            id: "match_error_fallback", 
            name: "📡 Radar Đang Cập Nhật Trận Đấu", 
            poster: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=500", 
            genre: "⚽ Radar Thể Thao", 
            description: "Các Trận Đấu Trực Tiếp thường sẽ được hệ thống lên sóng trước 30 Phút khi bóng lăn. Vui lòng trở lại sau.", 
            timing: { timestamp: null, status: 'undated', formattedTime: '', diffMinutes: 0 },
            streams: [] 
        }); 
    }

    // Sắp xếp theo trình tự thời gian nghiêm ngặt: LIVE (Đang Đá) trước, tiếp theo Sắp Đá (Gần nhất -> Xa nhất)
    matches = sortFootballMatchesChronologically(matches);
    if (cache) cache.set("live_sports_matches_v2", matches, 150); 
    return matches;
};

// ĐÃ CHỈNH LẠI HÀM SẮP XẾP TV CỐ TÌNH ĐƯA LINK DRM CHỨA CỜ NHẬN DIỆN LÊN ĐỈNH BẢNG!
const getChannelStreams = async (rawId, cache, debridKey = "") => {
    if (rawId.startsWith("match_")) { 
        const matches = await fetchLiveMatches(cache); const foundMatch = matches.find(m => m.id === rawId); 
        if (foundMatch && foundMatch.streams) { 
            let finalStreams = [...foundMatch.streams]; 
            if (debridKey) { finalStreams.unshift({ name: `⚡ [Real-Debrid] Mạng P2P 4K`, title: `⚽ Băng Thông Trực Tiếp Không Đáy`, url: `https://real-debrid.com/streaming/unrestricted?token=${debridKey}`, behaviorHints: { isLive: true } }); }
            return finalStreams; 
        } 
    }

    const channels = await fetchUnifiedTvChannels(cache);
    const targetKey = rawId.replace(/^iptv_/, "").replace(/^vmttv_/, "").replace(/^vmt_/, "").replace(/^scraped_/, "");
    const found = channels.find(c => 
        c.id === rawId || 
        c.legacyId === rawId || 
        c.key === targetKey || 
        (c.id && c.id.replace(/^iptv_/, "").replace(/^vmttv_/, "").replace(/^vmt_/, "") === targetKey) || 
        (c.vipId && (c.vipId === rawId || c.vipId === targetKey))
    );
    if (!found) {
        for (const fbKey of Object.keys(FALLBACK_TV_POOLS)) { if (targetKey.includes(fbKey)) { return FALLBACK_TV_POOLS[fbKey].map((url, idx) => ({ name: `🌐 [Dự Phòng ${idx + 1}]`, title: `📺 Kênh Trực Tiếp`, url, behaviorHints: { isLive: true } })); } }
        return [];
    }

    const finalStreams = [];
    for (const st of found.streams) {
        if (st.isVipApi && found.vipId) {
            try { 
                let res = null;
                // Kênh trực tiếp trên VipTorrent được đánh chỉ mục theo category/movie
                try {
                    res = await axios.get(`${VIPTORRENT_BASE}/stream/movie/${found.vipId}.json`, { 
                        timeout: 3500, 
                        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json, text/html, */*" },
                        responseType: "text",
                        transformResponse: [(data) => data]
                    });
                } catch(errMovie) {
                    res = await axios.get(`${VIPTORRENT_BASE}/stream/tv/${found.vipId}.json`, { 
                        timeout: 3500, 
                        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json, text/html, */*" },
                        responseType: "text",
                        transformResponse: [(data) => data]
                    });
                }
                if (res && res.data) {
                    const vStreams = parseVipTorrentResponse(res.data, "tv", found.vipId);
                    if (vStreams.length > 0) { 
                        vStreams.forEach(vst => { 
                            finalStreams.push({ 
                                name: `🔴 [VipTorrent]`, 
                                title: `📺 ${found.name}\n💎 VipTorrent Chuẩn 1080p`, 
                                url: vst.url || vst.externalUrl, 
                                behaviorHints: { isLive: true } 
                            }); 
                        }); 
                    } 
                }
            } catch (e) {}
        } else if (st.url && st.url.startsWith("http")) { finalStreams.push(st); }
    }

    for (const fbKey of Object.keys(FALLBACK_TV_POOLS)) { if (targetKey.includes(fbKey)) { FALLBACK_TV_POOLS[fbKey].forEach((url, idx) => { finalStreams.push({ name: `⚡ [HLS Dự Phòng ${idx + 1}] Không Khóa Mã`, title: `📺 ${found ? found.name : 'Kênh Trực Tiếp'}\n⚡ Luồng HLS Mở Trực Tiếp`, url, behaviorHints: { isLive: true } }); }); } }

    const unique = []; const seen = new Set();
    
    // Thuật toán nhấc link DRM Web và CDN sống (vtvdigital, truyenhinhso, vmttv, freem3u) lên đỉnh ngay lập tức
    const sorted = finalStreams.sort((a, b) => {
        const uA = (a.url || "").toLowerCase();
        const uB = (b.url || "").toLowerCase();
        let sA = (a.isClearkeyFlag || a.isPipeFlag) ? 1000 : 0;
        let sB = (b.isClearkeyFlag || b.isPipeFlag) ? 1000 : 0;
        if (a.name && a.name.includes("VipTorrent")) sA += 500;
        if (b.name && b.name.includes("VipTorrent")) sB += 500;
        if (uA.includes("vtvdigital") || uA.includes("truyenhinhso") || uA.includes("vmttv.dpdns.org") || uA.includes("freem3u")) sA += 350;
        if (uB.includes("vtvdigital") || uB.includes("truyenhinhso") || uB.includes("vmttv.dpdns.org") || uB.includes("freem3u")) sB += 350;
        if (uA.includes("fptplay")) sA -= 800;
        if (uB.includes("fptplay")) sB -= 800;
        return sB - sA;
    });
    
    sorted.forEach(s => { 
        const checkUrl = s.url || s.externalUrl || "";
        if (!seen.has(checkUrl)) { seen.add(checkUrl); unique.push(s); } 
    });
    
    return unique;
};

// =========================================================================
// 5. BỘ CÀO PHIM VOD & HỖ TRỢ PHỤ ĐỀ
// =========================================================================
const fetchSubtitles = async (type, rawId) => {
    if (!rawId.startsWith("tt")) return []; const imdbId = rawId.split(":")[0];
    try { const res = await axios.get(`https://opensubtitles-v3.strem.io/subtitles/${type}/${rawId}.json`, { timeout: 2500 }); if (res.data?.subtitles) { const viSubs = res.data.subtitles.filter(s => s.lang === 'vie' || s.lang === 'vi'); if (viSubs.length > 0) { return viSubs; } } } catch (e) {}
    return [{ id: `sub_vi_${imdbId}`, url: `https://sub.vnstream.io.vn/vtt/${imdbId}.vtt`, lang: "vie", label: "🇻🇳 Tiếng Việt (Tự Động)" }];
};

const searchCustomMovieApi = async (customUrl, cleanKw, page = 1) => {
    if (!customUrl || !cleanKw) return [];
    const cleanBase = customUrl.trim().replace(/\/+$/, '');
    let parsedHost = "";
    try { parsedHost = new URL(cleanBase).hostname.replace(/^www\./, ''); } catch(e) { parsedHost = "Custom"; }

    // Dạng MacCMS VOD
    if (cleanBase.includes("api.php") || cleanBase.includes("provide/vod")) {
        try {
            const sep = cleanBase.includes("?") ? "&" : "?";
            const q = `${cleanBase}${sep}ac=detail&wd=${encodeURIComponent(cleanKw)}&pg=${page}`;
            const res = await http.get(q, { timeout: 3000 });
            const list = res.data?.list || [];
            return list.map(item => ({
                id: `custom_${item.vod_id || item.slug || Math.random().toString(36).substring(7)}`,
                type: (item.type_name || "").includes("剧") || (item.vod_name || "").includes("Tập") ? "series" : "movie",
                name: item.vod_name,
                origin_name: item.vod_en || item.vod_sub || "",
                poster: item.vod_pic || "https://via.placeholder.com/300x450?text=No+Poster",
                description: `${item.vod_en || ""} • [${parsedHost}]`
            }));
        } catch(e) { return []; }
    }

    // Dạng REST (OPhim, KKPhim, NguonC, Xink)
    const searchUrls = [
        `${cleanBase}/v1/api/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&page=${page}`,
        `${cleanBase}/api/films/search?keyword=${encodeURIComponent(cleanKw)}&page=${page}`,
        `${cleanBase}/content?keyword=${encodeURIComponent(cleanKw)}&page=${page}`,
        `${cleanBase}/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&page=${page}`
    ];

    for (const url of searchUrls) {
        try {
            const res = await http.get(url, { timeout: 2800, headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
            const items = res.data?.data?.items || res.data?.items || res.data?.list || [];
            if (Array.isArray(items) && items.length > 0) {
                return items.map(p => ({
                    id: `custom_${p.slug || p._id || p.id}`,
                    type: (p.type === "tv" || p.type === "series" || (p.name || "").includes("Tập") || p.total_episodes > 1) ? "series" : "movie",
                    name: p.name,
                    origin_name: p.origin_name || p.original_name || "",
                    poster: getImgUrl(p.thumb_url || p.poster_url || p.thumb),
                    description: `${p.origin_name || p.original_name || ""} • [${parsedHost}]`
                }));
            }
        } catch(e) {}
    }
    return [];
};

const searchAllMovieSources = async (keyword, page = 1) => {
    const endpoints = getEndpoints(); const cleanKw = (keyword || "").trim(); if (!cleanKw) return []; const noToneKw = removeVietnameseTones(cleanKw);
    const toCompactThumb = (url) => {
        const full = getImgUrl(url);
        if (full && full.startsWith("http") && !full.includes("wsrv.nl")) {
            return `https://wsrv.nl/?url=${encodeURIComponent(full)}&w=360&h=202&fit=cover&output=webp&q=80`;
        }
        return full;
    };
    const tasks = [
        http.get(`${endpoints.kkphim}/v1/api/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&limit=16&page=${page}`).then(res => (res.data?.data?.items || []).map(p => ({ id: `phim_${p.slug}`, type: (p.type === "tv" || p.type === "series" || p.total_episodes > 1) ? "series" : "movie", name: p.name, origin_name: p.origin_name || "", poster: toCompactThumb(p.thumb_url || p.poster_url), posterShape: "landscape", description: `${p.origin_name || ""} • [KKPhim]` }))).catch(() => []),
        Promise.any([ http.get(`${endpoints.vsmov}/api/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&limit=16&page=${page}`, { timeout: 3800 }), http.get(`${endpoints.vsmov}/api/tim-kiem?keyword=${encodeURIComponent(noToneKw)}&limit=16&page=${page}`, { timeout: 3800 }) ]).then(res => { const arr = res.data?.items || res.data?.data?.items || (Array.isArray(res.data?.data) ? res.data.data : []) || []; return arr.map(p => ({ id: `vsmov_${p.slug}`, type: (p.type === "tv" || p.type === "series" || (p.name || "").includes("Tập")) ? "series" : "movie", name: p.name, origin_name: p.origin_name || "", poster: toCompactThumb(p.thumb_url || p.poster_url), posterShape: "landscape", description: `${p.origin_name || ""} • [VSMOV]` })); }).catch(() => []),
        http.get(`${endpoints.ophim}/v1/api/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&limit=16&page=${page}`, { timeout: 3000 }).then(res => (res.data?.data?.items || []).map(p => ({ id: `ophim_${p.slug}`, type: (p.type === "tv" || p.type === "series" || p.total_episodes > 1) ? "series" : "movie", name: p.name, origin_name: p.origin_name || "", poster: toCompactThumb(p.thumb_url || p.poster_url), posterShape: "landscape", description: `${p.origin_name || ""} • [OPhim]` }))).catch(() => []),
        http.get(`${endpoints.nguonc}/api/films/search?keyword=${encodeURIComponent(cleanKw)}&page=${page}`, { timeout: 3000, headers: { "Accept": "application/json" } }).then(res => { const arr = (res.data?.status === "success" && Array.isArray(res.data?.items)) ? res.data.items : []; return arr.map(p => ({ id: `nguonc_${p.slug}`, type: (p.type === "tv" || p.type === "series") ? "series" : "movie", name: p.name, origin_name: p.original_name || "", poster: toCompactThumb(p.thumb_url || p.poster_url), posterShape: "landscape", description: `${p.original_name || ""} • [NguonC]` })); }).catch(() => []),
        http.get(`${endpoints.xink || 'https://api.xink.pro/api'}/content?keyword=${encodeURIComponent(cleanKw)}&page=${page}`, { timeout: 3200, headers: { "Accept": "application/json" } }).then(res => { const arr = Array.isArray(res.data?.items) ? res.data.items : []; return arr.map(p => ({ id: `xink_${p.slug}`, type: (p.type === "tv" || p.type === "series" || (p.episode_total && p.episode_total !== "1 Tập")) ? "series" : "movie", name: p.name, origin_name: p.origin_name || "", poster: toCompactThumb(p.thumb_url || p.poster_url), posterShape: "landscape", description: `${p.origin_name || ""} • [XinkPro OnFlix]` })); }).catch(() => [])
    ];
    if (Array.isArray(endpoints.customMovieApis)) {
        endpoints.customMovieApis.forEach(customUrl => {
            tasks.push(searchCustomMovieApi(customUrl, cleanKw, page).catch(() => []));
        });
    }
    const results = await Promise.allSettled(tasks); const combined = []; results.forEach(r => { if (r.status === "fulfilled" && Array.isArray(r.value)) { combined.push(...r.value); } });
    const unique = []; const seen = new Set(); combined.forEach(item => { const key = item.name.toLowerCase().trim(); if (!seen.has(key) && !isAnimeMovie(item)) { seen.add(key); unique.push({ ...item, posterShape: "landscape" }); } });
    return unique;
};

const fetchKKPhim = async (slug, targetEpisode) => {
    try { 
        const t0 = Date.now();
        const res = await http.get(`${getEndpoints().kkphim}/phim/${slug}`, { timeout: 2600 }); const movie = res.data?.movie; if (!movie) return { streams: [], movie: null }; 
        const episodes = res.data?.episodes || []; const streams = [];
        episodes.forEach(server => { 
            const sName = (server.server_name || "KKPhim VIP").trim(); const foundEp = (server.server_data || []).find((ep, idx) => { return targetEpisode === null || parseEpisodeNumber(ep.name, idx) === targetEpisode || (server.server_data && server.server_data.length === 1); });
            if (foundEp) {
                if (foundEp.link_m3u8) {
                    streams.push({
                        name: `[KKPhim Fast] ${sName}`,
                        title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n⚡ Máy Chủ Việt Nam PhimAPI (Direct HLS)`,
                        url: foundEp.link_m3u8,
                        fallbackEmbedUrl: foundEp.link_embed || `https://player.phimapi.com/player/?url=${encodeURIComponent(foundEp.link_m3u8)}`,
                        behaviorHints: { proxyHeaders: { request: { "Referer": "https://phimapi.com/", "User-Agent": "Mozilla/5.0" } } }
                    });
                }
                if (foundEp.link_embed) {
                    streams.push({
                        name: `[KKPhim Embed] ${sName}`,
                        title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🌐 Trình Phát Web / Nuvio Webview (Chống Nghẽn)`,
                        externalUrl: foundEp.link_embed,
                        embedUrl: foundEp.link_embed
                    });
                }
            }
        }); 
        if (streams.length > 0) { aiHealer.recordProviderSuccess("kkphim", Date.now() - t0); }
        return { streams, movie };
    } catch (e) { aiHealer.recordProviderFailure("kkphim"); failureTelemetry.recordFailure(); return { streams: [], movie: null }; }
};

const fetchVSMOV = async (slug, targetEpisode, title = "", origTitle = "", targetImdbId = "") => {
    const baseUrl = getEndpoints().vsmov;
    const tryFetch = async (targetSlug) => {
        if (!targetSlug) return null;
        try { 
            const t0 = Date.now();
            const res = await http.get(`${baseUrl}/api/phim/${targetSlug}`, { timeout: 2600 }); const data = res.data?.data || res.data || {}; const movie = data.movie || data.item || data; const episodes = res.data?.episodes || data.episodes || movie?.episodes || [];
            if (Array.isArray(episodes) && episodes.length > 0) { 
                const streams = [];
                for (const server of episodes) { 
                    const sName = (server.server_name || server.name || "VSMOV VIP").replace(/[\r\n]+/g, ' ').trim(); const eList = server.server_data || server.items || server.episodes || [];
                    const foundEp = eList.find((ep, idx) => { return targetEpisode === null || parseEpisodeNumber(ep.name, idx) === targetEpisode || (eList && eList.length === 1); });
                    if (foundEp) { 
                        let link = foundEp.link_m3u8 || foundEp.m3u8 || "";
                        if (!link && foundEp.link_embed) { try { const embedRes = await http.get(foundEp.link_embed, { timeout: 1800, headers: { "Referer": "https://vsmov.com/" } }); const html = typeof embedRes.data === 'string' ? embedRes.data : ''; const match = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i) || html.match(/source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i); if (match) link = match[1]; } catch (e) {} }
                        if (link && link.includes('.m3u8')) {
                            streams.push({ name: `[VSMOV 100Gbps] ${sName}`, title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🚀 CDN VSMOV 30ms Siêu Tốc`, url: link, fallbackEmbedUrl: foundEp.link_embed || "", behaviorHints: { proxyHeaders: { request: { "Referer": "https://vsmov.com/" } } } });
                        }
                        if (foundEp.link_embed) {
                            streams.push({ name: `[VSMOV Embed] ${sName}`, title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🌐 Trình Phát Web VSMOV / Nuvio Webview`, externalUrl: foundEp.link_embed, embedUrl: foundEp.link_embed });
                        }
                    }
                } 
                if (streams.length > 0) { aiHealer.recordProviderSuccess("vsmov", Date.now() - t0); return { streams, movie }; }
            }
        } catch (e) { aiHealer.recordProviderFailure("vsmov"); failureTelemetry.recordFailure(); } 
        return null;
    };
    let result = await tryFetch(slug); if (result) return result;
    if (title || origTitle) {
        try { 
            const searchCandidates = [...new Set([title, origTitle].filter(Boolean).map(t => t.replace(/\s*\(\d{4}\)/g, '').replace(/[:\-–&]/g, ' ').trim()))];
            for (const cleanTitle of searchCandidates) {
                for (const sUrl of [`${baseUrl}/api/tim-kiem?keyword=${encodeURIComponent(cleanTitle)}&limit=5`]) {
                    const sRes = await http.get(sUrl, { timeout: 2600 }); const items = sRes.data?.items || sRes.data?.data?.items || [];
                    for (const it of items.slice(0, 5)) { if (isStrictTitleMatch(title, origTitle, it.name, it.origin_name, targetImdbId, it.imdb?.id) && it.slug) { result = await tryFetch(it.slug); if (result) return result; } }
                }
            }
        } catch (e) {}
    } 
    return { streams: [], movie: null };
};

const fetchOPhim = async (slug, targetEpisode, title = "", origTitle = "") => {
    const rawOphim = getEndpoints().ophim || "https://ophim1.com";
    const candidateDomains = [
        rawOphim,
        "https://ophim1.com",
        "https://ophim17.cc",
        "https://ophim.live",
        "https://ophim.vip"
    ];
    const domains = [...new Set(candidateDomains.filter(Boolean))];

    const tryFetch = async (targetSlug) => {
        if (!targetSlug) return null;
        for (const baseUrl of domains) {
            const cleanBase = baseUrl.replace(/\/+$/, '');
            for (const pathPrefix of ['/v1/api/phim', '/phim']) {
                try {
                    const t0 = Date.now();
                    const res = await http.get(`${cleanBase}${pathPrefix}/${targetSlug}`, { 
                        timeout: 2800,
                        headers: { 
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                            "Accept": "application/json, text/plain, */*" 
                        }
                    });
                    const data = res.data?.data || res.data || {};
                    const movie = data.item || data.movie || (data.status === 'success' ? data.data?.item : null);
                    const episodes = movie?.episodes || data.episodes || [];
                    if (Array.isArray(episodes) && episodes.length > 0) {
                        const streams = [];
                        for (const server of episodes) {
                            const sName = (server.server_name || "OPhim VIP").trim();
                            const eList = server.server_data || server.items || [];
                            const foundEp = eList.find((ep, idx) => targetEpisode === null || parseEpisodeNumber(ep.name, idx) === targetEpisode || (eList && eList.length === 1));
                            const link = foundEp?.link_m3u8 || foundEp?.m3u8;
                            if (foundEp && link) {
                                streams.push({
                                    name: `[OPhim VIP] ${sName}`,
                                    title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🚀 CDN OPhim 100Gbps Nhanh Mượt`,
                                    url: link,
                                    fallbackEmbedUrl: foundEp.link_embed || "",
                                    behaviorHints: { proxyHeaders: { request: { "Referer": `${cleanBase}/`, "User-Agent": "Mozilla/5.0" } } }
                                });
                            }
                            if (foundEp && foundEp.link_embed) {
                                streams.push({
                                    name: `[OPhim Embed] ${sName}`,
                                    title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🌐 Trình Phát Web OPhim / Nuvio Webview`,
                                    externalUrl: foundEp.link_embed,
                                    embedUrl: foundEp.link_embed
                                });
                            }
                        }
                        if (streams.length > 0) {
                            aiHealer.recordProviderSuccess("ophim", Date.now() - t0);
                            return { streams, movie };
                        }
                    }
                } catch (e) {}
            }
        }
        return null;
    };

    let result = await tryFetch(slug);
    if (result) return result;

    if (title || origTitle) {
        const searchCandidates = [...new Set([title, origTitle].filter(Boolean).map(t => t.replace(/\s*\(\d{4}\)/g, '').replace(/[:\-–&]/g, ' ').trim()))];
        for (const cleanTitle of searchCandidates) {
            for (const baseUrl of domains) {
                const cleanBase = baseUrl.replace(/\/+$/, '');
                for (const searchPath of ['/v1/api/tim-kiem?keyword=', '/tim-kiem?keyword=']) {
                    try {
                        const sRes = await http.get(`${cleanBase}${searchPath}${encodeURIComponent(cleanTitle)}&limit=5`, { 
                            timeout: 2800,
                            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
                        });
                        const items = sRes.data?.data?.items || sRes.data?.items || [];
                        for (const it of items.slice(0, 5)) {
                            if (isStrictTitleMatch(title, origTitle, it.name, it.origin_name || it.original_name, "", "") && it.slug) {
                                result = await tryFetch(it.slug);
                                if (result) return result;
                            }
                        }
                    } catch (e) {}
                }
            }
        }
    }
    return { streams: [], movie: null };
};

const fetchNguonC = async (slug, targetEpisode, title = "", origTitle = "") => {
    const rawBase = getEndpoints().nguonc || "https://phim.nguonc.com";
    const baseUrl = rawBase.replace(/\/api\/?$/, ''); // Strip /api to prevent double /api/api/

    const tryFetch = async (targetSlug) => { 
        if (!targetSlug) return null;
        try { 
            const t0 = Date.now();
            const res = await http.get(`${baseUrl}/api/film/${targetSlug}`, { 
                timeout: 3200, 
                headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } 
            });
            if (res.data?.status === "success" && res.data?.movie) { 
                const movie = res.data.movie; 
                const streams = [];
                (movie.episodes || []).forEach(server => { 
                    const sName = (server.server_name || "NguonC VIP").trim(); 
                    const foundEp = (server.items || []).find((ep, idx) => { 
                        return targetEpisode === null || parseEpisodeNumber(ep.name, idx) === targetEpisode || (server.items && server.items.length === 1); 
                    }); 
                    if (foundEp) {
                        const link = foundEp.m3u8 || foundEp.link_m3u8; 
                        const embedLink = foundEp.embed || foundEp.link_embed;
                        if (link && link.includes('.m3u8')) { 
                            streams.push({ 
                                name: `[NguonC HLS] ${sName}`, 
                                title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🚀 Máy Chủ NguonC CDN`, 
                                url: link, 
                                fallbackEmbedUrl: embedLink || "",
                                behaviorHints: { proxyHeaders: { request: { "Referer": "https://phim.nguonc.com/" } } } 
                            }); 
                        }
                        if (embedLink) {
                            streams.push({
                                name: `[NguonC Embed] ${sName}`,
                                title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🌐 Trình Phát Web NguonC / Nuvio Webview`,
                                externalUrl: embedLink,
                                embedUrl: embedLink
                            });
                        }
                    }
                });
                if (streams.length > 0) { 
                    aiHealer.recordProviderSuccess("nguonc", Date.now() - t0); 
                    return { streams, movie }; 
                }
            }
        } catch (e) { 
            aiHealer.recordProviderFailure("nguonc"); 
            failureTelemetry.recordFailure(); 
        } 
        return null;
    }; 

    // 1. Try slug directly
    let result = await tryFetch(slug); 
    if (result) return result; 

    // 2. Title search fallback when slug fails or is from another provider
    if (title || origTitle) {
        try {
            const searchCandidates = [...new Set([title, origTitle].filter(Boolean).map(t => t.replace(/\s*\(\d{4}\)/g, '').replace(/[:\-–&]/g, ' ').trim()))];
            for (const cleanTitle of searchCandidates) {
                const sRes = await http.get(`${baseUrl}/api/films/search?keyword=${encodeURIComponent(cleanTitle)}&page=1`, { 
                    timeout: 3200, 
                    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } 
                });
                const items = sRes.data?.items || sRes.data?.data?.items || [];
                for (const it of items.slice(0, 5)) {
                    if (isStrictTitleMatch(title, origTitle, it.name, it.original_name || it.origin_name, "", "") && it.slug) {
                        result = await tryFetch(it.slug);
                        if (result) return result;
                    }
                }
            }
        } catch (e) {}
    }

    return { streams: [], movie: null };
};

const fetchXink = async (slug, targetEpisode, title = "", origTitle = "", targetImdbId = "") => {
    const rawBase = getEndpoints().xink || "https://api.xink.pro/api";
    const baseUrl = rawBase.replace(/\/+$/, '');

    const tryFetch = async (targetSlug) => {
        if (!targetSlug) return null;
        try {
            const t0 = Date.now();
            const res = await http.get(`${baseUrl}/phim/${targetSlug}`, {
                timeout: 3200,
                headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
            });
            if (res.data?.status && res.data?.movie) {
                const movie = res.data.movie;
                const episodes = res.data.episodes || [];
                const streams = [];

                episodes.forEach(server => {
                    const sName = (server.server_name || "XinkPro VIP").trim();
                    const eList = server.server_data || [];
                    const foundEp = eList.find((ep, idx) => {
                        return targetEpisode === null || parseEpisodeNumber(ep.name, idx) === targetEpisode || (eList && eList.length === 1);
                    });
                    if (foundEp) {
                        const link = foundEp.link_m3u8 || foundEp.m3u8;
                        if (link && link.includes('.m3u8')) {
                            streams.push({
                                name: `[XinkPro OnFlix] ${sName}`,
                                title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🚀 CDN OnFlix Akamai/Gota Siêu Tốc`,
                                url: link,
                                fallbackEmbedUrl: foundEp.link_embed || "",
                                behaviorHints: { proxyHeaders: { request: { "Referer": "https://api.xink.pro/", "User-Agent": "Mozilla/5.0" } } }
                            });
                        }
                        if (foundEp.link_embed) {
                            streams.push({
                                name: `[XinkPro Embed] ${sName}`,
                                title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🌐 Trình Phát Web OnFlix / Nuvio Webview`,
                                externalUrl: foundEp.link_embed,
                                embedUrl: foundEp.link_embed
                            });
                        }
                    }
                });

                if (streams.length > 0) {
                    aiHealer.recordProviderSuccess("xink", Date.now() - t0);
                    return { streams, movie };
                }
            }
        } catch (e) {
            aiHealer.recordProviderFailure("xink");
            failureTelemetry.recordFailure();
        }
        return null;
    };

    // 1. Thử slug trực tiếp
    let result = await tryFetch(slug);
    if (result) return result;

    // 2. Dự phòng tìm kiếm theo tên phim
    if (title || origTitle) {
        try {
            const searchCandidates = [...new Set([title, origTitle].filter(Boolean).map(t => t.replace(/\s*\(\d{4}\)/g, '').replace(/[:\-–&]/g, ' ').trim()))];
            for (const cleanTitle of searchCandidates) {
                const sRes = await http.get(`${baseUrl}/content?keyword=${encodeURIComponent(cleanTitle)}&page=1`, {
                    timeout: 3200,
                    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
                });
                const items = sRes.data?.items || [];
                for (const it of items.slice(0, 5)) {
                    if (isStrictTitleMatch(title, origTitle, it.name, it.origin_name, targetImdbId, it.tmdb_id) && it.slug) {
                        result = await tryFetch(it.slug);
                        if (result) return result;
                    }
                }
            }
        } catch (e) {}
    }

    return { streams: [], movie: null };
};

/**
 * 🌟 BỘ FETCH NGUỒN PHIM API MỚI LINH HOẠT (CUSTOM MOVIE API PARSER)
 * Tự động nhận diện cấu trúc API: OPhim/KKPhim/NguonC/Xink/MacCMS/VOD JSON
 * Trích xuất danh sách tập, m3u8, mp4, embed và gán metadata chuẩn xác.
 */
const fetchFromCustomApi = async (customApiUrl, slug, targetEpisode, title = "", origTitle = "", targetImdbId = "") => {
    if (!customApiUrl || typeof customApiUrl !== "string") return { streams: [], movie: null };
    const cleanBase = customApiUrl.trim().replace(/\/+$/, '');
    if (!cleanBase.startsWith("http")) return { streams: [], movie: null };

    let parsedHost = "";
    try {
        parsedHost = new URL(cleanBase).hostname.replace(/^www\./, '');
    } catch (e) {
        parsedHost = cleanBase.substring(0, 30);
    }

    const cleanKw = (origTitle || title || slug || "").replace(/\s*\(\d{4}\)/g, '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/season\s*\d+|phần\s*\d+|tập\s*\d+/gi, '').replace(/[:\-–&]/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Dạng MacCMS / VOD JSON
    if (cleanBase.includes("api.php") || cleanBase.includes("provide/vod")) {
        try {
            const sep = cleanBase.includes("?") ? "&" : "?";
            const queryUrl = `${cleanBase}${sep}ac=detail&wd=${encodeURIComponent(cleanKw)}`;
            const res = await http.get(queryUrl, { timeout: 3200 });
            const list = res.data?.list || [];
            if (Array.isArray(list) && list.length > 0) {
                const targetMovie = list.find(it => isStrictTitleMatch(title, origTitle, it.vod_name, it.vod_sub || it.vod_en, targetImdbId, "", null, it.vod_year));
                if (!targetMovie) return { streams: [], movie: null };
                const playUrlStr = targetMovie.vod_play_url || "";
                const streams = [];
                playUrlStr.split(/#|\$\$\$/).forEach((part, idx) => {
                    const seg = part.split('$');
                    const epName = seg.length > 1 ? seg[0].trim() : `Tập ${idx + 1}`;
                    const url = seg.length > 1 ? seg[1].trim() : seg[0].trim();
                    const epNum = parseEpisodeNumber(epName, idx);
                    if ((targetEpisode === null || epNum === targetEpisode) && url && (url.includes('.m3u8') || url.includes('.mp4'))) {
                        streams.push({
                            name: `🚀 [API: ${parsedHost}] ${targetMovie.vod_name || 'VOD'}`,
                            title: `🎬 ${targetMovie.vod_name || 'Phim'} • ${epName}\n🌐 Nguồn API: ${parsedHost}`,
                            url: url,
                            behaviorHints: { proxyHeaders: { request: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } } }
                        });
                    }
                });
                if (streams.length > 0) {
                    return { streams, movie: targetMovie };
                }
            }
        } catch (e) {}
    }

    // 2. Thử fetch chi tiết theo slug trực tiếp (REST APIs)
    const detailPaths = [];
    if (slug) {
        detailPaths.push(
            `${cleanBase}/phim/${slug}`,
            `${cleanBase}/v1/api/phim/${slug}`,
            `${cleanBase}/api/film/${slug}`,
            `${cleanBase}/content/${slug}`,
            `${cleanBase}/api/phim/${slug}`
        );
    }

    const tryExtractStreamsFromData = (data) => {
        const movie = data?.movie || data?.item || data?.data?.item || data?.data?.movie || data?.data;
        const episodes = data?.episodes || data?.data?.episodes || movie?.episodes || [];
        const streams = [];

        if (Array.isArray(episodes) && episodes.length > 0) {
            for (const server of episodes) {
                const sName = (server.server_name || server.name || parsedHost || "Custom VIP").trim();
                const eList = server.server_data || server.items || server.episodes || [];
                const foundEp = eList.find((ep, idx) => targetEpisode === null || parseEpisodeNumber(ep.name, idx) === targetEpisode);
                if (foundEp) {
                    const link = foundEp.link_m3u8 || foundEp.m3u8 || foundEp.url;
                    if (link && link.includes('.m3u8')) {
                        streams.push({
                            name: `🚀 [${parsedHost}] ${sName}`,
                            title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n🌐 Nguồn API Mới: ${parsedHost}`,
                            url: link,
                            behaviorHints: { proxyHeaders: { request: { "Referer": `${cleanBase}/`, "User-Agent": "Mozilla/5.0" } } }
                        });
                    } else if (foundEp.link_embed) {
                        streams.push({
                            name: `🌐 [Webview: ${parsedHost}] ${sName}`,
                            title: `🎬 Server: ${sName} • Tập ${foundEp.name || 'Full'}\n⚡ Mở Trình Phát Web ${parsedHost}`,
                            externalUrl: foundEp.link_embed
                        });
                    }
                }
            }
        }
        return streams.length > 0 ? { streams, movie } : null;
    };

    for (const dUrl of detailPaths) {
        try {
            const res = await http.get(dUrl, {
                timeout: 3000,
                headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
            });
            const extracted = tryExtractStreamsFromData(res.data);
            if (extracted) return extracted;
        } catch (e) {}
    }

    // 3. Nếu chưa tìm được qua slug, thử tìm kiếm từ khóa
    if (cleanKw && cleanKw.length >= 2) {
        const searchUrls = [
            `${cleanBase}/v1/api/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&limit=5`,
            `${cleanBase}/api/films/search?keyword=${encodeURIComponent(cleanKw)}&page=1`,
            `${cleanBase}/content?keyword=${encodeURIComponent(cleanKw)}&limit=5`,
            `${cleanBase}/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&limit=5`,
            `${cleanBase}/api/tim-kiem?keyword=${encodeURIComponent(cleanKw)}&limit=5`,
            `${cleanBase}/api.php/provide/vod/at/json/?ac=detail&wd=${encodeURIComponent(cleanKw)}`
        ];

        for (const sUrl of searchUrls) {
            try {
                const sRes = await http.get(sUrl, {
                    timeout: 3000,
                    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
                });
                const list = sRes.data?.data?.items || sRes.data?.items || sRes.data?.list || [];
                if (Array.isArray(list) && list.length > 0) {
                    for (const it of list.slice(0, 4)) {
                        const itSlug = it.slug || (it.vod_id ? String(it.vod_id) : "");
                        const isMatch = isStrictTitleMatch(title, origTitle, it.name || it.vod_name, it.origin_name || it.original_name || it.vod_en, targetImdbId, it.imdb?.id || it.tmdb_id);
                        if (isMatch) {
                            if (it.vod_play_url) {
                                const streams = [];
                                it.vod_play_url.split(/#|\$\$\$/).forEach((part, idx) => {
                                    const seg = part.split('$');
                                    const epName = seg.length > 1 ? seg[0].trim() : `Tập ${idx + 1}`;
                                    const url = seg.length > 1 ? seg[1].trim() : seg[0].trim();
                                    const epNum = parseEpisodeNumber(epName, idx);
                                    if ((targetEpisode === null || epNum === targetEpisode) && url && (url.includes('.m3u8') || url.includes('.mp4'))) {
                                        streams.push({
                                            name: `🚀 [API: ${parsedHost}] ${it.vod_name || 'VOD'}`,
                                            title: `🎬 ${it.vod_name} • ${epName}\n🌐 Nguồn API: ${parsedHost}`,
                                            url: url,
                                            behaviorHints: { proxyHeaders: { request: { "User-Agent": "Mozilla/5.0" } } }
                                        });
                                    }
                                });
                                if (streams.length > 0) return { streams, movie: it };
                            }

                            if (itSlug) {
                                for (const subPrefix of [`${cleanBase}/phim/${itSlug}`, `${cleanBase}/v1/api/phim/${itSlug}`, `${cleanBase}/api/film/${itSlug}`, `${cleanBase}/content/${itSlug}`]) {
                                    try {
                                        const subRes = await http.get(subPrefix, { timeout: 3000, headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
                                        const extracted = tryExtractStreamsFromData(subRes.data);
                                        if (extracted) return extracted;
                                    } catch (subErr) {}
                                }
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    }

    return { streams: [], movie: null };
};

/**
 * ⚡ KIỂM TRA ĐỘ SỐNG & ĐỘ TRỄ NGUỒN PHIM API MỚI (TEST API CONNECTIVITY)
 */
const testCustomMovieApi = async (customUrl) => {
    if (!customUrl || !customUrl.startsWith("http")) {
        return { success: false, error: "Vui lòng nhập URL hợp lệ (bắt đầu bằng http:// hoặc https://)" };
    }
    const cleanBase = customUrl.trim().replace(/\/+$/, '');
    const startTime = Date.now();

    // Test 1: Kiểm tra dạng MacCMS JSON
    if (cleanBase.includes("api.php") || cleanBase.includes("provide/vod")) {
        try {
            const sep = cleanBase.includes("?") ? "&" : "?";
            const res = await http.get(`${cleanBase}${sep}ac=detail&pg=1`, { timeout: 4000 });
            const list = res.data?.list || [];
            if (Array.isArray(list) && list.length > 0) {
                return {
                    success: true,
                    url: cleanBase,
                    latencyMs: Date.now() - startTime,
                    apiType: "MacCMS / VOD JSON",
                    sampleCount: list.length,
                    samples: list.slice(0, 3).map(m => m.vod_name),
                    message: `Kết nối thành công! Tìm thấy ${list.length} mục dữ liệu từ nguồn MacCMS.`
                };
            }
        } catch (e) {}
    }

    // Test 2: Kiểm tra các endpoint phổ biến (OPhim, KKPhim, NguonC, Xink)
    const testEndpoints = [
        { path: "/danh-sach/phim-moi-cap-nhat?page=1", type: "KKPhim / PhimAPI" },
        { path: "/v1/api/danh-sach/phim-moi-cap-nhat?page=1", type: "OPhim / PhimAPI v1" },
        { path: "/api/films/phim-moi-cap-nhat?page=1", type: "NguonC API" },
        { path: "/content?page=1", type: "XinkPro / REST" },
        { path: "/v1/api/tim-kiem?keyword=a&limit=3", type: "PhimAPI Search" },
        { path: "/api.php/provide/vod/at/json/?ac=detail&pg=1", type: "MacCMS JSON" }
    ];

    for (const testEp of testEndpoints) {
        try {
            const res = await http.get(`${cleanBase}${testEp.path}`, {
                timeout: 3500,
                headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
            });
            const data = res.data;
            const items = data?.items || data?.data?.items || data?.list || [];
            if (Array.isArray(items) && items.length > 0) {
                return {
                    success: true,
                    url: cleanBase,
                    latencyMs: Date.now() - startTime,
                    apiType: testEp.type,
                    sampleCount: items.length,
                    samples: items.slice(0, 3).map(m => m.name || m.vod_name || m.title),
                    message: `Kết nối thành công! Nguồn phản hồi định dạng ${testEp.type} với ${items.length} phim.`
                };
            }
        } catch (e) {}
    }

    // Test 3: Ping kiểm tra máy chủ hoạt động
    try {
        const rootRes = await http.get(cleanBase, { timeout: 3500 });
        if (rootRes.status >= 200 && rootRes.status < 400) {
            return {
                success: true,
                url: cleanBase,
                latencyMs: Date.now() - startTime,
                apiType: "Custom HTTP Endpoint",
                sampleCount: 1,
                samples: [],
                message: `Máy chủ phản hồi tốt (HTTP ${rootRes.status}), độ trễ ${Date.now() - startTime}ms. Hệ thống sẽ tự động quét luồng khi tìm phim!`
            };
        }
    } catch (e) {
        return {
            success: false,
            url: cleanBase,
            error: `Không thể kết nối đến máy chủ (${e.message || "Timeout"}). Vui lòng kiểm tra lại đường dẫn URL!`
        };
    }

    return {
        success: false,
        url: cleanBase,
        error: "Không nhận dạng được chuẩn API phim từ URL này. Vui lòng kiểm tra endpoint API."
    };
};

// Micro-cache cho kết quả quét nguồn Việt Nam theo tên phim
const vnTitleStreamsCache = new Map();

const fetchAllVnStreamsByTitle = async (title, originTitle, year, targetEpisode, imdbId = "") => {
    const endpoints = getEndpoints(); 
    const cleanSearch = (str) => { 
        if (!str) return ""; 
        return str.replace(/\s*\(\d{4}\)/g, '')
                  .replace(/\[.*?\]|\(.*?\)/g, '')
                  .replace(/season\s*\d+|phần\s*\d+|tập\s*\d+/gi, '')
                  .replace(/[:\-–&]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim(); 
    };

    const cacheKey = `v2_${imdbId || ''}_${encodeURIComponent(title || originTitle || '')}_${year || ''}_${targetEpisode || 1}`;
    const cached = vnTitleStreamsCache.get(cacheKey);
    if (cached && (Date.now() - cached.time < 3600 * 1000) && cached.streams.length > 0) {
        return cached.streams;
    }

    const vnStreams = [];
    const baseSlug = removeVietnameseTones(title || originTitle || "").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const cleanNguonC = (endpoints.nguonc || "https://phim.nguonc.com").replace(/\/api\/?$/, '');
    const cleanXink = (endpoints.xink || "https://api.xink.pro/api").replace(/\/+$/, '');

    let kkSlug = null, vsSlug = null, opSlug = null, ncSlug = null, xkSlug = null;

    // TẬP HỢP TẤT CẢ TÁC VỤ DÒ TÌM & TÌM KIẾM CHẠY ĐỒNG THỜI SONG SONG (PARALLEL RACING < 1.2S)
    const searchQueries = [];
    const qVn = cleanSearch(title);
    const qOrig = cleanSearch(originTitle);
    if (qVn && qVn.length >= 2) searchQueries.push(qVn);
    if (qOrig && qOrig.length >= 2 && qOrig !== qVn) searchQueries.push(qOrig);

    const parallelDiscoveryTasks = [
        // 1. Dò baseSlug trực tiếp trên cả 5 kho phim Việt Nam
        baseSlug && baseSlug.length >= 3 ? fetchKKPhim(baseSlug, targetEpisode).then(r => ({ src: 'kk_slug', slug: baseSlug, streams: r?.streams || [] })).catch(() => null) : Promise.resolve(null),
        baseSlug && baseSlug.length >= 3 ? fetchVSMOV(baseSlug, targetEpisode, title, originTitle, imdbId).then(r => ({ src: 'vs_slug', slug: baseSlug, streams: r?.streams || [] })).catch(() => null) : Promise.resolve(null),
        baseSlug && baseSlug.length >= 3 ? fetchOPhim(baseSlug, targetEpisode, title, originTitle).then(r => ({ src: 'op_slug', slug: baseSlug, streams: r?.streams || [] })).catch(() => null) : Promise.resolve(null),
        baseSlug && baseSlug.length >= 3 ? fetchNguonC(baseSlug, targetEpisode, title, originTitle).then(r => ({ src: 'nc_slug', slug: baseSlug, streams: r?.streams || [] })).catch(() => null) : Promise.resolve(null),
        baseSlug && baseSlug.length >= 3 ? fetchXink(baseSlug, targetEpisode, title, originTitle, imdbId).then(r => ({ src: 'xk_slug', slug: baseSlug, streams: r?.streams || [] })).catch(() => null) : Promise.resolve(null)
    ];

    // 2. Tìm kiếm từ khóa đồng thời trên 5 nhà cung cấp phim lớn nhất Việt Nam (dò cả tên Việt + tên gốc)
    searchQueries.forEach(query => {
        parallelDiscoveryTasks.push(
            http.get(`${endpoints.kkphim}/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&limit=5`, { timeout: 2200 })
                .then(res => ({ src: "kk_search", items: res.data?.data?.items || [] }))
                .catch(() => ({ src: "kk_search", items: [] })),

            http.get(`${endpoints.vsmov}/api/tim-kiem?keyword=${encodeURIComponent(query)}&limit=5`, { timeout: 2200 })
                .then(res => ({ src: "vs_search", items: res.data?.items || res.data?.data?.items || [] }))
                .catch(() => ({ src: "vs_search", items: [] })),

            http.get(`${endpoints.ophim}/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&limit=5`, { timeout: 2200 })
                .then(res => ({ src: "op_search", items: res.data?.data?.items || [] }))
                .catch(() => ({ src: "op_search", items: [] })),

            http.get(`${cleanNguonC}/api/films/search?keyword=${encodeURIComponent(query)}&page=1`, { timeout: 2200, headers: { "Accept": "application/json" } })
                .then(res => ({ src: "nc_search", items: res.data?.status === "success" ? (res.data.items || []) : [] }))
                .catch(() => ({ src: "nc_search", items: [] })),

            http.get(`${cleanXink}/content?keyword=${encodeURIComponent(query)}&limit=5`, { timeout: 2200, headers: { "Accept": "application/json" } })
                .then(res => ({ src: "xk_search", items: Array.isArray(res.data?.items) ? res.data.items : [] }))
                .catch(() => ({ src: "xk_search", items: [] }))
        );
    });

    const discoveryResults = await Promise.allSettled(parallelDiscoveryTasks);

    discoveryResults.forEach(r => {
        if (r.status !== "fulfilled" || !r.value) return;
        const val = r.value;

        // Nếu dò slug trực tiếp thành công
        if (val.src === 'kk_slug' && val.streams?.length > 0) {
            kkSlug = val.slug;
            vnStreams.push(...val.streams);
        } else if (val.src === 'vs_slug' && val.streams?.length > 0) {
            vsSlug = val.slug;
            vnStreams.push(...val.streams);
        } else if (val.src === 'op_slug' && val.streams?.length > 0) {
            opSlug = val.slug;
            vnStreams.push(...val.streams);
        } else if (val.src === 'nc_slug' && val.streams?.length > 0) {
            ncSlug = val.slug;
            vnStreams.push(...val.streams);
        } else if (val.src === 'xk_slug' && val.streams?.length > 0) {
            xkSlug = val.slug;
            vnStreams.push(...val.streams);
        }

        // Nếu kết quả từ tìm kiếm
        if (val.items && Array.isArray(val.items) && val.items.length > 0) {
            const matchedItem = val.items.find(it => {
                if (!it || !it.slug) return false;
                if (baseSlug && (it.slug === baseSlug || it.slug.startsWith(baseSlug))) return true;
                return isStrictTitleMatch(title, originTitle, it.name, it.origin_name || it.original_name, imdbId, it.imdb?.id || it.tmdb_id, year, it.year);
            });

            if (matchedItem && matchedItem.slug) {
                if (val.src === "kk_search" && !kkSlug) kkSlug = matchedItem.slug;
                if (val.src === "vs_search" && !vsSlug) vsSlug = matchedItem.slug;
                if (val.src === "op_search" && !opSlug) opSlug = matchedItem.slug;
                if (val.src === "nc_search" && !ncSlug) ncSlug = matchedItem.slug;
                if (val.src === "xk_search" && !xkSlug) xkSlug = matchedItem.slug;
            }
        }
    });

    // LẤY STREAM TỪ TẤT CẢ CÁC SLUG ĐÃ TÌM THẤY ĐỒNG THỜI (PARALLEL EXECUTION < 800ms)
    const streamTasks = [];
    if (kkSlug && !vnStreams.some(s => s.name?.includes("KKPhim"))) streamTasks.push(fetchKKPhim(kkSlug, targetEpisode));
    if (vsSlug && !vnStreams.some(s => s.name?.includes("VSMOV"))) streamTasks.push(fetchVSMOV(vsSlug, targetEpisode, title, originTitle, imdbId));
    if (opSlug && !vnStreams.some(s => s.name?.includes("OPhim"))) streamTasks.push(fetchOPhim(opSlug, targetEpisode, title, originTitle));
    if (ncSlug && !vnStreams.some(s => s.name?.includes("NguonC"))) streamTasks.push(fetchNguonC(ncSlug, targetEpisode, title, originTitle));
    if (xkSlug && !vnStreams.some(s => s.name?.includes("Xink"))) streamTasks.push(fetchXink(xkSlug, targetEpisode, title, originTitle, imdbId));

    const customApis = endpoints.customMovieApis || [];
    if (customApis.length > 0) {
        customApis.forEach(customUrl => {
            streamTasks.push(fetchFromCustomApi(customUrl, null, targetEpisode, title, originTitle, imdbId));
        });
    }

    if (streamTasks.length > 0) {
        const streamResults = await Promise.allSettled(streamTasks);
        streamResults.forEach(r => {
            if (r.status === "fulfilled" && r.value?.streams) {
                vnStreams.push(...r.value.streams);
            }
        });
    }

    if (vnStreams.length > 0) {
        vnTitleStreamsCache.set(cacheKey, { time: Date.now(), streams: vnStreams });
    }

    return vnStreams;
};

// =========================================================================
// 5. ĐUA ĐA GƯƠNG SONG SONG MAC-CMS (MULTI-MIRROR RACING & EPISODE AUTO-MERGE)
// Tinh hoa Pháp Sư Trung Hoa: Đua song song các mirror API lớn nhất (BaoFeng, TianKong, iKun, FeiSu, SuBo)
// Giữ TẤT CẢ các gương CDN khác nhau cho cùng 1 tập để người dùng có nhiều nguồn dự phòng!
// =========================================================================
const MAC_CMS_MIRRORS = [
    { name: "BaoFeng VIP", url: "https://bfzyapi.com/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "LiangZi VIP", url: "https://cj.lziapi.com/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "TianKong 4K", url: "https://api.tiankongapi.com/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "iKun Stream", url: "https://ikunzyapi.com/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "SuBo CDN", url: "https://subocaiji.com/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "FeiSu VIP", url: "https://www.feisuzyapi.com/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "XinLang VIP", url: "https://api.xinlangapi.com/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "Kuaiche 4K", url: "https://caiji.kuaichezy.net/api.php/provide/vod/at/json/?ac=detail&wd=" },
    { name: "Modu VIP", url: "https://caiji.moduapi.cc/api.php/provide/vod/at/json/?ac=detail&wd=" }
];

const fetchMainstreamMacCmsStreams = async (originTitle, title, targetEpisode, targetYear = null) => {
    const cleanOrig = (originTitle || "").replace(/\s*\(\d{4}\)/g, '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/season\s*\d+|phần\s*\d+|tập\s*\d+/gi, '').replace(/[:\-–&]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanTitle = (title || "").replace(/\s*\(\d{4}\)/g, '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/season\s*\d+|phần\s*\d+|tập\s*\d+/gi, '').replace(/[:\-–&]/g, ' ').replace(/\s+/g, ' ').trim();

    // Tập hợp từ khóa tìm kiếm: Tiêu đề gốc, Từ gốc chính (từ đầu), Tiêu đề tiếng Việt không dấu
    const queries = [];
    if (cleanOrig && cleanOrig.length >= 2) queries.push(cleanOrig);
    const rootOrig = cleanOrig ? cleanOrig.split(' ')[0] : '';
    if (rootOrig && rootOrig.length >= 3 && !queries.includes(rootOrig)) queries.push(rootOrig);
    const titleNoTone = removeVietnameseTones(cleanTitle);
    if (titleNoTone && titleNoTone.length >= 2 && !queries.includes(titleNoTone)) queries.push(titleNoTone);
    if (queries.length === 0) return [];

    const adultTags = ["伦理", "情色", "成人", "福利", "三级", "里番", "18+"];
    const foundStreams = [];
    const seenUrls = new Set();

    const raceTasks = MAC_CMS_MIRRORS.map(async (mirror) => {
        try {
            for (const q of queries) {
                const queryUrl = `${mirror.url}${encodeURIComponent(q)}`;
                // Timeout 2800ms tối ưu cho Vercel serverless
                const res = await http.get(queryUrl, { timeout: 2800 });
                const list = res.data?.list || [];
                if (!Array.isArray(list) || list.length === 0) continue;

                const cleanMovies = list.filter(item => {
                    const typeName = (item.type_name || "").toLowerCase();
                    const vodName = (item.vod_name || "").toLowerCase();
                    const isTrailer = vodName.includes("预告") || (item.vod_remarks || "").includes("预告") || vodName.includes("花絮");
                    return !isTrailer && !adultTags.some(t => typeName.includes(t) || vodName.includes(t));
                });
                if (cleanMovies.length === 0) continue;

                const cleanOrig = (originTitle || "").replace(/\s*\(\d{4}\)/g, '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/[:\-–&]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                const cleanTit = removeVietnameseTones(title || "").replace(/\s*\(\d{4}\)/g, '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/[:\-–&]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                const rootWord = (cleanOrig || cleanTit).split(' ')[0];

                const targetMovie = cleanMovies.find(it => {
                    // 1. Kiểm tra năm nếu có
                    if (targetYear && it.vod_year) {
                        const y1 = parseInt(targetYear, 10);
                        const y2 = parseInt(it.vod_year, 10);
                        if (!isNaN(y1) && !isNaN(y2) && Math.abs(y1 - y2) > 1) return false;
                    }

                    const candidateAlias = `${it.vod_name || ''} ${it.vod_sub || ''} ${it.vod_en || ''}`.trim();
                    if (isStrictTitleMatch(title, originTitle, it.vod_name, candidateAlias, "", "", targetYear, it.vod_year)) {
                        return true;
                    }

                    const allText = candidateAlias.toLowerCase();
                    if (cleanOrig && cleanOrig.length >= 3 && allText.includes(cleanOrig)) return true;
                    if (cleanTit && cleanTit.length >= 3 && allText.includes(cleanTit)) return true;

                    // Khớp từ gốc + trùng năm phát hành
                    if (rootWord && rootWord.length >= 3 && allText.includes(rootWord)) {
                        if (targetYear && it.vod_year == targetYear) {
                            if (!cleanOrig.includes(" 2") && !cleanTit.includes(" 2") && (allText.includes(`${rootWord} 2`) || it.vod_name.includes("2"))) {
                                return false;
                            }
                            return true;
                        }
                    }

                    // Tách từng alias độc lập
                    const aliases = (it.vod_sub || '').split(/[/|,;]/).map(s => s.trim().toLowerCase());
                    for (const a of aliases) {
                        if (a.length >= 3 && (a.includes(cleanOrig) || cleanOrig.includes(a) || a.includes(cleanTit) || cleanTit.includes(a))) return true;
                    }

                    return false;
                });
                if (!targetMovie) {
                    continue;
                }
                const playUrlStr = targetMovie.vod_play_url || "";
                if (!playUrlStr) continue;

                const is4kGlobal = (targetMovie.vod_remarks || "").toLowerCase().includes("4k") || (targetMovie.vod_name || "").toLowerCase().includes("4k");
                const streamsFromMirror = [];

                playUrlStr.split(/#|\$\$\$/).forEach((part, idx) => {
                    const seg = part.split('$');
                    const epName = seg.length > 1 ? seg[0].trim() : `Tập ${idx + 1}`;
                    const url = seg.length > 1 ? seg[1].trim() : seg[0].trim();
                    const epNum = parseEpisodeNumber(epName, idx);

                    if ((targetEpisode === null || epNum === targetEpisode) && url && (url.includes('.m3u8') || url.includes('.mp4'))) {
                        const is4k = is4kGlobal || epName.toLowerCase().includes("4k");
                        streamsFromMirror.push({
                            epNum,
                            epName,
                            is4k,
                            stream: {
                                name: is4k ? `⚡ [Asia 4K • ${mirror.name}]` : `⚡ [Asia VIP • ${mirror.name}]`,
                                title: `🎬 ${targetMovie.vod_name} • ${epName}\n🚀 CDN Châu Á Đua Đa Gương (${mirror.name})`,
                                url,
                                behaviorHints: { proxyHeaders: { request: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } } }
                            }
                        });
                    }
                });

                if (streamsFromMirror.length > 0) {
                    return streamsFromMirror;
                }
            }
            return [];
        } catch (e) {
            return [];
        }
    });

    const results = await Promise.allSettled(raceTasks);
    results.forEach(r => {
        if (r.status === "fulfilled" && Array.isArray(r.value)) {
            r.value.forEach(item => {
                if (item.stream && item.stream.url && !seenUrls.has(item.stream.url)) {
                    seenUrls.add(item.stream.url);
                    foundStreams.push(item.stream);
                }
            });
        }
    });

    return foundStreams;
};

/**
 * 🌐 BỘ TẠO NGUỒN PHÁT ĐA MÁY CHỦ QUỐC TẾ TƯƠNG THÍCH KÉP (WEB PLAYER + NUVIO ADDON)
 * Tự động ánh xạ TMDB ID / IMDb ID sang hệ thống Multi-Server Cloud (VidSrc, AutoEmbed, VidLink, SuperEmbed, 2Embed)
 * Chạy mượt trực tiếp trong trình phát Web (Iframe Player) và mở Nuvio Webview trên Android TV / Mobile.
 */
const fetchWebAndNuvioMultiEmbedStreams = ({ imdbId = "", tmdbId = "", type = "movie", season = 1, episode = 1, title = "" }) => {
    const cleanImdb = imdbId && String(imdbId).startsWith("tt") ? String(imdbId).trim() : "";
    const cleanTmdb = tmdbId ? String(tmdbId).trim() : "";
    const targetId = cleanTmdb || cleanImdb;
    if (!targetId) return [];

    const isSeries = type === "series" || type === "tv";
    const s = season || 1;
    const e = episode || 1;
    const epLabel = isSeries ? `S${s}:E${e}` : "Full HD";
    const streams = [];

    const servers = isSeries
        ? [
            {
                name: `🌐 [Cloud VIP 1] VidSrc Pro (Multi-Sub)`,
                title: `🎬 ${title || 'Series'} • ${epLabel}\n⚡ Máy Chủ Quốc Tế VidSrc Pro • Tương Thích Web & Nuvio`,
                url: cleanTmdb
                    ? `https://vidsrc.cc/v2/embed/tv/${cleanTmdb}/${s}/${e}`
                    : `https://vidsrc.xyz/embed/tv?imdb=${cleanImdb}&season=${s}&episode=${e}`
            },
            {
                name: `🌐 [Cloud VIP 2] VidSrc XYZ 1080p`,
                title: `🎬 ${title || 'Series'} • ${epLabel}\n⚡ Máy Chủ Quốc Tế VidSrc XYZ • Phụ Đề Đa Ngôn Ngữ`,
                url: cleanImdb
                    ? `https://vidsrc.xyz/embed/tv?imdb=${cleanImdb}&season=${s}&episode=${e}`
                    : `https://vidsrc.xyz/embed/tv?tmdb=${cleanTmdb}&season=${s}&episode=${e}`
            },
            {
                name: `🌐 [Cloud VIP 3] AutoEmbed Global`,
                title: `🎬 ${title || 'Series'} • ${epLabel}\n🚀 Cụm Máy Chủ AutoEmbed Tốc Độ Cao • Web & Nuvio`,
                url: `https://player.autoembed.cc/embed/tv/${targetId}/${s}/${e}`
            },
            {
                name: `🌐 [Cloud VIP 4] SuperEmbed Multi-CDN`,
                title: `🎬 ${title || 'Series'} • ${epLabel}\n🚀 Cụm Máy Chủ SuperEmbed Dự Phòng Quốc Tế`,
                url: cleanTmdb
                    ? `https://multiembed.mov/?video_id=${cleanTmdb}&tmdb=1&s=${s}&e=${e}`
                    : `https://multiembed.mov/?video_id=${cleanImdb}&s=${s}&e=${e}`
            },
            {
                name: `🌐 [Cloud VIP 5] 2Embed Global`,
                title: `🎬 ${title || 'Series'} • ${epLabel}\n⚡ Máy Chủ 2Embed Quốc Tế Không Giới Hạn Băng Thông`,
                url: `https://www.2embed.cc/embedtv/${targetId}&s=${s}&e=${e}`
            }
        ]
        : [
            {
                name: `🌐 [Cloud VIP 1] VidSrc Pro (Multi-Sub)`,
                title: `🎬 ${title || 'Movie'} • ${epLabel}\n⚡ Máy Chủ Quốc Tế VidSrc Pro • Tương Thích Web & Nuvio`,
                url: cleanTmdb
                    ? `https://vidsrc.cc/v2/embed/movie/${cleanTmdb}`
                    : `https://vidsrc.xyz/embed/movie?imdb=${cleanImdb}`
            },
            {
                name: `🌐 [Cloud VIP 2] VidSrc XYZ 1080p`,
                title: `🎬 ${title || 'Movie'} • ${epLabel}\n⚡ Máy Chủ Quốc Tế VidSrc XYZ • Phụ Đề Đa Ngôn Ngữ`,
                url: cleanImdb
                    ? `https://vidsrc.xyz/embed/movie?imdb=${cleanImdb}`
                    : `https://vidsrc.xyz/embed/movie?tmdb=${cleanTmdb}`
            },
            {
                name: `🌐 [Cloud VIP 3] AutoEmbed Global`,
                title: `🎬 ${title || 'Movie'} • ${epLabel}\n🚀 Cụm Máy Chủ AutoEmbed Tốc Độ Cao • Web & Nuvio`,
                url: `https://player.autoembed.cc/embed/movie/${targetId}`
            },
            {
                name: `🌐 [Cloud VIP 4] SuperEmbed Multi-CDN`,
                title: `🎬 ${title || 'Movie'} • ${epLabel}\n🚀 Cụm Máy Chủ SuperEmbed Dự Phòng Quốc Tế`,
                url: cleanTmdb
                    ? `https://multiembed.mov/?video_id=${cleanTmdb}&tmdb=1`
                    : `https://multiembed.mov/?video_id=${cleanImdb}`
            },
            {
                name: `🌐 [Cloud VIP 5] 2Embed Global`,
                title: `🎬 ${title || 'Movie'} • ${epLabel}\n⚡ Máy Chủ 2Embed Quốc Tế Không Giới Hạn Băng Thông`,
                url: `https://www.2embed.cc/embed/${targetId}`
            }
        ];

    servers.forEach(sv => {
        if (sv.url) {
            streams.push({
                name: sv.name,
                title: sv.title,
                externalUrl: sv.url,
                embedUrl: sv.url
            });
        }
    });

    return streams;
};

// =========================================================================
// 6. MODULE NGƯỜI LỚN
// =========================================================================
const extractJavCode = (title) => {
    if (!title) return { code: "", prefix: "", num: 0 };
    const match = title.match(/([a-zA-Z]{2,6})[-_ ]?(\d{2,5})/i);
    if (match) {
        const pref = match[1].toUpperCase();
        return {
            code: `${pref}-${match[2]}`,
            prefix: pref,
            num: parseInt(match[2], 10) || 0
        };
    }
    return { code: "", prefix: "", num: 0 };
};

// 1. Danh sách mã studio lớn, danh tiếng hàng đầu Nhật Bản (Madonna, S1, Moodyz, Idea Pocket, SOD/STAR, Faleno, Premium, Attackers, Wanz, Prestige, v.v.)
const MAJOR_FAMOUS_STUDIOS = [
    "JUQ", "SSIS", "SNIS", "SSNI", "IPX", "IPZ", "IPSX", "IPTD",
    "STAR", "STARS", "SDDE", "SDMU", "SDAM", "SDAB", "KMHR",
    "MIDE", "MIAE", "MIDV", "MIFD", "MIMK", "MIGD", "MEYD",
    "FSDSS", "FNE", "FLNS", "FSK", "DAFL",
    "PRED", "PGR", "PGD",
    "WANZ", "ABP", "ABW", "PPT", "CHN", "DOC", "EDD",
    "ADN", "ATID", "SHKD", "RBD", "ATKD",
    "JUC", "JUL", "JUS", "JUY", "JUFE",
    "CAWD", "EBOD", "DASD", "HND", "HODV", "PPPD", "BFR", "OFJE", "SOE", "ONSD",
    "DLDSS", "SIVR", "ROE", "MUKD", "RCT", "SDMM", "HONB", "DOKS"
];

// Hàm chấm điểm và phân loại 3 cấp độ theo yêu cầu người dùng:
// 1. Ưu tiên các bộ phim Nhật Bản hot nhất mới nhất của các studio lớn nổi tiếng
// 2. Các bộ phim Nhật Bản hot nhất của các studio
// 3. Các bộ phim khác
const getAdultTierAndScore = (item) => {
    const title = (item.vod_name || "");
    const titleLower = title.toLowerCase();
    const typeLower = (item.type_name || "").toLowerCase();
    const parsed = extractJavCode(title);

    const isAmateurOrWatermark = ["国产", "探花", "自拍", "麻豆", "吃瓜", "91", "门事件", "主播", "网红", "露脸", "约炮", "偷拍", "抖音", "快手"].some(
        x => titleLower.includes(x) || typeLower.includes(x)
    );

    const isJapanese = parsed.code || 
                       typeLower.includes("日本") || 
                       typeLower.includes("jav") || 
                       typeLower.includes("中文字幕") || 
                       titleLower.includes("日本") || 
                       titleLower.includes("中字") || 
                       titleLower.includes("无码") || 
                       titleLower.includes("有码") || 
                       /[\u3040-\u309F\u30A0-\u30FF]/.test(title);

    const year = parseInt(item.vod_year, 10) || 0;
    const scoreVal = parseFloat(item.vod_score) || 0;
    const codeNum = parsed.num || 0;

    // CẤP ĐỘ 1: Ưu tiên các bộ phim Nhật Bản hot nhất, mới nhất của các studio lớn nổi tiếng
    if (parsed.prefix && MAJOR_FAMOUS_STUDIOS.includes(parsed.prefix) && !isAmateurOrWatermark) {
        const studioRank = MAJOR_FAMOUS_STUDIOS.indexOf(parsed.prefix);
        const studioBonus = (MAJOR_FAMOUS_STUDIOS.length - studioRank) * 2000;
        return {
            tier: 1,
            score: 1000000 + studioBonus + (codeNum * 10) + (scoreVal * 50) + (year * 100)
        };
    }

    // CẤP ĐỘ 2: Các bộ phim Nhật Bản hot nhất của các studio khác (có JAV code hợp lệ hoặc xuất xứ Nhật)
    if (parsed.code || (isJapanese && !isAmateurOrWatermark)) {
        return {
            tier: 2,
            score: 500000 + (codeNum * 10) + (scoreVal * 50) + (year * 100)
        };
    }

    // CẤP ĐỘ 3: Các bộ phim khác (phim châu Á, phương Tây hoặc video thông thường)
    return {
        tier: 3,
        score: (isAmateurOrWatermark ? -50000 : 10000) + (scoreVal * 10)
    };
};

const fetchAdultJav = async (page, rawCatalogId) => {
    const cat = ADULT_SUB_CATALOGS.find(c => rawCatalogId.includes(c.id) || rawCatalogId.includes(c.id.replace(/-/g, '_')));
    const allKeywords = cat?.keywords || (cat ? [cat.primaryKw, cat.secondaryKw].filter(Boolean) : [""]);
    
    // Chọn song song 3 từ khóa trong danh mục để lấy đủ các studio hot nhất
    const batchSize = 3;
    const startIndex = ((page - 1) * batchSize) % allKeywords.length;
    const selectedKeywords = [];
    for (let i = 0; i < batchSize; i++) {
        const kw = allKeywords[(startIndex + i) % allKeywords.length];
        if (kw && !selectedKeywords.includes(kw)) selectedKeywords.push(kw);
    }
    const targetPage = Math.max(1, Math.ceil(page / (allKeywords.length / batchSize || 1)));

    let rawList = [];
    try {
        const fetchPromises = selectedKeywords.map(kw => {
            const url = `https://lbapi9.com/api.php/provide/vod/at/json/?ac=detail&pg=${targetPage}${kw ? `&wd=${encodeURIComponent(kw)}` : ''}`;
            return http.get(url, { timeout: 2600 }).then(r => r.data?.list || []).catch(() => []);
        });
        const results = await Promise.allSettled(fetchPromises);
        results.forEach(res => {
            if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                rawList = rawList.concat(res.value);
            }
        });
    } catch (e) {}

    // Dự phòng nếu chưa có dữ liệu
    if (rawList.length === 0) {
        for (const kw of [cat?.primaryKw || allKeywords[0] || ""]) {
            try {
                const res = await http.get(`https://lbapi9.com/api.php/provide/vod/at/json/?ac=detail&pg=${page}${kw ? `&wd=${encodeURIComponent(kw)}` : ''}`, { timeout: 2800 });
                if (res.data?.list?.length > 0) {
                    rawList = res.data.list;
                    break;
                }
            } catch (e) {}
        }
    }

    // Loại trừ trùng lặp theo ID và mã JAV
    const seenIds = new Set();
    const seenCodes = new Set();
    const uniqueList = [];
    for (const item of rawList) {
        if (!item || !item.vod_id) continue;
        if (seenIds.has(item.vod_id)) continue;
        seenIds.add(item.vod_id);

        const codeInfo = extractJavCode(item.vod_name);
        if (codeInfo.code) {
            if (seenCodes.has(codeInfo.code)) continue;
            seenCodes.add(codeInfo.code);
        }
        uniqueList.push(item);
    }

    // Sắp xếp thứ tự hiển thị chuẩn 3 cấp độ:
    // 1. Ưu tiên phim Nhật Bản hot nhất, mới nhất của studio lớn nổi tiếng
    // 2. Phim Nhật Bản hot nhất của các studio
    // 3. Các bộ phim khác
    uniqueList.sort((a, b) => {
        return getAdultTierAndScore(b).score - getAdultTierAndScore(a).score;
    });

    return uniqueList.map(item => {
        const p = extractJavCode(item.vod_name);
        const tierInfo = getAdultTierAndScore(item);
        const tierBadge = tierInfo.tier === 1 ? "💎" : tierInfo.tier === 2 ? "⭐" : "🎬";
        const cleanName = (item.vod_name || "").replace(/\[.*?\]/g, '').replace(/第\d+集/g, '').trim();
        return {
            id: `jav_${item.vod_id}`,
            type: "movie",
            name: `🔞 ${p.code ? `[${p.code}] ` : ""}${cleanName}`,
            poster: item.vod_pic || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500",
            posterShape: "landscape",
            description: p.code 
                ? `${tierBadge} Code: ${p.code} • ${cat?.tag || "JAV"} • ${tierInfo.tier === 1 ? "Studio Lớn Hot Nhất 1080p" : "JAV Studio 1080p"}` 
                : `${tierBadge} ${cleanName} • ${cat?.tag || "JAV"}`
        };
    });
};

const fetchAdultJavMeta = async (rawId) => { 
    const vodId = rawId.replace("jav_", ""); 
    for (const url of [`https://lbapi9.com/api.php/provide/vod/at/json/?ac=detail&ids=${vodId}`, `https://api.apilyzy.com/api.php/provide/vod/at/json/?ac=detail&ids=${vodId}`]) {
        try {
            const res = await http.get(url, { timeout: 2600 });
            const item = res.data?.list?.[0];
            if (item) {
                const p = extractJavCode(item.vod_name);
                const tierInfo = getAdultTierAndScore(item);
                const desc = p.code ? `💎 Code: ${p.code} • JAV Nhật Bản HD 1080p • ${tierInfo.tier === 1 ? "Studio Lớn Hot Nhất" : "Studio Nhật Bản"}` : "Phim JAV Nhật Bản HD • Bản Gốc";
                return {
                    id: rawId,
                    type: "movie",
                    name: `🔞 ${p.code ? `[${p.code}] ` : ""}${(item.vod_name || "").replace(/\[.*?\]/g, '').trim()}`,
                    poster: item.vod_pic,
                    background: item.vod_pic,
                    description: desc,
                    genres: ["18+", "JAV"]
                };
            }
        } catch (e) {}
    } 
    return { id: rawId, type: "movie", name: "🔞 Phim 18+ JAV" }; 
};

const fetchAdultJavStream = async (rawId) => { 
    const vodId = rawId.replace("jav_", ""); 
    for (const url of [`https://lbapi9.com/api.php/provide/vod/at/json/?ac=detail&ids=${vodId}`, `https://api.apilyzy.com/api.php/provide/vod/at/json/?ac=detail&ids=${vodId}`]) { 
        try { 
            const res = await http.get(url, { timeout: 3000 });
            const item = res.data?.list?.[0]; 
            if (item?.vod_play_url) {
                const streams = [];
                item.vod_play_url.split(/#|\$\$\$/).forEach((part, idx) => {
                    const segs = part.split('$');
                    const u = segs.length > 1 ? segs[1].trim() : segs[0].trim();
                    if (u && u.includes('.m3u8')) {
                        streams.push({
                            name: `🔞 [JAV VIP 1080p]`,
                            title: `🎬 ${item.vod_name}\n💎 Server HLS #${idx + 1}`,
                            url: u
                        });
                    }
                });
                if (streams.length > 0) return streams;
            } 
        } catch (e) {} 
    } 
    return []; 
};

// =========================================================================
// 7. QUỐC TẾ & REAL-DEBRID (Lấy Thông Tin / Luồng Phát)
// =========================================================================
const getCinemetaInfo = async (type, imdbId, cache) => { 
    if (!imdbId || !imdbId.startsWith("tt")) return null;
    const cacheKey = `cinemeta_v3_${imdbId}`;
    const cached = cache ? cache.get(cacheKey) : null; 
    if (cached) return cached; 

    // CHIẾN LƯỢC 1: IMDb Official Suggestion API (Phản hồi < 100ms)
    try {
        const res = await http.get(`https://v3.sg.media-imdb.com/suggestion/t/${imdbId}.json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 2000
        });
        const first = res.data?.d?.[0];
        if (first && first.l) {
            const data = { name: first.l, year: first.y || "" };
            if (cache) cache.set(cacheKey, data, 86400 * 7);
            return data;
        }
    } catch (e) {}

    // CHIẾN LƯỢC 2: Cinemeta Fallback
    try { 
        const res = await http.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, { timeout: 2500 }); 
        const meta = res.data?.meta; 
        if (meta && meta.name) { 
            const data = { name: meta.name, year: meta.year || "" }; 
            if (cache) cache.set(cacheKey, data, 86400 * 7); 
            return data; 
        } 
    } catch (e) {} 
    return null; 
};

const getImdbFromTitle = async (type, title, year = null, cache = null) => { 
    if (!title || typeof title !== 'string') return null;
    let clean = title.replace(/\s*\(\d{4}\)/g, '')
        .replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/season\s*\d+|phần\s*\d+|tập\s*\d+/gi, '')
        .replace(/\b(thuyết minh|vietsub|lồng tiếng|full hd|hd|4k|1080p|cam|raw)\b/gi, '')
        .replace(/[:\-–&]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(); 
    if (!clean || clean.length < 2) return null; 
    const cleanNoTone = removeVietnameseTones(clean).trim();
    const cacheKey = `imdb_search_v3_${cleanNoTone}_${year || 'any'}`;
    const cached = cache ? cache.get(cacheKey) : null; 
    if (cached) return cached; 

    // CHIẾN LƯỢC 1: Sử dụng IMDb Suggestion API chính chủ (Phản hồi siêu tốc ~100ms, nhận diện tên chuẩn xác)
    try {
        const imdbQuery = cleanNoTone.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 45);
        const imdbRes = await http.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(imdbQuery)}.json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 2200
        });
        const items = imdbRes.data?.d || [];
        for (const it of items) {
            if (it.id && it.id.startsWith("tt")) {
                const isMatch = isStrictTitleMatch(clean, cleanNoTone, it.l, it.l, "", "", year, it.y);
                if (isMatch) {
                    if (cache) cache.set(cacheKey, it.id, 86400 * 7);
                    return it.id;
                }
            }
        }
        // Thử ứng viên đầu tiên nếu có cùng năm (±1)
        if (year && items.length > 0) {
            const yTarget = parseInt(year, 10);
            const cand = items.find(it => it.id && it.id.startsWith("tt") && it.y && Math.abs(parseInt(it.y, 10) - yTarget) <= 1);
            if (cand) {
                if (cache) cache.set(cacheKey, cand.id, 86400 * 7);
                return cand.id;
            }
        }
    } catch (e) {}

    // CHIẾN LƯỢC 2: Fallback qua Cinemeta Catalog Search
    try { 
        const cType = type === 'series' || type === 'tv' ? 'series' : 'movie';
        const res = await http.get(`https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(cleanNoTone)}.json`, { timeout: 3000 }); 
        const metas = res.data?.metas || []; 
        if (metas.length > 0) {
            const matchedMeta = metas.find(m => {
                const mYear = m.releaseInfo || m.year;
                return isStrictTitleMatch(clean, cleanNoTone, m.name, m.name, "", "", year, mYear);
            });
            if (matchedMeta && matchedMeta.id) {
                if (cache) cache.set(cacheKey, matchedMeta.id, 86400 * 7);
                return matchedMeta.id;
            }
        } 
    } catch (e) {} 
    return null; 
};

/**
 * Kiểm tra xem luồng stream có đạt độ phân giải từ 1080p trở lên hay không
 * Strictly retains ONLY sources that are 1080p or higher (1080p, FHD, 2160p, 4K, UHD, Remux, Bluray)
 */
const isStream1080pOrHigher = (st) => {
    if (!st) return false;
    const name = String(st.name || "");
    const title = String(st.title || "");
    const fullText = `${name} ${title}`.toLowerCase();

    // 1. Loại trừ dứt khoát các độ phân giải thấp hơn 1080p (720p, 480p, SD, CAM)
    const isExplicitLower = /\b(720p|720i|hd\b(?!.*(?:1080|2160|4k))|480p|360p|sd\b|cam\b|hdcam|ts\b|hdts|telesync|dvdrip)\b/i.test(fullText);
    const hasHighKeywords = /\b(2160p|4k|uhd|1080p|1080i|fhd|bluray|blu-ray|remux)\b/i.test(fullText) ||
                           fullText.includes("1080") || fullText.includes("2160") || fullText.includes("4k") || fullText.includes("fhd");

    if (isExplicitLower && !hasHighKeywords) {
        return false;
    }

    // 2. Chấp nhận các luồng có từ khóa độ phân giải 1080p hoặc 4K
    if (hasHighKeywords) {
        return true;
    }

    // 3. Kiểm tra bingeGroup hoặc thông tin kích thước file nếu có
    const binge = String(st.behaviorHints?.bingeGroup || "").toLowerCase();
    if (binge.includes("1080p") || binge.includes("4k") || binge.includes("2160p")) {
        return true;
    }

    return false;
};

const parseVipTorrentResponse = (data, targetType, queryParam) => {
    if (!data) return [];
    let rawStreams = [];

    // 1. Data is already parsed Object or Array
    if (typeof data === "object") {
        if (Array.isArray(data)) {
            rawStreams = data;
        } else if (Array.isArray(data.streams)) {
            rawStreams = data.streams;
        } else if (Array.isArray(data.data?.streams)) {
            rawStreams = data.data.streams;
        } else if (Array.isArray(data.metas)) {
            rawStreams = data.metas;
        }
    } 
    // 2. Data is raw string (JSON or HTML document)
    else if (typeof data === "string") {
        const trimmed = data.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                const parsed = JSON.parse(trimmed);
                return parseVipTorrentResponse(parsed, targetType, queryParam);
            } catch (e) {}
        }

        const jsonMatch = trimmed.match(/"streams"\s*:\s*(\[[^]+?\])\s*[,}]/i) || 
                          trimmed.match(/"metas"\s*:\s*(\[[^]+?\])\s*[,}]/i) ||
                          trimmed.match(/streams\s*=\s*(\[[^]+?\])/i);
        if (jsonMatch && jsonMatch[1]) {
            try {
                const extractedJson = JSON.parse(jsonMatch[1]);
                if (Array.isArray(extractedJson)) {
                    rawStreams = extractedJson;
                }
            } catch (e) {}
        }

        if (rawStreams.length === 0) {
            const magnetRegex = /(magnet:\?xt=urn:btih:([a-zA-Z0-9]+)[^"'\s<>]*)/gi;
            let m;
            while ((m = magnetRegex.exec(trimmed)) !== null) {
                const magnetUri = m[1];
                const hash = m[2].toLowerCase();
                let dn = "Direct P2P Torrent";
                const dnMatch = magnetUri.match(/[?&]dn=([^&]+)/i);
                if (dnMatch && dnMatch[1]) {
                    try { dn = decodeURIComponent(dnMatch[1]).replace(/\+/g, ' '); } catch (e) { dn = dnMatch[1]; }
                }
                rawStreams.push({
                    name: `🌐 VipTorrent P2P 1080p`,
                    title: `🌐 [VipTorrent HTTP P2P]\n${dn}\n⚙️ Máy Chủ VipTorrent Network`,
                    infoHash: hash
                });
            }

            const directMediaRegex = /href=["'](https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4|mkv)(?:\?[^"'\s<>]*)?)["']/gi;
            let dm;
            while ((dm = directMediaRegex.exec(trimmed)) !== null) {
                rawStreams.push({
                    name: `🌐 VipTorrent HTTP Direct 1080p`,
                    title: `🌐 [VipTorrent HTTP]\nDirect Web Stream (1080p+)`,
                    url: dm[1]
                });
            }
        }
    }

    if (!Array.isArray(rawStreams) || rawStreams.length === 0) return [];

    const parsedList = [];
    const seenPointers = new Set();

    for (const st of rawStreams) {
        if (!st || typeof st !== "object") continue;

        const hasUrl = st.url && typeof st.url === "string" && st.url.startsWith("http");
        const hasExternal = st.externalUrl && typeof st.externalUrl === "string";
        const hasHash = st.infoHash && typeof st.infoHash === "string";

        if (!hasUrl && !hasExternal && !hasHash) continue;

        // LOẠI BỎ CÁC LUỒNG BÁO LỖI VÀ RATE-LIMIT PHÁT SINH TỪ PUBLIC DEBRID DUMMY
        const urlStr = String(st.url || "");
        const titleStr = String(st.title || "");
        if (urlStr.includes("rate-limit") || urlStr.includes("elfhosted.com/assets") || urlStr.includes("error.mp4") || urlStr.includes("exceeded")) {
            continue;
        }
        if (/rate-?limit\s+exceeded/i.test(titleStr) || /mediafusion.*rate-limit/i.test(titleStr)) {
            continue;
        }

        // 🌟 BỘ LỌC CHẤT LƯỢNG NGHIÊM NGẶT: CHỈ GIỮ LẠI CÁC NGUỒN TỪ 1080P TRỞ LÊN
        if (!isStream1080pOrHigher(st)) {
            continue;
        }

        const pointerKey = `${st.infoHash || ''}_${st.url || ''}_${st.externalUrl || ''}_${st.fileIdx || 0}`;
        if (seenPointers.has(pointerKey)) continue;
        seenPointers.add(pointerKey);

        const rawName = (st.name || '').trim();
        const rawTitle = (st.title || '').trim();
        const fullDesc = `${rawName} ${rawTitle}`.toLowerCase();

        const is4K = /\b(2160p|4k|uhd)\b/i.test(fullDesc) || fullDesc.includes("4k") || fullDesc.includes("2160p");
        const resLabel = is4K ? "4K" : "1080p";

        const isVietsub = fullDesc.includes("vietsub") || fullDesc.includes("phụ đề") || fullDesc.includes("vietnamese");
        const isTm = fullDesc.includes("thuyết minh") || fullDesc.includes("lồng tiếng") || fullDesc.includes("audio tiếng việt");

        let formattedName = rawName;
        let isHttpDirect = false;

        if (hasUrl && !hasHash) {
            isHttpDirect = true;
            let tag = isTm ? "Thuyết Minh" : (isVietsub ? "Vietsub" : "Direct");
            formattedName = rawName.includes("VipTorrent") 
                ? (rawName.startsWith("🌐") || rawName.startsWith("⭐") ? rawName : `🌐 ${rawName}`)
                : `🌐 [VipTorrent HTTP ${resLabel} ${tag}]`;
        } else {
            formattedName = rawName.includes("VipTorrent")
                ? (rawName.startsWith("🌐") ? rawName : `🌐 ${rawName}`)
                : `🌐 [VipTorrent P2P ${resLabel}]\n${rawName || 'Stream 1080p+'}`;
        }

        const formattedTitle = rawTitle || 
            `🎬 VipTorrent Stream ${isHttpDirect ? 'HTTP Direct' : 'P2P'}\n🚀 Máy Chủ VipTorrent Network (${resLabel} Ready)`;

        parsedList.push({
            ...st,
            name: formattedName,
            title: formattedTitle,
            isHttpDirect,
            is1080pPlus: true,
            behaviorHints: {
                notWebReady: false,
                ...(st.behaviorHints || {}),
                proxyHeaders: { request: { "Referer": "https://viptorrent.nadan.cloud/" } }
            }
        });
    }

    return parsedList;
};

// Micro-cache cục bộ cho luồng VipTorrent để giảm tải và tăng tốc phản hồi
const vipTorrentMemoryCache = new Map();

const fetchVipTorrentHttp = async (targetType, queryParam) => {
    const c = (queryParam || "").replace('.json', ''); if (!c) return [];
    const cacheKey = `${targetType}_${c}`;

    const cached = vipTorrentMemoryCache.get(cacheKey);
    if (cached && (Date.now() - cached.time < 3600 * 1000) && cached.streams.length > 0) {
        return cached.streams;
    }

    const urls = [
        `https://viptorrent.nadan.cloud/stream/${targetType}/${c}.json`,
        `${VIPTORRENT_BASE}/stream/${targetType}/${c}.json`
    ];

    for (const url of urls) {
        try {
            const res = await http.get(url, { 
                timeout: 3800,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                    "Accept": "application/json, text/html, */*"
                },
                responseType: "text",
                transformResponse: [(data) => data]
            });
            const parsedStreams = parseVipTorrentResponse(res.data, targetType, queryParam);
            if (parsedStreams.length > 0) {
                vipTorrentMemoryCache.set(cacheKey, { time: Date.now(), streams: parsedStreams });
                return parsedStreams;
            }
        } catch (e) {}
    }
    return [];
};

const fetchVNStream = async (targetType, queryId) => { 
    try { const res = await http.get(`https://addon.vnstream.io.vn/guest/stream/${targetType}/${queryId}.json`, { timeout: 2400 }); const streams = res.data?.streams; if (streams?.length > 0) { return streams.map(st => ({ ...st, name: `[VNStream] ${st.name || 'Direct'}` })); } } catch (e) {} return []; 
};

const fetchTorrentio = async (targetType, imdbId, seasonNum, targetEpisode, debridToken = "") => { 
    if (!imdbId || !imdbId.startsWith("tt")) return []; 
    try { 
        const debridStr = debridToken ? `realdebrid=${debridToken}|` : ""; const query = targetType === "series" && targetEpisode ? `:${seasonNum || 1}:${targetEpisode}` : "";
        const res = await http.get(`https://torrentio.strem.fun/${debridStr}language=vietnamese|qualityfilter=4k,1080p/stream/${targetType}/${imdbId}${query}.json`, { timeout: 3000 }); const streams = res.data?.streams; 
        if (streams?.length > 0) { return streams.slice(0, 5).map(st => ({ ...st, name: debridToken ? `⚡ [Real-Debrid 4K]\n${st.name || ''}` : `[Torrent 4K Vietsub]\n${st.name || ''}` })); }
    } catch (e) {} 
    return []; 
};

// =========================================================================
// 8. THUẬT TOÁN ĐIỀU HƯỚNG BĂNG THÔNG STREAM
// PHÂN TẦNG ƯU TIÊN MẢNG PHIM CHUẨN 7 BẬC:
// 1. KKPhim (100.000)
// 2. VSMov (90.000)
// 3. Ophim (80.000)
// 4. NguonC (70.000)
// 5. Asia (60.000)
// 6. 🌐 VipTorrent HTTP (50.000)
// 7. Torrentio (40.000 Real-Debrid / 30.000 Torrent)
// =========================================================================
// =========================================================================
// 8. THUẬT TOÁN ĐIỀU HƯỚNG BĂNG THÔNG & SẮP XẾP LUỒNG PHÁT
// THỨ TỰ ƯU TIÊN CHUẨN MỰC:
// 1. Phim Server Việt Nam -> Thuyết Minh (KKPhim, NguonC, VSMov, Xink, OPhim, Custom API)
// 2. Phim Server Việt Nam -> Vietsub / Phụ Đề
// 3. Phim Server Việt Nam -> Bản gốc khác
// 4. Nguồn Nước Ngoài có Thuyết Minh / Audio Tiếng Việt
// 5. Nguồn Nước Ngoài có Vietsub / Phụ Đề Tiếng Việt (VipTorrent, Torrentio, Real-Debrid)
// 6. Nguồn Nước Ngoài khác (VipTorrent gốc, Asia CDN, Torrent khác)
// VÀ TRONG MỖI BẬC TRÊN: Ưu tiên chất lượng từ cao đến thấp (4K/2160p -> 1080p FHD -> 720p HD -> SD)
// =========================================================================
// =========================================================================
// 🏷️ BỘ GẮN THẺ TỰ ĐỘNG ÂM THANH (AUDIO) & CHẤT LƯỢNG (RESOLUTION)
// Chuẩn hóa định dạng: [Vietsub] / [Lồng Tiếng] / [Thuyết Minh] / [Song Ngữ] & [4K] / [FHD] / [HD]
// =========================================================================
const detectStreamLanguagePriority = (st) => {
    if (!st || typeof st !== "object") return { tier: 3, label: "Nguồn Khác" };
    const rawName = String(st.name || "");
    const rawTitle = String(st.title || "");
    // Strip any previously injected "[Vietsub]" badge if we want to inspect the true server description,
    // or inspect the full text excluding generic subtitle injection notes
    const cleanText = `${rawName} ${rawTitle}`
        .replace(/\[kèm phụ đề rời\]/gi, "")
        .toLowerCase();

    const isTm =
        cleanText.includes("thuyết minh") ||
        cleanText.includes("thuyet minh") ||
        cleanText.includes("lồng tiếng") ||
        cleanText.includes("long tieng") ||
        cleanText.includes("song ngữ") ||
        cleanText.includes("song ngu") ||
        cleanText.includes("vie audio") ||
        cleanText.includes("viet audio") ||
        cleanText.includes("audio tiếng việt") ||
        cleanText.includes("audio tieng viet") ||
        /\b(tm|lt)\b/i.test(cleanText);

    if (isTm) {
        if (cleanText.includes("lồng tiếng") || cleanText.includes("long tieng")) {
            return { tier: 1, label: "Lồng Tiếng" };
        }
        if (cleanText.includes("song ngữ") || cleanText.includes("song ngu")) {
            return { tier: 1, label: "Song Ngữ" };
        }
        return { tier: 1, label: "Thuyết Minh" };
    }

    const isVietsub =
        cleanText.includes("vietsub") ||
        cleanText.includes("viet sub") ||
        cleanText.includes("phụ đề") ||
        cleanText.includes("phu de") ||
        cleanText.includes("tiếng việt") ||
        cleanText.includes("tieng viet") ||
        cleanText.includes("vietnamese") ||
        /\b(vsub|vs)\b/i.test(cleanText);

    if (isVietsub) {
        return { tier: 2, label: "Vietsub" };
    }

    return { tier: 3, label: "Nguồn Khác" };
};

const tagStreamAudioAndQuality = (st) => {
    if (!st || typeof st !== "object") return st;
    const rawName = String(st.name || "");
    const rawTitle = String(st.title || "");
    const fullText = `${rawName} ${rawTitle}`.toLowerCase();

    const { tier, label: audioLabel } = detectStreamLanguagePriority(st);
    const audioTag = tier === 1 || tier === 2 ? audioLabel : "";

    // Phân loại Độ phân giải
    let qualityTag = "FHD";
    if (/\b(2160p|4k|uhd)\b/i.test(fullText) || fullText.includes("2160") || fullText.includes("4k")) {
        qualityTag = "4K";
    } else if (/\b(1080p|fhd|bluray|remux)\b/i.test(fullText) || fullText.includes("1080") || fullText.includes("fhd")) {
        qualityTag = "FHD";
    } else if (/\b(720p|hd)\b/i.test(fullText) || fullText.includes("720") || fullText.includes("hd")) {
        qualityTag = "HD";
    }

    st.priorityTier = tier;
    st.audioLabel = audioLabel;
    st.qualityLabel = qualityTag;

    if (rawName.includes("4KHDHub") || rawName.includes("HubDrive")) {
        if (audioTag && !rawTitle.includes(audioTag)) {
            st.title = `[${audioTag}] [${qualityTag}]\n${rawTitle}`;
        }
        return st;
    }

    const badge = audioTag ? `[${audioTag}] [${qualityTag}]` : `[${qualityTag}]`;
    if (!rawTitle.includes(`[${qualityTag}]`) && (!audioTag || !rawTitle.includes(`[${audioTag}]`))) {
        st.title = `${badge} ${rawTitle}`.trim();
    }

    return st;
};

// =========================================================================
// 🚀 QUY TẮC SẮP XẾP ƯU TIÊN LUỒNG PHÁT KHI BẤM XEM PHIM:
// Ưu tiên số 1: Thuyết Minh / Lồng Tiếng / Song Ngữ
// Ưu tiên số 2: Vietsub / Phụ Đề Tiếng Việt
// Ưu tiên số 3: Các nguồn phát khác
// Trong mỗi bậc ưu tiên: Luồng Direct HLS phản hồi nhanh xếp trước, tiếp theo chất lượng 4K -> FHD -> HD
// =========================================================================
const sortStreamsByNewRule = (streams) => {
    streams.forEach(st => tagStreamAudioAndQuality(st));

    return streams.sort((a, b) => {
        const getScore = (st) => {
            const name = (st.name || "").toLowerCase();
            const title = (st.title || "").toLowerCase();
            const t = `${name} ${title}`;

            // 0. Kênh Truyền Hình Trực Tiếp
            const isTvChannel = st.behaviorHints?.isLive || t.includes("kênh") || t.includes("truyền hình") || t.includes("vtv") || t.includes("vtvcab") || t.includes("auraflix");
            if (isTvChannel && (st.behaviorHints?.isLive || t.includes("direct") || t.includes("drm") || t.includes("clearkey") || t.includes("proxy auraflix"))) {
                return 90000000;
            }

            const { tier } = detectStreamLanguagePriority(st);
            // Bậc ưu tiên ngôn ngữ tuyệt đối:
            // Tier 1 (Thuyết Minh): 30,000,000
            // Tier 2 (Vietsub):     20,000,000
            // Tier 3 (Nguồn khác):  10,000,000
            const tierBase = tier === 1 ? 30000000 : tier === 2 ? 20000000 : 10000000;

            // Ưu tiên luồng Direct HLS (.m3u8 / .mp4) có thể kiểm soát player & tự chuyển luồng sau 3s
            const isDirectStream = Boolean(st.url && !st.url.includes("/api/player"));
            const isAntiBlockProxy = Boolean(st.url && st.url.includes("/proxy/hls"));
            const directBonus = isDirectStream ? (isAntiBlockProxy ? 4500000 : 5000000) : 0;

            // Ưu tiên CDN Việt Nam tốc độ cao (KKPhim, VSMOV, OPhim, NguonC, Xink)
            const isVnServer =
                t.includes("kkphim") ||
                t.includes("phimapi") ||
                t.includes("nguonc") ||
                t.includes("vsmov") ||
                t.includes("vnstream") ||
                t.includes("xink") ||
                t.includes("onflix") ||
                t.includes("ophim");
            const vnBonus = isVnServer ? 2000000 : 0;

            // Điểm khớp dữ liệu
            let matchBonus = 0;
            if (st.matchType === "imdb_exact" || t.includes("imdb_exact")) {
                matchBonus = 500000;
            } else if (st.matchType === "title_absolute" || t.includes("title_absolute")) {
                matchBonus = 300000;
            } else if (st.matchType === "title_partial") {
                matchBonus = 100000;
            }

            // Điểm chất lượng (4K -> 1080p FHD -> 720p HD)
            let qualityScore = 1000;
            if (t.includes("4k") || t.includes("2160p") || t.includes("uhd")) {
                qualityScore = 30000;
            } else if (t.includes("1080p") || t.includes("fhd") || t.includes("bluray") || t.includes("100gbps")) {
                qualityScore = 15000;
            } else if (t.includes("720p") || t.includes("hd")) {
                qualityScore = 5000;
            }

            return tierBase + directBonus + vnBonus + matchBonus + qualityScore;
        };
        return getScore(b) - getScore(a);
    });
};

// =========================================================================
// 🌟 GIAO THỨC UNIVERSAL TVBOX & FONGMI (TVBOX V3/V4 / FONGMI SUBSCRIPTION)
// =========================================================================
const generateTvBoxConfig = (hostUrl) => {
    return {
        spider: "https://ghproxy.net/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar",
        wallpaper: "https://picsum.photos/1920/1080?blur=1",
        sites: [
            {
                key: "tungnui_vod",
                name: "🎬 TUNGNUI PRO (Kho Phim Đa Nguồn MacCMS V10)",
                type: 1,
                api: `${hostUrl}/api/tvbox/vod`,
                searchable: 1,
                quickSearch: 1,
                filterable: 1
            },
            {
                key: "kkphim_vn",
                name: "🇻🇳 KKPhim (Kho Phim Lẻ / Phim Bộ)",
                type: 1,
                api: `${hostUrl}/api/tvbox/vod?src=kkphim`,
                searchable: 1,
                quickSearch: 1,
                filterable: 1
            },
            {
                key: "ophim_vn",
                name: "🇻🇳 OPhim (Kho Phim Thuyết Minh)",
                type: 1,
                api: `${hostUrl}/api/tvbox/vod?src=ophim`,
                searchable: 1,
                quickSearch: 1,
                filterable: 1
            },
            {
                key: "nguonc_vn",
                name: "🇻🇳 NguonC (Phim Chiếu Rạp HD)",
                type: 1,
                api: `${hostUrl}/api/tvbox/vod?src=nguonc`,
                searchable: 1,
                quickSearch: 1,
                filterable: 1
            },
            {
                key: "asia_vip",
                name: "⚡ Châu Á Siêu Tốc (BaoFeng/TianKong)",
                type: 1,
                api: `${hostUrl}/api/tvbox/vod?src=asia`,
                searchable: 1,
                quickSearch: 1,
                filterable: 1
            }
        ],
        lives: [
            {
                name: "📺 Truyền Hình Trực Tiếp (VTV, VTVCab, Quốc Tế)",
                type: 0,
                url: `${hostUrl}/api/iptv/live-tv.m3u`,
                epg: "http://diendant留言.xyz/epg.xml",
                logo: "https://epg.112114.xyz/logo/{name}.png"
            },
            {
                name: "⚽ Trực Tiếp Bóng Đá & 81 Kênh BLV",
                type: 0,
                url: `${hostUrl}/api/iptv/football.m3u`
            },
            {
                name: "🥤 Toàn Bộ Kênh BLV Cola TV & Bình Luận",
                type: 0,
                url: `${hostUrl}/api/iptv/cola-tv.m3u`
            }
        ],
        parses: [
            {
                name: "⚡ TUNGNUI PRO Stream Proxy",
                type: 0,
                url: `${hostUrl}/proxy-stream?url=`
            }
        ],
        flags: ["youku", "qq", "iqiyi", "qiyi", "letv", "sohu", "tudou", "pptv", "mgtv", "wasu", "bilibili", "mytv", "vtv", "hls", "mpd"]
    };
};

const generateLiveTvM3uPlaylist = (channels, hostUrl) => {
    let m3u = `#EXTM3U name="TUNGNUI PRO - Live TV Playlist"\n`;
    (channels || []).forEach(ch => {
        const stream = ch.streams?.[0] || {};
        let rawUrl = stream.url || "";
        if (!rawUrl) return;

        let finalUrl = rawUrl;
        if (stream.isClearkeyFlag && stream.kidHex && stream.keyHex) {
            const baseUrlTarget = rawUrl.substring(0, rawUrl.lastIndexOf("/") + 1);
            const b64Base = Buffer.from(baseUrlTarget).toString("base64url");
            finalUrl = `${hostUrl}/proxy/dash/${b64Base}/manifest.mpd`;
        } else if (rawUrl.includes("mytvnet.vn") || rawUrl.includes("mytvn.net") || rawUrl.includes(".mpd")) {
            const baseUrlTarget = rawUrl.substring(0, rawUrl.lastIndexOf("/") + 1);
            const b64Base = Buffer.from(baseUrlTarget).toString("base64url");
            finalUrl = `${hostUrl}/proxy/dash/${b64Base}/manifest.mpd`;
        }

        const safeLogo = ch.poster || "";
        const group = ch.genre || "Truyền Hình";
        const tvgName = ch.name || "Kênh TV";
        const tvgId = ch.key || ch.id || "";

        m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${safeLogo}" group-title="${group}",${tvgName}\n`;
        m3u += `${finalUrl}\n`;
    });
    return m3u;
};

// =========================================================================
// EXPORTS CẦN THIẾT CHO SERVER.JS HOẠT ĐỘNG
// =========================================================================
module.exports = {
    BACKGROUND_AUTOMATION_CONFIG, ALLOWED_INTERNATIONAL_KEYS, AURAFLIX_PREMIUM_CHANNELS, isAllowedInternationalChannel, isNonEssentialInternationalChannel,
    getEndpoints, failureTelemetry, botSyncTelemetry, refreshChannelsAndClearKeys, TOP_MAIN_CATALOGS, SUB_GRID_CATALOGS, TV_CATALOGS, MOVIE_CATALOGS, ADULT_SUB_CATALOGS, ALL_CATALOGS, DEFAULT_ACTIVE_IDS,
    parseConfig, buildManifest, fetchLiveMatches, fetchUnifiedTvChannels, getChannelStreams, getChannelEpgInfo, fetchSubtitles, isAnimeMovie, getImgUrl, parseEpisodeNumber, searchAllMovieSources, searchCustomMovieApi, fetchFromCustomApi, testCustomMovieApi, fetchKKPhim, fetchVSMOV, fetchOPhim, fetchNguonC, fetchXink, fetchAllVnStreamsByTitle, fetchMainstreamMacCmsStreams, fetchWebAndNuvioMultiEmbedStreams, fetchAdultJav, fetchAdultJavMeta, fetchAdultJavStream, getCinemetaInfo, getImdbFromTitle, fetchVipTorrentHttp, parseVipTorrentResponse, fetchVNStream, fetchTorrentio, sortStreamsByNewRule, tagStreamAudioAndQuality, classifyTvChannel, isMovieChannel, isInternationalChannel, aiHealer,
    normalizeSubtitleTrack, extractExternalSubtitles,
    COLA_TV_STREAMS, ALL_COMMENTATOR_STREAMS, GAVANG_33_STREAMS, GAVANG_33_SV2_STREAMS, KHANDAI_TV_STREAMS, GAVANG_24H_STREAMS, XOICHE_TV_STREAMS,
    parseMatchKickoffTime, sortFootballMatchesChronologically, generateFootballM3uPlaylist,
    generateTvBoxConfig, generateLiveTvM3uPlaylist
};
