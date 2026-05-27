const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'server-data');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function readJSON(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) {
        console.error('读取失败:', filePath, e.message);
    }
    return null;
}

function writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sendJSON(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
}

function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
        res.end(content);
    } catch {
        sendJSON(res, 404, { ok: false, error: 'File not found' });
    }
}

function getBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    try {
        /* ---- API ---- */
        if (pathname === '/api/ping' && req.method === 'GET') {
            return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
        }

        if (pathname === '/api/users' && req.method === 'GET') {
            const data = readJSON(path.join(DATA_DIR, '__meta.json'));
            return sendJSON(res, 200, { ok: true, data: data || { allUsers: ['默认用户'], activeUser: '默认用户' } });
        }

        if (pathname === '/api/users' && req.method === 'PUT') {
            const body = await getBody(req);
            writeJSON(path.join(DATA_DIR, '__meta.json'), { allUsers: body.allUsers || [], activeUser: body.activeUser || '' });
            return sendJSON(res, 200, { ok: true });
        }

        const dataMatch = pathname.match(/^\/api\/data\/(.+)$/);
        if (dataMatch) {
            const username = decodeURIComponent(dataMatch[1]);

            if (req.method === 'GET') {
                const data = readJSON(path.join(DATA_DIR, username + '.json'));
                return sendJSON(res, 200, { ok: true, data: data || { sessions: [], posts: [], gallery: [] } });
            }

            if (req.method === 'PUT') {
                const body = await getBody(req);
                writeJSON(path.join(DATA_DIR, username + '.json'), {
                    sessions: body.sessions || [],
                    posts: body.posts || [],
                    gallery: body.gallery || []
                });
                return sendJSON(res, 200, { ok: true });
            }
        }

        if (pathname === '/api/status' && req.method === 'GET') {
            const interfaces = os.networkInterfaces();
            const addresses = [];
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        addresses.push(iface.address);
                    }
                }
            }
            return sendJSON(res, 200, { ok: true, port: PORT, addresses });
        }

        /* ---- Static files ---- */
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return sendFile(res, filePath);
        }

        sendJSON(res, 404, { ok: false, error: 'Not found' });

    } catch (e) {
        console.error('Server error:', e);
        sendJSON(res, 500, { ok: false, error: e.message });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    const interfaces = os.networkInterfaces();
    console.log('═══════════════════════════════════════');
    console.log('  学习记录追踪 - 同步服务器已启动');
    console.log('═══════════════════════════════════════');
    console.log(`  本机访问: http://localhost:${PORT}`);
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`  手机访问: http://${iface.address}:${PORT}`);
            }
        }
    }
    console.log('═══════════════════════════════════════');
    console.log('  按 Ctrl+C 停止服务器');
    console.log('═══════════════════════════════════════');
});