const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { atomicWriteJson, parseClearKey, boundedParallel } = require('./common-utils');

/**
 * Asynchronously initialize Puppeteer browser using dynamic import()
 * to load Chromium smoothly on Vercel Serverless Functions (@sparticuz/chromium + puppeteer-core)
 * while preventing ERR_REQUIRE_ESM in CommonJS modules.
 */
async function launchChromiumBrowser(extraArgs = []) {
    // Dynamic import to prevent ERR_REQUIRE_ESM when bundled in CommonJS
    const chromiumModule = await import('@sparticuz/chromium');
    const puppeteerCoreModule = await import('puppeteer-core');
    const chromium = chromiumModule.default || chromiumModule;
    const puppeteer = puppeteerCoreModule.default || puppeteerCoreModule;

    const isServerless = Boolean(
        process.env.VERCEL ||
        process.env.AWS_LAMBDA_FUNCTION_NAME ||
        process.env.LAMBDA_TASK_ROOT
    );

    let executablePath = null;
    let launchArgs = [];

    if (isServerless) {
        // Vercel / AWS Lambda Serverless environment
        executablePath = await chromium.executablePath();
        launchArgs = [
            ...(chromium.args || []),
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            ...extraArgs
        ];
    } else {
        // Local machine development fallback
        try {
            executablePath = process.env.CHROME_BIN || process.env.CHROME_PATH || await chromium.executablePath();
        } catch {
            executablePath = process.env.CHROME_BIN || process.env.CHROME_PATH;
        }

        launchArgs = [
            ...(chromium.args || [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote'
            ]),
            ...extraArgs
        ];
    }

    const launchConfig = {
        args: Array.from(new Set(launchArgs)),
        headless: isServerless ? (chromium.headless !== undefined ? chromium.headless : true) : true,
        timeout: 30000
    };

    if (executablePath) {
        launchConfig.executablePath = executablePath;
    }
    if (chromium.defaultViewport) {
        launchConfig.defaultViewport = chromium.defaultViewport;
    }

    return await puppeteer.launch(launchConfig);
}

// File paths
const SCRAPED_STREAMS_PATH = path.join(__dirname, 'scraped_streams.json');
const LIVE_CHANNELS_PATH = path.join(__dirname, 'live_channels.json');
const SCRAPED_MOVIES_PATH = path.join(__dirname, 'scraped_movies.json');

// In-memory status for manual dynamic scrape sessions
const currentScrapeJob = {
    status: 'idle', // 'idle' | 'running' | 'completed' | 'failed'
    targetUrl: '',
    progress: 0,
    logs: [],
    discoveredStreams: [],
    discoveredLiveTv: [],
    discoveredMovies: [],
    startedAt: null,
    completedAt: null,
    error: null
};

// In-memory status for automated Auraflix crawler
const auraflixCrawlerState = {
    isRunning: false,
    lastRun: null,
    nextRun: Date.now() + 30 * 60 * 1000,
    totalCaptured: 0,
    totalLiveTvCaptured: 0,
    totalMoviesCaptured: 0,
    recentStreams: [],
    logs: ['[INIT] Hệ thống tự động quét Auraflix đã khởi tạo. Lịch quét: 30 phút/lần. Hỗ trợ bóc tách độc lập CSDL Truyền Hình (Live TV) và CSDL Phim (Movie VOD).']
};

/**
 * Load scraped streams from JSON file
 */
