/**
 * LIVE TV HEALTH-CHECK UTILITY & MPD STREAM MONITOR
 * - Periodically pings scraped Live TV .mpd URLs to verify active status
 * - Updates channel status ('active' | 'unstable' | 'offline'), latency, and timestamps in live_channels.json & scraped_streams.json
 * - Classifies channels into categories (Quốc Tế, VTV, VTVCab, Thể Thao, Thiếu Nhi, Giải Trí)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { atomicWriteJson, boundedParallel } = require('./common-utils');

const LIVE_CHANNELS_PATH = path.join(__dirname, 'live_channels.json');
const SCRAPED_STREAMS_PATH = path.join(__dirname, 'scraped_streams.json');

// In-memory health telemetry and state
const healthTelemetry = {
    isChecking: false,
    lastRun: null,
    nextRun: Date.now() + 10 * 60 * 1000,
    intervalMinutes: 10,
    totalChecked: 0,
    activeCount: 0,
    unstableCount: 0,
    offlineCount: 0,
    avgLatency: 0,
    logs: ['[INIT] Tiện ích giám sát & Health-Check luồng Live TV (.mpd) đã khởi tạo.'],
    recentChecked: []
};

// Pre-calculate initial telemetry from existing live_channels.json (Critical for Serverless/Vercel Cold Starts)
function computeInitialTelemetry() {
    try {
        let liveChannels = [];
        if (fs.existsSync(LIVE_CHANNELS_PATH)) {
            liveChannels = JSON.parse(fs.readFileSync(LIVE_CHANNELS_PATH, 'utf-8'));
        }
        const mpdCandidates = liveChannels.filter(c => {
            const url = (c.streamUrl || '').toLowerCase();
            return url.includes('.mpd') || c.streamType === 'dash' || c.isClearkeyFlag;
        });

        let activeCount = 0;
        let unstableCount = 0;
        let offlineCount = 0;
        let totalLatency = 0;
        let testedSuccessCount = 0;
        let latestTime = null;

        mpdCandidates.forEach(c => {
            if (c.status === 'active') {
                activeCount++;
                totalLatency += (c.latency || 150);
                testedSuccessCount++;
            } else if (c.status === 'unstable') {
                unstableCount++;
                totalLatency += (c.latency || 600);
                testedSuccessCount++;
            } else if (c.status === 'offline') {
                offlineCount++;
            } else if (c.latency && c.latency < 1200) {
                activeCount++;
                totalLatency += c.latency;
                testedSuccessCount++;
            }
            if (c.lastCheckedAt) {
                const t = new Date(c.lastCheckedAt).getTime();
                if (!latestTime || t > latestTime) latestTime = t;
            }
        });

        if (activeCount > 0 || offlineCount > 0) {
            healthTelemetry.totalChecked = mpdCandidates.length;
            healthTelemetry.activeCount = activeCount;
            healthTelemetry.unstableCount = unstableCount;
            healthTelemetry.offlineCount = offlineCount;
            healthTelemetry.avgLatency = testedSuccessCount > 0 ? Math.round(totalLatency / testedSuccessCount) : 480;
            healthTelemetry.lastRun = latestTime || Date.now();
        }
    } catch (e) {
        console.error('[LIVE TV HEALTH] Initial telemetry parse error:', e.message);
    }
}
computeInitialTelemetry();

const NON_ESSENTIAL_INTL_KEYWORDS = [
    'foxsports', 'fox sport', 'fox_sport', 'fox news', 'fox movies', 'fox family', 'fox life',
    'animal planet', 'animalplanet', 'fashiontv', 'fashion tv', 'tlc', 'boomerang', 'cartoonito',
    'dmax', 'dreamworks', 'hgtv', 'bbc', 'cnn', 'bloomberg', 'france 24', 'france24', 'dw',
    'nhk', 'mbc', 'ebs', 'tvb', 'al jazeera', 'aljazeera', 'capital', 'cs tv', 'g1',
    'national geographic', 'nat geo', 'natgeo', 'paramount', 'kbs', 'tvn', 'animax',
    'disney', 'cbeebies', 'filmbox', 'nickelodeon', 'baby tv', 'babytv'
];

function isAllowedInternational(ch) {
    const name = (ch.name || '').toLowerCase();
    const url = (ch.streamUrl || '').toLowerCase();
    if (NON_ESSENTIAL_INTL_KEYWORDS.some(kw => name.includes(kw))) return false;
    if (name.includes('hbo') || url.includes('/hbo.')) return true;
    if (name.includes('warner') || name.includes('wbtv') || url.includes('/wtv.')) return true;
    if (name.includes('cinemax') || url.includes('/max.')) return true;
    if (name.includes('axn') || url.includes('/axn.')) return true;
    if (name.includes('cartoon network') || name === 'cartoon' || name === 'cn' || name.includes('cn hd') || url.includes('/cn.')) return true;
    if (name.includes('cinemaworld') || name.includes('cinema world') || url.includes('/cinemaworld.')) return true;
    if (name.includes('discovery asia') || name.includes('discoveryasia') || name.includes('dscasia') || url.includes('/dscasia.')) return true;
    return false;
}

function isNonEssentialInternational(ch) {
    if (isAllowedInternational(ch)) return false;
    const name = (ch.name || '').toLowerCase();
    const url = (ch.streamUrl || '').toLowerCase();
    if (NON_ESSENTIAL_INTL_KEYWORDS.some(kw => name.includes(kw))) return true;
    if (url.includes('/ap.') || url.includes('/ftv.') || url.includes('/tlc.') || url.includes('/boomerang.') || url.includes('/dmax.')) return true;
    if (name.includes('discovery') && !name.includes('discovery asia') && !name.includes('discoveryasia')) return true;
    return false;
}

/**
 * Categorize a TV channel into clear, human-friendly categories
 */
