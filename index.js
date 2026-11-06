/**
 * Root entry point for Nuvio Addon server.
 * Ensures compatibility across Cloud Run, Google Cloud Buildpacks, Docker, and local Node.js.
 */
const app = require('./api/index');
const sources = require('./sources');
const scraper = require('./scraper');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

if (require.main === module) {
    app.listen(PORT, HOST, () => {
        console.log(`Nuvio Addon server running on http://${HOST}:${PORT}`);

        try {
            scraper.initAuraflixAutoCrawler(30);
        } catch (e) {
            console.error("Auraflix auto-crawler init error:", e.message);
        }

        try {
            const liveTvHealth = require('./live-tv-health');
            liveTvHealth.initLiveTvHealthScheduler(10);
        } catch (e) {
            console.error("Live TV Health scheduler init error:", e.message);
        }
    });
}

module.exports = app;