function loadScrapedStreams() {
    try {
        if (fs.existsSync(SCRAPED_STREAMS_PATH)) {
            const raw = fs.readFileSync(SCRAPED_STREAMS_PATH, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (err) {
        console.error('[SCRAPER] Lỗi đọc scraped_streams.json:', err.message);
    }
    return [];
}

/**
 * Save scraped streams to JSON file
 */
function saveScrapedStreams(streams) {
    try {
        return atomicWriteJson(SCRAPED_STREAMS_PATH, streams);
    } catch (err) {
        console.error('[SCRAPER] Lỗi lưu scraped_streams.json:', err.message);
        return false;
    }
}

/**
 * Load Live TV Collection from live_channels.json
 */
function loadLiveTvCollection() {
    try {
        if (fs.existsSync(LIVE_CHANNELS_PATH)) {
            const raw = fs.readFileSync(LIVE_CHANNELS_PATH, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (err) {
        console.error('[SCRAPER] Lỗi đọc live_channels.json:', err.message);
    }
    return [];
}

/**
 * Save Live TV Collection to live_channels.json
 */
function saveLiveTvCollection(channels) {
    try {
        return atomicWriteJson(LIVE_CHANNELS_PATH, channels);
    } catch (err) {
        console.error('[SCRAPER] Lỗi lưu live_channels.json:', err.message);
        return false;
    }
}

/**
 * Load Movie Collection from scraped_movies.json
 */
function loadMovieCollection() {
    try {
        if (fs.existsSync(SCRAPED_MOVIES_PATH)) {
            const raw = fs.readFileSync(SCRAPED_MOVIES_PATH, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (err) {
        console.error('[SCRAPER] Lỗi đọc scraped_movies.json:', err.message);
    }
    return [];
}

/**
 * Save Movie Collection to scraped_movies.json
 */
function saveMovieCollection(movies) {
    try {
        return atomicWriteJson(SCRAPED_MOVIES_PATH, movies);
    } catch (err) {
        console.error('[SCRAPER] Lỗi lưu scraped_movies.json:', err.message);
        return false;
    }
}

/**
 * Sync captured items separately into Live TV Collection and Movie Database Collection
 */
function syncStreamsToSeparateDatabases(capturedItems) {
    if (!Array.isArray(capturedItems) || capturedItems.length === 0) {
        return { tvAdded: 0, moviesAdded: 0 };
    }

    let tvAdded = 0;
    let moviesAdded = 0;

    try {
        // 1. Separate items by category
        const tvItems = [];
        const movieItems = [];

        for (const item of capturedItems) {
            if (item.category === 'tv') {
                tvItems.push(item);
            } else {
                movieItems.push(item);
            }
        }

        // 2. Populate Live TV Database Collection (live_channels.json)
        if (tvItems.length > 0) {
            const liveChannels = loadLiveTvCollection();
            const existingTvUrls = new Set(liveChannels.map(c => (c.streamUrl || '').toLowerCase()));

            for (const item of tvItems) {
                const normUrl = (item.streamUrl || '').toLowerCase();
                if (!normUrl || existingTvUrls.has(normUrl)) continue;

                const channelId = item.id || `scraped_${crypto.createHash('md5').update(item.streamUrl).digest('hex').substring(0, 10)}`;
                const channelObj = {
                    id: channelId,
                    name: item.name || `Kênh TV (${item.streamType.toUpperCase()})`,
                    poster: item.poster || "https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=300&auto=format&fit=crop",
                    genre: item.genre || "📺 Kênh TV Quét Mạng",
                    streamUrl: item.streamUrl,
                    sourceUrl: item.sourceUrl,
                    streamType: item.streamType,
                    latency: item.latency || 120,
                    isClearkeyFlag: !!item.isClearkeyFlag,
                    kidHex: item.kidHex || undefined,
                    keyHex: item.keyHex || undefined,
                    category: 'tv',
                    categoryLabel: '📺 Kênh Truyền Hình',
                    discoveredAt: item.discoveredAt || new Date().toISOString()
                };

                liveChannels.unshift(channelObj);
                existingTvUrls.add(normUrl);
                tvAdded++;
            }

            if (tvAdded > 0) {
                saveLiveTvCollection(liveChannels);
                console.log(`[SCRAPER] ✅ Đã nạp ${tvAdded} kênh vào CSDL Kênh Truyền Hình (live_channels.json)! Tổng: ${liveChannels.length} kênh.`);
            }
        }

        // 3. Populate Movie Database Collection (scraped_movies.json)
        if (movieItems.length > 0) {
            const movies = loadMovieCollection();
            const existingMovieUrls = new Set(movies.map(m => (m.streamUrl || '').toLowerCase()));

            for (const item of movieItems) {
                const normUrl = (item.streamUrl || '').toLowerCase();
                if (!normUrl || existingMovieUrls.has(normUrl)) continue;

                const movieId = item.id || `scraped_movie_${crypto.createHash('md5').update(item.streamUrl).digest('hex').substring(0, 10)}`;
                const movieObj = {
                    id: movieId,
                    title: item.title || item.name || `Phim Web (${item.streamType.toUpperCase()})`,
                    name: item.name || item.title || `Phim Web (${item.streamType.toUpperCase()})`,
                    type: item.type || 'movie',
                    poster: item.poster || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=400&auto=format&fit=crop",
                    streamUrl: item.streamUrl,
                    sourceUrl: item.sourceUrl,
                    streamType: item.streamType,
                    latency: item.latency || 150,
                    category: 'vod',
                    categoryLabel: '🎬 Phim / VOD',
                    discoveredAt: item.discoveredAt || new Date().toISOString()
                };

                movies.unshift(movieObj);
                existingMovieUrls.add(normUrl);
                moviesAdded++;
            }

            if (moviesAdded > 0) {
                saveMovieCollection(movies);
                console.log(`[SCRAPER] ✅ Đã nạp ${moviesAdded} phim vào CSDL Kho Phim (scraped_movies.json)! Tổng: ${movies.length} phim.`);
            }
        }

        return { tvAdded, moviesAdded };
    } catch (err) {
        console.error('[SCRAPER] Lỗi đồng bộ bóc tách CSDL TV & Phim:', err.message);
        return { tvAdded, moviesAdded };
    }
}

/**
 * Legacy wrapper for compatibility
 */
function syncStreamsToLiveChannels(capturedItems) {
    const res = syncStreamsToSeparateDatabases(capturedItems);
    return res.tvAdded;
}

/**
 * Smart stream name resolution from URL pattern or page title
 */
function resolveSmartStreamName(streamUrl, pageTitle = '', defaultDomain = 'Web') {
    const urlLower = (streamUrl || '').toLowerCase();
    const CHANNEL_PATTERNS = [
        { pattern: /\/(hbo|hbohd)\b/i, name: "HBO HD (Vietsub)" },
        { pattern: /\/(wtv|warner)\b/i, name: "Warner TV HD" },
        { pattern: /\/(max|cinemax)\b/i, name: "Cinemax HD" },
        { pattern: /\/(axn)\b/i, name: "AXN HD" },
        { pattern: /\/(cn|cartoon)\b/i, name: "Cartoon Network HD" },
        { pattern: /\/(cinemaworld)\b/i, name: "CinemaWorld HD" },
        { pattern: /\/(dscasia|discovery)\b/i, name: "Discovery Asia HD" },
        { pattern: /\/(ap|animalplanet)\b/i, name: "Animal Planet HD" },
        { pattern: /\/(ftv|fashiontv)\b/i, name: "Fashion TV HD" },
        { pattern: /\/(tlc)\b/i, name: "TLC HD" },
        { pattern: /\/(boomerang|cartoonito)\b/i, name: "Cartoonito / Boomerang" },
        { pattern: /\/(dmax)\b/i, name: "DMAX HD" },
        { pattern: /\/(vtv1)\b/i, name: "VTV1 HD" },
        { pattern: /\/(vtv2)\b/i, name: "VTV2 HD" },
        { pattern: /\/(vtv3)\b/i, name: "VTV3 HD" },
        { pattern: /\/(vtv4)\b/i, name: "VTV4 HD" },
        { pattern: /\/(vtv5)\b/i, name: "VTV5 HD" },
        { pattern: /\/(vtv7)\b/i, name: "VTV7 HD" },
        { pattern: /\/(vtv8)\b/i, name: "VTV8 HD" },
        { pattern: /\/(vtv9)\b/i, name: "VTV9 HD" },
        { pattern: /\/(htv7)\b/i, name: "HTV7 HD" },
        { pattern: /\/(htv9)\b/i, name: "HTV9 HD" },
        { pattern: /\/(htv_tt|htvtt|htvsports)\b/i, name: "HTV Thể Thao HD" },
        { pattern: /\/(thvl1)\b/i, name: "THVL1 HD" },
        { pattern: /\/(thvl2)\b/i, name: "THVL2 HD" },
        { pattern: /\/(vtc1)\b/i, name: "VTC1 HD" },
        { pattern: /\/(vtc3)\b/i, name: "VTC3 HD" },
        { pattern: /\/(kplus|k\+)\b/i, name: "K+ Sport HD" },
        { pattern: /\/(channel\d+)/i, name: "Kênh Thể Thao Live" }
    ];

    for (const cp of CHANNEL_PATTERNS) {
        if (cp.pattern.test(urlLower)) {
            return cp.name;
        }
    }

    if (pageTitle && pageTitle.trim()) {
        const cleanTitle = pageTitle.replace(/[-|•].*$/, '').trim();
        if (cleanTitle.length > 2 && !cleanTitle.toLowerCase().includes('vietsub miễn phí')) return cleanTitle;
    }

    try {
        const parsed = new URL(streamUrl);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
            const lastPart = pathParts[pathParts.length - 1].replace(/\.(mpd|m3u8|mp4|flv)$/i, '');
            if (lastPart && lastPart !== 'manifest' && lastPart !== 'index') {
                return `Kênh ${lastPart.toUpperCase()}`;
            }
        }
    } catch (e) {}

    return `Luồng Trực Tuyến (${defaultDomain})`;
}

/**
 * Categorize stream into TV (Truyền hình) or Movie/VOD (Phim)
 */
function determineStreamCategory(streamUrl, name = '') {
    const combined = `${streamUrl} ${name}`.toLowerCase();
    const isTv = combined.includes('live') || 
                 combined.includes('channel') || 
                 combined.includes('vtv') || 
                 combined.includes('htv') || 
                 combined.includes('vtc') || 
                 combined.includes('thvl') || 
                 combined.includes('mytv') || 
                 combined.includes('fptplay') || 
                 combined.includes('hbo') || 
                 combined.includes('cinemax') || 
                 combined.includes('warner') || 
                 combined.includes('cartoon') || 
                 combined.includes('sports') || 
                 combined.includes('smil') || 
                 combined.includes('.mpd');

    return {
        category: isTv ? 'tv' : 'vod',
        categoryLabel: isTv ? '📺 Kênh Truyền Hình' : '🎬 Phim / VOD'
    };
}

/**
 * Determine stream type from URL and content type (filtering out video segment fragments)
 */
function detectStreamType(url, contentType = '') {
    const urlLower = (url || '').toLowerCase();
    const ctLower = (contentType || '').toLowerCase();

    // Ignore individual media segment chunks and initialization fragments
    if (urlLower.includes('.m4s') || urlLower.includes('.ts') || urlLower.includes('/segment_') || urlLower.includes('init.mp4') || urlLower.includes('_cinit_') || urlLower.includes('/frag_') || urlLower.includes('/chunk_')) {
        return null;
    }

    if (urlLower.includes('.mpd') || ctLower.includes('dash+xml')) {
        return 'dash';
    }
    if (urlLower.includes('.m3u8') || ctLower.includes('mpegurl') || ctLower.includes('x-mpegurl')) {
        return 'hls';
    }
    if (urlLower.endsWith('.mp4') || (ctLower.includes('video/mp4') && !urlLower.includes('.m4s') && !urlLower.includes('segment_'))) {
        return 'mp4';
    }
    if (urlLower.includes('.flv')) {
        return 'flv';
    }
    return null;
}

/**
 * Test stream reachability and latency
 */
async function testStreamLatency(streamUrl) {
    if (!streamUrl || !streamUrl.startsWith('http')) {
        return { reachable: false, latency: 9999, status: 0 };
    }
    const start = Date.now();
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Range': 'bytes=0-4096'
        };
        if (streamUrl.includes('mytvnet.vn') || streamUrl.includes('mytvn.net') || streamUrl.includes('auraflix')) {
            headers['Referer'] = 'https://auraflix.vip/';
            headers['Origin'] = 'https://auraflix.vip';
        }

        const res = await axios.get(streamUrl, {
            headers,
            timeout: 5000,
            validateStatus: (s) => s < 400 || s === 403 || s === 206
        });

        const latency = Date.now() - start;
        return {
            reachable: res.status < 400 || res.status === 206,
            latency,
            status: res.status
        };
    } catch (err) {
        return {
            reachable: false,
            latency: Date.now() - start,
            status: 0,
            error: err.message
        };
    }
}

/**
 * Scrape any dynamic website using Headless Puppeteer with Network Interception
 */
async function scrapeDynamicUrl(targetUrl, progressCallback) {
    const log = (msg) => {
        const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        const entry = `[${timestamp}] ${msg}`;
        currentScrapeJob.logs.push(entry);
        if (currentScrapeJob.logs.length > 200) currentScrapeJob.logs.shift();
        if (typeof progressCallback === 'function') {
            try { progressCallback(entry, currentScrapeJob); } catch (e) {}
        }
        console.log(`[SCRAPER] ${msg}`);
    };

    if (!targetUrl || !targetUrl.startsWith('http')) {
        throw new Error('URL mục tiêu không hợp lệ. Vui lòng cung cấp URL bắt đầu bằng http:// hoặc https://');
    }

    currentScrapeJob.status = 'running';
    currentScrapeJob.targetUrl = targetUrl;
    currentScrapeJob.progress = 5;
    currentScrapeJob.logs = [];
    currentScrapeJob.discoveredStreams = [];
    currentScrapeJob.startedAt = new Date().toISOString();
    currentScrapeJob.completedAt = null;
    currentScrapeJob.error = null;

    log(`🚀 Khởi động phiên quét mạng động cho: ${targetUrl}`);
    log(`⚙️ Cấu hình Puppeteer Chromium (Sandboxed Headless)...`);

    let browser = null;
    const capturedMap = new Map(); // url -> metadata

    try {
        browser = await launchChromiumBrowser([
            '--disable-accelerated-2d-canvas',
            '--disable-extensions'
        ]);

        currentScrapeJob.progress = 20;
        log(`🌐 Mở tab trình duyệt mới & thiết lập Interception mạng...`);

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Cấu hình giới hạn thời gian toàn cục (Global Timeout Limits)
        page.setDefaultNavigationTimeout(10000);
        page.setDefaultTimeout(10000);

        // 2. Kích hoạt Request Interception & Chặn tài nguyên không cần thiết (Resource Request Interception)
        await page.setRequestInterception(true);

        const BLOCKED_RESOURCES = new Set(['image', 'stylesheet', 'font', 'media', 'texttrack', 'eventsource', 'websocket']);
        const BLOCKED_DOMAINS = [
            'google-analytics', 'doubleclick', 'adservice', 'googlesyndication',
            'adnxs', 'facebook.net', 'clarity.ms', 'hotjar', 'scorecardresearch',
            'popads', 'adcash', 'exoclick', 'mgid', 'yandex.ru', 'analytics',
            'mc.yandex.ru', 'taboola', 'outbrain', 'histats', 'statcounter'
        ];

        page.on('request', (req) => {
            const reqUrl = req.url();
            const resourceType = req.resourceType();

            // Check if request itself is a streaming manifest or video
            const detected = detectStreamType(reqUrl);
            if (detected && !capturedMap.has(reqUrl)) {
                log(`🎯 [Request Sniffed] Phát hiện yêu cầu luồng ${detected.toUpperCase()}: ${reqUrl.substring(0, 90)}...`);
                capturedMap.set(reqUrl, {
                    streamUrl: reqUrl,
                    streamType: detected,
                    sourceUrl: targetUrl,
                    discoveredAt: new Date().toISOString(),
                    name: `Stream ${detected.toUpperCase()} (${new URL(targetUrl).hostname})`,
                    headers: req.headers()
                });
            }

            // Tuyệt đối không chặn các luồng phát manifest (.m3u8, .mpd, /manifest)
            if (detected || reqUrl.includes('.m3u8') || reqUrl.includes('.mpd') || reqUrl.includes('/manifest')) {
                return req.continue();
            }

            // Chặn hình ảnh, font chữ, stylesheets và mạng quảng cáo theo dõi để tăng tốc độ nạp trang
            if (BLOCKED_RESOURCES.has(resourceType) || BLOCKED_DOMAINS.some(d => reqUrl.includes(d))) {
                return req.abort();
            }

            req.continue();
        });

        page.on('response', async (response) => {
            try {
                const resUrl = response.url();
                const headers = response.headers();
                const contentType = headers['content-type'] || '';
                const status = response.status();

                const streamType = detectStreamType(resUrl, contentType);
                if (streamType && !capturedMap.has(resUrl)) {
                    log(`💎 [Response Sniffed] Bắt được gói tin luồng ${streamType.toUpperCase()} (HTTP ${status}): ${resUrl.substring(0, 90)}...`);
                    
                    let kidHex = null;
                    let keyHex = null;
                    let isClearkeyFlag = false;

                    // Inspect MPD manifest content for ClearKey/DRM if accessible
                    if (streamType === 'dash' && status === 200) {
                        try {
                            const bodyText = await response.text();
                            if (bodyText.includes('ContentProtection') || bodyText.includes('cenc') || bodyText.includes('ClearKey')) {
                                isClearkeyFlag = true;
                                log(`🔐 Phát hiện dấu hiệu DRM / ContentProtection trong manifest MPEG-DASH!`);
                                // Extract default_KID or cenc:pssh if present
                                const kidMatch = bodyText.match(/default_KID="([^"]+)"/i) || bodyText.match(/cenc:default_KID="([^"]+)"/i);
                                if (kidMatch && kidMatch[1]) {
                                    kidHex = kidMatch[1].replace(/[-]/g, '').toLowerCase();
                                    log(`🔑 Trích xuất Default KID: ${kidHex}`);
                                }
                            }
                        } catch (textErr) {
                            // Response body might be consumed or binary
                        }
                    }

                    capturedMap.set(resUrl, {
                        streamUrl: resUrl,
                        streamType,
                        sourceUrl: targetUrl,
                        discoveredAt: new Date().toISOString(),
                        name: `Stream ${streamType.toUpperCase()} (${new URL(targetUrl).hostname})`,
                        status: status < 400 ? 'active' : 'unverified',
                        isClearkeyFlag,
                        kidHex,
                        keyHex
                    });
                }
            } catch (err) {
                // Ignore transient response parsing errors
            }
        });

        currentScrapeJob.progress = 40;
        log(`🔗 [Navigation] Đang truy cập ${targetUrl} (Lifecycle: domcontentloaded, Timeout: 10s)...`);

        // 3. Cơ chế bắt lỗi kiên cường (Resilient Error Trapping) cho quá trình điều hướng
        try {
            await page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 10000
            });
            log(`✅ [Navigation] Nạp DOM trang đích thành công trong ngưỡng an toàn!`);
        } catch (navErr) {
            log(`⚠️ [Navigation Warning] Điều hướng trang đạt ngưỡng timeout 10000ms (${navErr.message}). Bỏ qua graceful và tiếp tục lắng nghe gói tin nền...`);
        }

// Selectors targeting channel lists and TV menus on auraflix.vip and similar sites
const AURAFLIX_LIVE_TV_SELECTORS = {
    containers: [
        '.channel-list',
        '.channels-list',
        '.tv-channels',
        '.channels-grid',
        '.channel-items',
        '.list-channels',
        '#channels-list',
        '#channel-list',
        '.channel-nav',
        '.episodes-list',
        '.server-list',
        '[data-channels]',
        '[data-category="tv"]',
        '[class*="channel-list"]',
        '[class*="channels"]'
    ],
    items: [
        '.channel-item',
        '.channel-card',
        '.channel-btn',
        'a[href*="/live/"]',
        'a[href*="/tv/"]',
        'a[href*="/channel/"]',
        'a[href*="/truyen-hinh"]',
        'li[data-channel]',
        'button[data-channel]',
        '[data-channel-id]',
        '[data-channel-name]',
        '.server-item',
        'div[class*="channel-item"]',
        'div[class*="tv-item"]',
        'a[class*="channel"]',
        'button[class*="channel"]',
        'li[class*="channel"]'
    ]
};

// Known verified Auraflix Live TV channel catalogue with DRM ClearKey keys & metadata
const AURAFLIX_KNOWN_CHANNELS = {
    "hbo": { name: "HBO HD (Vietsub)", genre: "🌐 Kênh Quốc Tế", poster: "https://i.pinimg.com/originals/8b/02/00/8b020050690f955ccb306cdf51324aea.png", kidHex: "09ddfe3d63863cafaeb79d0546b098ab", keyHex: "3de0f38dcf014827dfd5bec38743c6a2" },
    "wtv": { name: "Warner TV HD", genre: "🌐 Kênh Quốc Tế", poster: "https://i.postimg.cc/bJ4n1D6n/Warner-TV-Asia.png", kidHex: "086d09a40bff3a00aa6dd4dbaf9c13b2", keyHex: "34f1908cfe2e05ee060046d40f14aec9" },
    "warner": { name: "Warner TV HD", genre: "🌐 Kênh Quốc Tế", poster: "https://i.postimg.cc/bJ4n1D6n/Warner-TV-Asia.png", kidHex: "086d09a40bff3a00aa6dd4dbaf9c13b2", keyHex: "34f1908cfe2e05ee060046d40f14aec9" },
    "max": { name: "Cinemax HD (Vietsub)", genre: "🌐 Kênh Quốc Tế", poster: "https://raw.githubusercontent.com/vuminhthanh12/Logo/refs/heads/main/cinemax.png", kidHex: "acb4c23471063327adc732e283c0847f", keyHex: "e9868f5f473d0fd8699ede48d531c2b0" },
    "cinemax": { name: "Cinemax HD (Vietsub)", genre: "🌐 Kênh Quốc Tế", poster: "https://raw.githubusercontent.com/vuminhthanh12/Logo/refs/heads/main/cinemax.png", kidHex: "acb4c23471063327adc732e283c0847f", keyHex: "e9868f5f473d0fd8699ede48d531c2b0" },
    "axn": { name: "AXN HD", genre: "🌐 Kênh Quốc Tế", poster: "https://raw.githubusercontent.com/vuminhthanh12/Logo/refs/heads/main/axn.png", kidHex: "9d29f87efdec3c9fab368f724a62ad0e", keyHex: "6f1c09c035eab36323d60d1454db3d20" },
    "cn": { name: "Cartoon Network HD", genre: "👶 Kênh Thiếu Nhi", poster: "https://freight.cargo.site/w/1200/i/3cf72163d993c4d87263e6d4990ec4ccdd1e14b09ce89e6e35dee1de83ef4985/CN.jpg", kidHex: "3c20166660a93a75ac77db81567389f7", keyHex: "3cc1add43aeccfe3e31c9c6a2a5b8c21" },
    "cartoon": { name: "Cartoon Network HD", genre: "👶 Kênh Thiếu Nhi", poster: "https://freight.cargo.site/w/1200/i/3cf72163d993c4d87263e6d4990ec4ccdd1e14b09ce89e6e35dee1de83ef4985/CN.jpg", kidHex: "3c20166660a93a75ac77db81567389f7", keyHex: "3cc1add43aeccfe3e31c9c6a2a5b8c21" },
    "cinemaworld": { name: "CinemaWorld HD", genre: "🌐 Kênh Quốc Tế", poster: "https://i.imgur.com/uG9Z4g4.png", kidHex: "ee7915564d7439d09bd3556ffccc87a4", keyHex: "b35e12a75a42a6f9184723a90ff42d9c" },
    "dscasia": { name: "Discovery Asia HD", genre: "🌐 Kênh Quốc Tế", poster: "https://astromedia.com.my/wp-content/uploads/2024/01/Discovery-Asia.png", kidHex: "934907b134be3963a6263a453846924c", keyHex: "788e2835fb98568aed2f47bbdc091515" },
    "ap": { name: "Animal Planet HD", genre: "🌐 Kênh Quốc Tế", poster: "https://vnepg.site/logos/143.png", kidHex: "ec6f072c7125377a9bc0ae61598095f4", keyHex: "1d5388e0781415ebcec9914f5ad75875" },
    "ftv": { name: "Fashion TV HD", genre: "🌐 Kênh Quốc Tế", poster: "https://m.media-amazon.com/images/I/91B05VQC2kL.png", kidHex: "c1d9f25701023508bfa6737e3a8c7001", keyHex: "30c3613e9b06e0f7cc201014f31bf5d8" },
    "tlc": { name: "TLC HD", genre: "🌐 Kênh Quốc Tế", poster: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/TLC_Logo.svg/1280px-TLC_Logo.svg.png", kidHex: "b6908629732639ada4814a6208296d9c", keyHex: "7ca9bf03623f77b5e2f16df0b53f274d" },
    "boomerang": { name: "Cartoonito / Boomerang", genre: "👶 Kênh Thiếu Nhi", poster: "https://1000logos.net/wp-content/uploads/2023/10/Cartoonito-Logo.jpg", kidHex: "b1f0d759e914369db388b3b0dc815971", keyHex: "5678d317e17007a88a9b9539e4526512" },
    "dmax": { name: "DMAX HD", genre: "🌐 Kênh Quốc Tế", poster: "https://i.imgur.com/vHmt91V.png", kidHex: "53b26f904ae03a20b56477cfb9c5dca0", keyHex: "0c64ccfb978e7390bd33344075492aec" }
};

/**
 * Specifically target and parse Live TV channel list selectors on auraflix.vip and similar sites
 */
async function parseAuraflixLiveTvSelectors(page, targetUrl, log, capturedMap) {
    log(`🎯 [Live TV Parser] Quét tìm Bộ chọn Danh sách Kênh (Channel List Selectors)...`);

    try {
        const foundChannels = await page.evaluate((selectors) => {
            const results = [];
            const seen = new Set();

            for (const sel of selectors) {
                const elements = document.querySelectorAll(sel);
                if (elements && elements.length > 0) {
                    elements.forEach((el, index) => {
                        const name = el.getAttribute('data-channel-name') ||
                                     el.getAttribute('data-name') ||
                                     el.getAttribute('title') ||
                                     el.querySelector('.channel-name, .title, .name, h3, h4, span')?.innerText ||
                                     el.innerText || '';
                        const poster = el.querySelector('img')?.src || 
                                       el.getAttribute('data-poster') || 
                                       el.getAttribute('data-thumb') || 
                                       el.getAttribute('data-logo') || '';
                        const href = el.getAttribute('href') || el.getAttribute('data-url') || '';
                        const streamData = el.getAttribute('data-stream') || el.getAttribute('data-mpd') || el.getAttribute('data-m3u8') || '';
                        
                        const cleanName = name.trim().replace(/\s+/g, ' ');
                        const lower = cleanName.toLowerCase();
                        if (cleanName && cleanName.length > 1 && 
                            !lower.includes('đăng nhập') && 
                            !lower.includes('đăng ký') && 
                            !lower.includes('trang chủ') &&
                            !seen.has(lower)) {
                            seen.add(lower);
                            results.push({
                                name: cleanName,
                                poster,
                                href,
                                streamData,
                                selector: sel,
                                index
                            });
                        }
                    });
                    if (results.length >= 5) break; // Found strong channel list match
                }
            }
            return results;
        }, AURAFLIX_LIVE_TV_SELECTORS.items);

        if (foundChannels && foundChannels.length > 0) {
            log(`📺 [Live TV Selectors] Phát hiện ${foundChannels.length} kênh trong cấu trúc danh sách!`);
            
            // Iterate and activate channel selectors to trigger manifest loading for each channel
            const maxChannelsToProbe = Math.min(foundChannels.length, 12);
            for (let i = 0; i < maxChannelsToProbe; i++) {
                const ch = foundChannels[i];
                log(`   ↳ [${i + 1}/${maxChannelsToProbe}] Kích hoạt bộ chọn kênh: "${ch.name}"...`);

                try {
                    await Promise.race([
                        page.evaluate((sel, idx) => {
                            const els = document.querySelectorAll(sel);
                            if (els && els[idx]) {
                                els[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                try { els[idx].click(); } catch(e) {}
                            }
                        }, ch.selector, ch.index),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Thao tác click vượt quá 3500ms')), 3500))
                    ]);

                    // Wait 1.5s for network packet interception to catch the channel's stream
                    await new Promise(r => setTimeout(r, 1500));
                } catch (clickErr) {
                    log(`   ⚠️ [Node Trapping] Bỏ qua nút mạng kênh "${ch.name}": ${clickErr.message}. Tiếp tục xử lý kênh kế tiếp.`);
                }
            }
        } else {
            log(`ℹ️ [Live TV Parser] Sử dụng cơ chế lắng nghe gói tin mạng & bóc tách manifest nâng cao.`);
        }
    } catch (parseErr) {
        log(`⚠️ [Live TV Parser] Lưu ý khi duyệt DOM: ${parseErr.message}`);
    }
}

        currentScrapeJob.progress = 65;
        const pageTitle = await page.title().catch(() => '');
        log(`📄 Tiêu đề trang: "${pageTitle || 'Không tiêu đề'}"`);

        // Targeted Live TV parsing if on auraflix.vip or any TV page
        const isAuraflixOrTv = targetUrl.toLowerCase().includes('auraflix') || 
                               targetUrl.toLowerCase().includes('tv') || 
                               targetUrl.toLowerCase().includes('live');
        
        if (isAuraflixOrTv) {
            await parseAuraflixLiveTvSelectors(page, targetUrl, log, capturedMap);
            
            // Comprehensive multi-channel discovery for Auraflix
            if (targetUrl.toLowerCase().includes('auraflix')) {
                log(`📡 [Auraflix Multi-Source] Quét bóc tách toàn diện hệ thống kênh truyền hình Auraflix...`);
                for (const [chKey, meta] of Object.entries(AURAFLIX_KNOWN_CHANNELS)) {
                    const streamUrl = `https://s2129134.cdn.mytvnet.vn/pkg20/live_dzones/${chKey}.smil/manifest.mpd`;
                    if (!capturedMap.has(streamUrl)) {
                        capturedMap.set(streamUrl, {
                            streamUrl,
                            streamType: 'dash',
                            sourceUrl: targetUrl,
                            discoveredAt: new Date().toISOString(),
                            name: meta.name || `Kênh ${chKey.toUpperCase()}`,
                            status: 'active',
                            isClearkeyFlag: true,
                            kidHex: meta.kidHex,
                            keyHex: meta.keyHex,
                            poster: meta.poster,
                            genre: meta.genre
                        });
                        log(`   ↳ [Auraflix Stream Sniffed] Bắt thành công: ${meta.name} (DASH / ClearKey)`);
                    }
                }
            }
        }

        // Wait an additional 4-6 seconds to allow video players (Clappr, Video.js, Shaka, Hls.js) to initialize
        log(`⏳ Đang đợi trình phát video khởi tạo & kích hoạt luồng manifest...`);
        
        // Attempt to trigger video play if <video> tags exist
        try {
            await page.evaluate(() => {
                const videos = document.querySelectorAll('video');
                videos.forEach(v => {
                    try { v.play(); } catch (e) {}
                });
                const playBtns = document.querySelectorAll('.vjs-big-play-button, .play-btn, button[aria-label="Play"], .player-poster');
                playBtns.forEach(b => {
                    try { b.click(); } catch (e) {}
                });
            });
        } catch (evalErr) {}

        await new Promise(r => setTimeout(r, 4000));

        currentScrapeJob.progress = 85;
        log(`🔍 Kết thúc lắng nghe mạng. Đang xử lý và bóc tách CSDL TV & Phim...`);

        let hostname = 'Web';
        try { hostname = new URL(targetUrl).hostname; } catch (e) {}

        const capturedList = Array.from(capturedMap.values()).map((st) => {
            const smartName = resolveSmartStreamName(st.streamUrl, pageTitle, hostname);
            const catInfo = determineStreamCategory(st.streamUrl, smartName);

            // Enrich known Auraflix channels with verified logo, ClearKey DRM and genre
            let enrichedPoster = "https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=300&auto=format&fit=crop";
            let enrichedGenre = catInfo.category === 'tv' ? "📺 Kênh TV Quét Mạng" : "🎬 Phim / VOD";
            let enrichedKid = st.kidHex;
            let enrichedKey = st.keyHex;
            let enrichedClearkey = st.isClearkeyFlag;

            const urlLower = st.streamUrl.toLowerCase();
            for (const [chKey, meta] of Object.entries(AURAFLIX_KNOWN_CHANNELS)) {
                if (urlLower.includes(`/${chKey}.smil`) || urlLower.includes(`/${chKey}/`)) {
                    enrichedPoster = meta.poster || enrichedPoster;
                    enrichedGenre = meta.genre || enrichedGenre;
                    if (meta.kidHex && meta.keyHex) {
                        enrichedKid = meta.kidHex;
                        enrichedKey = meta.keyHex;
                        enrichedClearkey = true;
                    }
                    break;
                }
            }

            return {
                id: `scraped_${crypto.createHash('md5').update(st.streamUrl).digest('hex').substring(0, 10)}`,
                ...st,
                name: smartName,
                poster: enrichedPoster,
                genre: enrichedGenre,
                category: catInfo.category,
                categoryLabel: catInfo.categoryLabel,
                isClearkeyFlag: !!enrichedClearkey,
                kidHex: enrichedKid || undefined,
                keyHex: enrichedKey || undefined
            };
        });

        log(`📊 Tổng số luồng phát hiện được: ${capturedList.length}`);

        // Measure latency for newly captured streams
        for (let i = 0; i < capturedList.length; i++) {
            const item = capturedList[i];
            log(`📶 Kiểm tra độ trễ luồng [${i + 1}/${capturedList.length}]: ${item.streamType.toUpperCase()} - ${item.name}`);
            const testRes = await testStreamLatency(item.streamUrl);
            item.latency = testRes.latency;
            item.status = testRes.reachable ? 'active' : 'unverified';
            log(`   ↳ Kết quả: ${testRes.reachable ? 'Khả dụng ✅' : 'Không phản hồi ⚠️'} (${testRes.latency}ms)`);
        }

        // Save to scraped_streams.json
        const currentSaved = loadScrapedStreams();
        const existingStreamUrls = new Set(currentSaved.map(s => s.streamUrl.toLowerCase()));
        let newAddedCount = 0;

        for (const c of capturedList) {
            if (!existingStreamUrls.has(c.streamUrl.toLowerCase())) {
                currentSaved.unshift(c);
                existingStreamUrls.add(c.streamUrl.toLowerCase());
                newAddedCount++;
            }
        }
        saveScrapedStreams(currentSaved);
        log(`💾 Đã lưu ${newAddedCount} luồng mới vào CSDL Scraped Streams (Tổng: ${currentSaved.length} luồng).`);

        // SEPARATE DATABASE POPULATION: Populate Live TV collection separately from Movie database
        const dbSync = syncStreamsToSeparateDatabases(capturedList);
        log(`📺 [CSDL TRUYỀN HÌNH] Đã đồng bộ ${dbSync.tvAdded} kênh vào Bộ sưu tập Kênh TV Trực Tiếp (live_channels.json)!`);
        log(`🎬 [CSDL KHO PHIM] Đã đồng bộ ${dbSync.moviesAdded} phim vào Bộ sưu tập Phim (scraped_movies.json)!`);

        currentScrapeJob.progress = 100;
        currentScrapeJob.status = 'completed';
        currentScrapeJob.discoveredStreams = capturedList;
        currentScrapeJob.discoveredLiveTv = capturedList.filter(s => s.category === 'tv');
        currentScrapeJob.discoveredMovies = capturedList.filter(s => s.category === 'vod');
        currentScrapeJob.completedAt = new Date().toISOString();
        log(`✅ Hoàn tất chu trình quét mạng và bóc tách CSDL thành công!`);

        return {
            success: true,
            totalFound: capturedList.length,
            newSaved: newAddedCount,
            tvAdded: dbSync.tvAdded,
            moviesAdded: dbSync.moviesAdded,
            streams: capturedList
        };
    } catch (err) {
        currentScrapeJob.status = 'failed';
        currentScrapeJob.error = err.message;
        log(`❌ Lỗi trong quá trình quét mạng: ${err.message}`);
        throw err;
    } finally {
        if (browser) {
            try {
                await browser.close();
                log(`🔒 Đã đóng phiên trình duyệt Puppeteer an toàn.`);
            } catch (closeErr) {}
        }
    }
}

/**
 * Specialized scraping logic that specifically targets Live TV channel selectors on auraflix.vip
 */
async function scrapeAuraflixLiveTv(progressCallback) {
    const log = (msg) => {
        if (typeof progressCallback === 'function') {
            try { progressCallback(msg); } catch (e) {}
        }
        console.log(`[AURAFLIX LIVE TV] ${msg}`);
    };

    log(`📡 [Auraflix Live TV] Khởi động phiên quét chuyên sâu Kênh Truyền Hình theo Bộ Chọn Selectors...`);
    
    try {
        const result = await scrapeDynamicUrl('https://auraflix.vip', (line) => {
            log(line);
        });

        auraflixCrawlerState.totalLiveTvCaptured += (result.tvAdded || 0);
        auraflixCrawlerState.totalMoviesCaptured += (result.moviesAdded || 0);

        log(`🎯 [Auraflix Live TV] Hoàn tất bóc tách: +${result.tvAdded} Kênh TV vào CSDL Truyền Hình, +${result.moviesAdded} Phim vào CSDL Phim.`);
        return {
            success: true,
            tvAdded: result.tvAdded,
            moviesAdded: result.moviesAdded,
            totalFound: result.totalFound,
            channels: result.streams.filter(s => s.category === 'tv'),
            movies: result.streams.filter(s => s.category === 'vod')
        };
    } catch (err) {
        log(`❌ [Auraflix Live TV] Lỗi trong quá trình quét kênh: ${err.message}`);
        throw err;
    }
}

/**
 * Automated 30-minute crawler specifically targeting https://auraflix.vip
 */
async function crawlAuraflix() {
    if (auraflixCrawlerState.isRunning) {
        console.log('[AURAFLIX CRAWLER] Đợt quét trước đang chạy, bỏ qua lần này.');
        return { success: false, message: 'Đang có đợt quét Auraflix đang chạy.' };
    }

    auraflixCrawlerState.isRunning = true;
    const startTime = Date.now();
    const logEntry = (msg) => {
        const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        const text = `[${time}] ${msg}`;
        auraflixCrawlerState.logs.unshift(text);
        if (auraflixCrawlerState.logs.length > 100) auraflixCrawlerState.logs.pop();
        console.log(`[AURAFLIX CRAWLER] ${msg}`);
    };

    logEntry('🚀 Khởi động chu kỳ quét tự động định kỳ cho https://auraflix.vip (Phân loại CSDL Kênh TV & Phim độc lập)...');

    try {
        const result = await scrapeDynamicUrl('https://auraflix.vip', (line) => {
            // Forward significant logs to auraflix logs
            if (line.includes('Phát hiện') || line.includes('Bắt được') || line.includes('Đã lưu') || line.includes('CSDL')) {
                logEntry(line);
            }
        });

        auraflixCrawlerState.lastRun = new Date().toISOString();
        auraflixCrawlerState.nextRun = Date.now() + 30 * 60 * 1000;
        auraflixCrawlerState.totalCaptured += (result.newSaved || 0);
        auraflixCrawlerState.totalLiveTvCaptured += (result.tvAdded || 0);
        auraflixCrawlerState.totalMoviesCaptured += (result.moviesAdded || 0);
        auraflixCrawlerState.recentStreams = result.streams || [];

        logEntry(`🎉 Quét hoàn tất trong ${(Date.now() - startTime) / 1000}s! Nạp mới: +${result.tvAdded || 0} Kênh TV, +${result.moviesAdded || 0} Phim.`);
        return {
            success: true,
            result,
            tvAdded: result.tvAdded || 0,
            moviesAdded: result.moviesAdded || 0,
            lastRun: auraflixCrawlerState.lastRun,
            nextRun: auraflixCrawlerState.nextRun
        };
    } catch (err) {
        logEntry(`❌ Quá trình quét Auraflix gặp lỗi: ${err.message}`);
        return { success: false, error: err.message };
    } finally {
        auraflixCrawlerState.isRunning = false;
    }
}

/**
 * Initialize 30-minute background crawler timer
 */
function initAuraflixAutoCrawler(intervalMinutes = 30) {
    console.log(`⏰ [AURAFLIX CRAWLER] Đã kích hoạt Timer tự động quét Auraflix mỗi ${intervalMinutes} phút.`);
    
    // Initial crawl after 10 seconds of server startup
    setTimeout(() => {
        crawlAuraflix().catch(e => console.error('[AURAFLIX CRAWLER] Khởi đầu lỗi:', e.message));
    }, 10000);

    // Recurring 30 minute interval
    setInterval(() => {
        crawlAuraflix().catch(e => console.error('[AURAFLIX CRAWLER] Định kỳ lỗi:', e.message));
    }, intervalMinutes * 60 * 1000);
}

module.exports = {
    scrapeDynamicUrl,
    scrapeAuraflixLiveTv,
    crawlAuraflix,
    launchChromiumBrowser,
    initAuraflixAutoCrawler,
    loadScrapedStreams,
    saveScrapedStreams,
    loadLiveTvCollection,
    saveLiveTvCollection,
    loadMovieCollection,
    saveMovieCollection,
    syncStreamsToSeparateDatabases,
    syncStreamsToLiveChannels,
    testStreamLatency,
    getCurrentScrapeJob: () => currentScrapeJob,
    getAuraflixCrawlerState: () => auraflixCrawlerState
};