function categorizeChannel(ch) {
    const name = (ch.name || '').toLowerCase();
    const genre = (ch.genre || '').toLowerCase();

    if (isAllowedInternational(ch)) {
        return { id: 'quoc_te', name: '🌐 Kênh Quốc Tế', sortIndex: 10 };
    }

    if ((name.includes('vtv') && !name.includes('vtvcab') && !name.includes('vtv cab') && !name.includes('prime')) || 
        genre.includes('vtv')) {
        return { id: 'vtv', name: '🔴 Kênh VTV', sortIndex: 20 };
    }

    if (name.includes('kids') || name.includes('thiếu nhi') || name.includes('bibi') || genre.includes('thiếu nhi')) {
        return { id: 'thieu_nhi', name: '👶 Kênh Thiếu Nhi', sortIndex: 30 };
    }

    if (name.includes('sport') || name.includes('thể thao') || name.includes('k+') || 
        name.includes('tnt') || name.includes('spotv') || name.includes('dazn') || 
        name.includes('bein') || name.includes('bong da') || name.includes('bóng đá') ||
        genre.includes('thể thao')) {
        return { id: 'the_thao', name: '⚽ Kênh Thể Thao', sortIndex: 25 };
    }

    if (name.includes('vtvcab') || name.includes('vtv cab') || name.includes('vtvprime') || 
        name.includes('on sports') || name.includes('on cine') || name.includes('on football') || 
        genre.includes('vtvcab')) {
        return { id: 'vtvcab', name: '📺 Kênh VTVCab / Prime', sortIndex: 22 };
    }

    if (name.includes('htv') || name.includes('thvl') || name.includes('vtc') || 
        name.includes('sctv') || name.includes('todaytv') || genre.includes('giải trí')) {
        return { id: 'giai_tri', name: '🎭 Kênh Giải Trí', sortIndex: 40 };
    }

    return { id: 'khac', name: '📡 Kênh Khác / Tổng Hợp', sortIndex: 50 };
}

/**
 * Ping an individual MPD / streaming URL to verify reachability and latency
 */
async function pingMpdUrl(streamUrl) {
    if (!streamUrl || !streamUrl.startsWith('http')) {
        return { reachable: false, latency: 9999, status: 0, error: 'URL không hợp lệ' };
    }

    const start = Date.now();
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Range': 'bytes=0-2048'
        };

        if (streamUrl.includes('mytvnet.vn') || streamUrl.includes('mytvn.net') || streamUrl.includes('auraflix')) {
            headers['Referer'] = 'https://auraflix.vip/';
            headers['Origin'] = 'https://auraflix.vip';
        }

        const res = await axios.get(streamUrl, {
            headers,
            timeout: 2500,
            validateStatus: (s) => s < 400 || s === 403 || s === 206
        });

        const latency = Date.now() - start;
        const reachable = res.status < 400 || res.status === 206;

        let healthStatus = 'offline';
        if (reachable) {
            healthStatus = latency < 1200 ? 'active' : 'unstable';
        }

        return {
            reachable,
            healthStatus,
            latency,
            status: res.status
        };
    } catch (err) {
        return {
            reachable: false,
            healthStatus: 'offline',
            latency: Date.now() - start,
            status: 0,
            error: err.message
        };
    }
}

/**
 * Run periodic or manual health check across all scraped Live TV .mpd channels
 */
async function runLiveTvHealthCheck(options = {}) {
    if (healthTelemetry.isChecking) {
        console.log('[LIVE TV HEALTH] Đang có một chu kỳ kiểm tra đang chạy.');
        return { success: false, message: 'Health check đang chạy.' };
    }

    healthTelemetry.isChecking = true;
    const startTime = Date.now();
    const logEntry = (msg) => {
        const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        const text = `[${timestamp}] ${msg}`;
        healthTelemetry.logs.unshift(text);
        if (healthTelemetry.logs.length > 80) healthTelemetry.logs.pop();
        console.log(`[LIVE TV HEALTH] ${msg}`);
    };

    logEntry('🚀 Bắt đầu chu kỳ Health-Check kiểm tra trạng thái các luồng Live TV (.mpd)...');

    try {
        let liveChannels = [];
        if (fs.existsSync(LIVE_CHANNELS_PATH)) {
            try {
                liveChannels = JSON.parse(fs.readFileSync(LIVE_CHANNELS_PATH, 'utf-8'));
            } catch (e) {
                liveChannels = [];
            }
        }

        // Target all channels with .mpd or streamType === 'dash' or Live TV
        const mpdCandidates = liveChannels.filter(c => {
            const url = (c.streamUrl || '').toLowerCase();
            return url.includes('.mpd') || c.streamType === 'dash' || c.isClearkeyFlag;
        });

        logEntry(`🔍 Phát hiện ${mpdCandidates.length} kênh truyền hình .mpd cần kiểm tra kết nối...`);

        let activeCount = 0;
        let unstableCount = 0;
        let offlineCount = 0;
        let totalLatency = 0;
        let testedSuccessCount = 0;
        const checkResults = [];

        // High-speed pipelined bounded concurrency (concurrency: 16)
        await boundedParallel(mpdCandidates, async (ch) => {
            const res = await pingMpdUrl(ch.streamUrl);
            
            // Update channel entry in memory
            ch.status = res.healthStatus;
            ch.latency = res.latency;
            ch.statusCode = res.status;
            ch.lastCheckedAt = new Date().toISOString();
            ch.isReachable = res.reachable;

            const cat = categorizeChannel(ch);
            ch.categoryGroup = cat.id;
            ch.categoryGroupName = cat.name;

            if (res.healthStatus === 'active') {
                activeCount++;
                totalLatency += res.latency;
                testedSuccessCount++;
            } else if (res.healthStatus === 'unstable') {
                unstableCount++;
                totalLatency += res.latency;
                testedSuccessCount++;
            } else {
                offlineCount++;
            }

            checkResults.push({
                id: ch.id,
                name: ch.name,
                status: res.healthStatus,
                latency: res.latency,
                streamUrl: ch.streamUrl,
                isClearkeyFlag: !!ch.isClearkeyFlag,
                kidHex: ch.kidHex,
                keyHex: ch.keyHex,
                category: cat.id
            });
        }, 16);

        // Sync updated status to live_channels.json atomically
        if (liveChannels.length > 0) {
            const saved = atomicWriteJson(LIVE_CHANNELS_PATH, liveChannels);
            if (saved) {
                logEntry(`💾 Đã cập nhật trạng thái mới nhất cho ${mpdCandidates.length} kênh vào live_channels.json (Atomic Save)!`);
            } else {
                console.error('[LIVE TV HEALTH] Lỗi lưu live_channels.json');
            }
        }

        // Also update scraped_streams.json if any matching URLs exist
        if (fs.existsSync(SCRAPED_STREAMS_PATH)) {
            try {
                let scrapedList = JSON.parse(fs.readFileSync(SCRAPED_STREAMS_PATH, 'utf-8'));
                if (Array.isArray(scrapedList)) {
                    let updatedScraped = 0;
                    scrapedList.forEach(s => {
                        const match = checkResults.find(r => (r.streamUrl || '').toLowerCase() === (s.streamUrl || '').toLowerCase());
                        if (match) {
                            s.status = match.status;
                            s.latency = match.latency;
                            s.lastCheckedAt = new Date().toISOString();
                            updatedScraped++;
                        }
                    });
                    if (updatedScraped > 0) {
                        atomicWriteJson(SCRAPED_STREAMS_PATH, scrapedList);
                    }
                }
            } catch (e) {}
        }

        const duration = (Date.now() - startTime) / 1000;
        const avgLat = testedSuccessCount > 0 ? Math.round(totalLatency / testedSuccessCount) : 0;

        healthTelemetry.lastRun = new Date().toISOString();
        healthTelemetry.nextRun = Date.now() + (healthTelemetry.intervalMinutes * 60 * 1000);
        healthTelemetry.totalChecked = mpdCandidates.length;
        healthTelemetry.activeCount = activeCount;
        healthTelemetry.unstableCount = unstableCount;
        healthTelemetry.offlineCount = offlineCount;
        healthTelemetry.avgLatency = avgLat;
        healthTelemetry.recentChecked = checkResults;

        logEntry(`🎉 Hoàn tất Health-Check trong ${duration}s! 🟢 Hoạt Động: ${activeCount} | 🟡 Chậm: ${unstableCount} | 🔴 Mất Kết Nối: ${offlineCount} (Độ trễ TB: ${avgLat}ms)`);

        return {
            success: true,
            totalChecked: mpdCandidates.length,
            activeCount,
            unstableCount,
            offlineCount,
            avgLatency: avgLat,
            duration,
            lastRun: healthTelemetry.lastRun,
            nextRun: healthTelemetry.nextRun,
            channels: checkResults
        };
    } catch (err) {
        logEntry(`❌ Lỗi trong quá trình Health-Check: ${err.message}`);
        return { success: false, error: err.message };
    } finally {
        healthTelemetry.isChecking = false;
    }
}

/**
 * Initialize background periodic health-check scheduler
 */
function initLiveTvHealthScheduler(intervalMinutes = 10) {
    healthTelemetry.intervalMinutes = intervalMinutes;
    console.log(`⏰ [LIVE TV HEALTH] Đã kích hoạt Timer Health-Check luồng Live TV (.mpd) mỗi ${intervalMinutes} phút.`);

    // Run first health check 15 seconds after server boot
    setTimeout(() => {
        runLiveTvHealthCheck().catch(e => console.error('[LIVE TV HEALTH] Khởi đầu lỗi:', e.message));
    }, 15000);

    // Recurring interval
    setInterval(() => {
        runLiveTvHealthCheck().catch(e => console.error('[LIVE TV HEALTH] Định kỳ lỗi:', e.message));
    }, intervalMinutes * 60 * 1000);
}

/**
 * Return formatted channels grouped by categories with active status for the UI
 */
function getFormattedLiveChannels(statusFilter = 'all', categoryFilter = 'all') {
    let channels = [];
    if (fs.existsSync(LIVE_CHANNELS_PATH)) {
        try {
            channels = JSON.parse(fs.readFileSync(LIVE_CHANNELS_PATH, 'utf-8'));
        } catch (e) {
            channels = [];
        }
    }

    // Filter out non-essential international streams and map relevant TV channels
    let processed = channels.filter(ch => !isNonEssentialInternational(ch)).map(ch => {
        const cat = categorizeChannel(ch);
        const isMpd = (ch.streamUrl || '').toLowerCase().includes('.mpd') || ch.streamType === 'dash';
        const status = ch.status || (ch.latency && ch.latency < 1200 ? 'active' : 'unverified');
        return {
            id: ch.id,
            name: ch.name || 'Kênh Truyền Hình',
            poster: ch.poster || 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=300&auto=format&fit=crop',
            genre: ch.genre || cat.name,
            streamUrl: ch.streamUrl,
            streamType: isMpd ? 'dash' : (ch.streamType || 'hls'),
            latency: ch.latency || 120,
            status: status,
            isClearkeyFlag: !!ch.isClearkeyFlag,
            kidHex: ch.kidHex,
            keyHex: ch.keyHex,
            lastCheckedAt: ch.lastCheckedAt || ch.discoveredAt,
            category: cat.id,
            categoryName: cat.name,
            sortIndex: cat.sortIndex
        };
    });

    let sFilter = 'all';
    if (typeof statusFilter === 'boolean') {
        sFilter = statusFilter ? 'working' : 'all';
    } else if (typeof statusFilter === 'string') {
        sFilter = statusFilter.toLowerCase();
    }

    if (sFilter === 'working' || sFilter === 'working_only' || sFilter === 'active_only') {
        processed = processed.filter(c => c.status === 'active' || c.status === 'unstable' || (c.isReachable === true && c.status !== 'offline'));
    } else if (sFilter === 'requires_update' || sFilter === 'offline' || sFilter === 'unverified') {
        processed = processed.filter(c => c.status === 'offline' || c.status === 'unverified' || c.status === 'requires_update' || c.isReachable === false || (!c.status && (!c.latency || c.latency >= 1200)));
    }

    if (categoryFilter && categoryFilter !== 'all') {
        processed = processed.filter(c => c.category === categoryFilter);
    }

    // Sort by Category sortIndex, then Active status, then Latency
    processed.sort((a, b) => {
        if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        return (a.latency || 9999) - (b.latency || 9999);
    });

    return {
        total: processed.length,
        activeCount: processed.filter(c => c.status === 'active').length,
        channels: processed,
        telemetry: healthTelemetry
    };
}

module.exports = {
    runLiveTvHealthCheck,
    initLiveTvHealthScheduler,
    pingMpdUrl,
    getFormattedLiveChannels,
    categorizeChannel,
    getHealthTelemetry: () => healthTelemetry
};
