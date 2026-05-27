const Store = {
    get(key, def) {
        try {
            const data = localStorage.getItem('learn_' + key);
            return data ? JSON.parse(data) : def;
        } catch { return def; }
    },
    set(key, val) {
        localStorage.setItem('learn_' + key, JSON.stringify(val));
    }
};

/* ========== Sync Service (GitHub Gist) ========== */
const SyncService = {
    token: localStorage.getItem('learn_gh_token') || '',
    gistId: localStorage.getItem('learn_gh_gist') || '',
    connected: false,
    lastSyncTime: null,
    syncInProgress: false,
    GIST_FILENAME: 'learning-tracker-data.json',

    get _headers() {
        return {
            'Authorization': 'token ' + this.token,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };
    },

    setToken(val) {
        this.token = val;
        localStorage.setItem('learn_gh_token', val);
    },

    async _api(method, path, body) {
        const res = await fetch('https://api.github.com' + path, {
            method,
            headers: this._headers,
            body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || 'GitHub API 请求失败 (' + res.status + ')');
        }
        return res.json();
    },

    async findExistingGist() {
        try {
            const gists = await this._api('GET', '/gists?per_page=100');
            for (const gist of gists) {
                if (gist.files && gist.files[this.GIST_FILENAME]) {
                    return gist.id;
                }
            }
        } catch {}
        return null;
    },

    async validateToken() {
        if (!this.token) return false;
        try {
            const user = await this._api('GET', '/user');
            return !!user.login;
        } catch {
            return false;
        }
    },

    _buildData() {
        const data = {
            allUsers: state.allUsers,
            activeUser: state.activeUser,
            users: {}
        };
        for (const username of state.allUsers) {
            data.users[username] = {
                sessions: Store.get('sessions_' + username, []),
                posts: Store.get('posts_' + username, []),
                gallery: Store.get('gallery_' + username, [])
            };
        }
        return data;
    },

    _writeToGist(content) {
        const files = {};
        files[this.GIST_FILENAME] = { content };
        if (this.gistId) {
            return this._api('PATCH', '/gists/' + this.gistId, { files });
        } else {
            return this._api('POST', '/gists', {
                description: '学习记录追踪 - 同步数据',
                public: false,
                files
            });
        }
    },

    async pushToGist() {
        const data = this._buildData();
        const content = JSON.stringify(data, null, 2);
        const result = await this._writeToGist(content);
        if (!this.gistId) {
            this.gistId = result.id;
            localStorage.setItem('learn_gh_gist', this.gistId);
        }
        return true;
    },

    async pullFromGist() {
        if (!this.gistId) return null;
        const gist = await this._api('GET', '/gists/' + this.gistId);
        const file = gist.files[this.GIST_FILENAME];
        if (!file || !file.content) return null;
        return JSON.parse(file.content);
    },

    async syncAll() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;
        updateSyncUI('syncing');

        try {
            const valid = await this.validateToken();
            if (!valid) throw new Error('Token 无效或已过期');

            if (!this.gistId) {
                const found = await this.findExistingGist();
                if (found) {
                    this.gistId = found;
                    localStorage.setItem('learn_gh_gist', this.gistId);
                }
            }

            const serverData = this.gistId ? await this.pullFromGist() : null;

            let mergedAllUsers = state.allUsers.slice();
            let mergedActiveUser = state.activeUser;

            if (serverData) {
                mergedAllUsers = [...new Set([...state.allUsers, ...(serverData.allUsers || [])])].sort();
                if (serverData.activeUser && serverData.activeUser !== mergedActiveUser) {
                    mergedActiveUser = serverData.activeUser;
                }
            }

            state.allUsers = mergedAllUsers;
            state.activeUser = mergedActiveUser;
            Store.set('allUsers', mergedAllUsers);
            Store.set('activeUser', mergedActiveUser);

            for (const username of mergedAllUsers) {
                const local = {
                    sessions: Store.get('sessions_' + username, []),
                    posts: Store.get('posts_' + username, []),
                    gallery: Store.get('gallery_' + username, [])
                };
                let server = null;
                if (serverData && serverData.users && serverData.users[username]) {
                    server = serverData.users[username];
                }

                const merged = {
                    sessions: mergeArrays(local.sessions, server ? server.sessions : []),
                    posts: mergeArrays(local.posts, server ? server.posts : []),
                    gallery: mergeGallery(local.gallery, server ? server.gallery : [])
                };

                Store.set('sessions_' + username, merged.sessions);
                Store.set('posts_' + username, merged.posts);
                Store.set('gallery_' + username, merged.gallery);
            }

            await this.pushToGist();
            loadCurrentUserData();

            this.lastSyncTime = new Date();
            this.connected = true;
            updateSyncUI('connected');
            renderUserSelect();
            renderAll();
            toast('同步成功！数据已保存到 GitHub Gist', 'success');
        } catch (e) {
            this.connected = false;
            updateSyncUI('error');
            toast('同步失败：' + e.message, 'error');
        } finally {
            this.syncInProgress = false;
        }
    },

    async pushOnly() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;
        updateSyncUI('syncing');

        try {
            const valid = await this.validateToken();
            if (!valid) throw new Error('Token 无效或已过期');

            if (!this.gistId) {
                const found = await this.findExistingGist();
                if (found) {
                    this.gistId = found;
                    localStorage.setItem('learn_gh_gist', this.gistId);
                }
            }

            await this.pushToGist();
            this.lastSyncTime = new Date();
            this.connected = true;
            updateSyncUI('connected');
            toast('本机数据已上传到云端 ✅', 'success');
        } catch (e) {
            this.connected = false;
            updateSyncUI('error');
            toast('上传失败：' + e.message, 'error');
        } finally {
            this.syncInProgress = false;
        }
    },

    async pullOnly() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;
        updateSyncUI('syncing');

        try {
            const valid = await this.validateToken();
            if (!valid) throw new Error('Token 无效或已过期');

            if (!this.gistId) {
                const found = await this.findExistingGist();
                if (found) {
                    this.gistId = found;
                    localStorage.setItem('learn_gh_gist', this.gistId);
                }
            }

            if (!this.gistId) throw new Error('云端暂无数据，请先在任一设备上传');

            const serverData = await this.pullFromGist();
            if (!serverData) throw new Error('云端暂无数据');

            state.allUsers = serverData.allUsers || ['默认用户'];
            state.activeUser = serverData.activeUser || '默认用户';
            Store.set('allUsers', state.allUsers);
            Store.set('activeUser', state.activeUser);

            for (const username of state.allUsers) {
                const userData = serverData.users && serverData.users[username];
                if (userData) {
                    Store.set('sessions_' + username, userData.sessions || []);
                    Store.set('posts_' + username, userData.posts || []);
                    Store.set('gallery_' + username, userData.gallery || []);
                }
            }

            loadCurrentUserData();
            renderUserSelect();
            renderAll();

            this.lastSyncTime = new Date();
            this.connected = true;
            updateSyncUI('connected');
            toast('云端数据已下载到本机 ✅', 'success');
        } catch (e) {
            this.connected = false;
            updateSyncUI('error');
            toast('下载失败：' + e.message, 'error');
        } finally {
            this.syncInProgress = false;
        }
    },

    async disconnect() {
        this.connected = false;
        this.token = '';
        this.gistId = '';
        localStorage.removeItem('learn_gh_token');
        localStorage.removeItem('learn_gh_gist');
        updateSyncUI('disconnected');
    }
};

function mergeArrays(local, server) {
    const map = new Map();
    for (const item of [...server, ...local]) {
        map.set(item.id, item);
    }
    return Array.from(map.values()).sort((a, b) => {
        const dateA = a.createdAt || a.date || '';
        const dateB = b.createdAt || b.date || '';
        return dateB.localeCompare(dateA);
    });
}

function mergeGallery(local, server) {
    const map = new Map();
    for (const item of [...server, ...local]) {
        map.set(item.id, item);
    }
    return Array.from(map.values());
}

let _syncTimer = null;
function maybeSync() {
    if (!SyncService.connected || SyncService.syncInProgress) return;
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(function() {
        SyncService.syncAll();
        _syncTimer = null;
    }, 2000);
}

function updateSyncUI(status) {
    const statusEl = document.getElementById('syncStatus');
    const bodyEl = document.getElementById('syncBody');
    const connectBtn = document.getElementById('syncConnectBtn');
    const syncNowBtn = document.getElementById('syncNowBtn');
    const infoEl = document.getElementById('syncInfo');
    const timeEl = document.getElementById('syncLastTime');
    const gistEl = document.getElementById('syncGistId');
    const modeGroup = document.getElementById('syncModeGroup');

    if (!statusEl) return;

    switch (status) {
        case 'connected':
            statusEl.textContent = '已连接';
            statusEl.className = 'sync-status connected';
            bodyEl.style.display = 'block';
            connectBtn.textContent = '断开';
            syncNowBtn.style.display = 'inline-block';
            infoEl.style.display = 'block';
            if (modeGroup) modeGroup.style.display = 'flex';
            if (SyncService.lastSyncTime) {
                timeEl.textContent = '上次同步: ' + formatDateTime(SyncService.lastSyncTime);
            }
            if (SyncService.gistId) {
                gistEl.innerHTML = '<a href="https://gist.github.com/' + SyncService.gistId + '" target="_blank">查看 Gist →</a>';
            }
            break;
        case 'syncing':
            statusEl.textContent = '同步中...';
            statusEl.className = 'sync-status syncing';
            break;
        case 'error':
            statusEl.textContent = '连接失败';
            statusEl.className = 'sync-status error';
            break;
        default:
            statusEl.textContent = '未连接';
            statusEl.className = 'sync-status';
            bodyEl.style.display = 'none';
            connectBtn.textContent = '连接 GitHub';
            syncNowBtn.style.display = 'none';
            infoEl.style.display = 'none';
            if (modeGroup) modeGroup.style.display = 'none';
    }
}

function loadUserData(username) {
    state.sessions = Store.get('sessions_' + username, []);
    state.posts = Store.get('posts_' + username, []);
    state.gallery = Store.get('gallery_' + username, []);
}

function saveUserData(username) {
    Store.set('sessions_' + username, state.sessions);
    Store.set('posts_' + username, state.posts);
    Store.set('gallery_' + username, state.gallery);
}

function saveCurrentUserData() {
    saveUserData(state.activeUser);
}

function loadCurrentUserData() {
    loadUserData(state.activeUser);
}

let state = {
    allUsers: Store.get('allUsers', ['默认用户']),
    activeUser: Store.get('activeUser', '默认用户'),
    sessions: [],
    posts: [],
    gallery: [],
    currentPage: 'dashboard',
    currentPostId: null,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    isTransitioning: false,
    pomodoro: {
        totalSeconds: 1500,
        remainingSeconds: 1500,
        isRunning: false,
        isPaused: false,
        interval: null,
        subject: ''
    }
};

loadCurrentUserData();

function saveSessions() {
    Store.set('sessions_' + state.activeUser, state.sessions);
    maybeSync();
}

function savePosts() {
    Store.set('posts_' + state.activeUser, state.posts);
    maybeSync();
}

function saveGallery() {
    Store.set('gallery_' + state.activeUser, state.gallery);
    maybeSync();
}

function getAllUserData(username) {
    return {
        sessions: Store.get('sessions_' + username, []),
        posts: Store.get('posts_' + username, [])
    };
}

/* ========== User Management ========== */
function renderUserSelect() {
    const mainSelect = document.getElementById('userSelect');
    mainSelect.innerHTML = state.allUsers.map(u =>
        '<option value="' + u + '"' + (u === state.activeUser ? ' selected' : '') + '>' + u + '</option>'
    ).join('');

    renderUserChecks();
}

function renderUserChecks() {
    const container = document.getElementById('statsUserChecks');
    if (!container) return;

    container.innerHTML = state.allUsers.map(function(u) {
        return '<label class="user-compare-check">' +
            '<input type="checkbox" value="' + u + '">' +
            u +
        '</label>';
    }).join('');

    container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
        cb.addEventListener('change', function() {
            this.closest('.user-compare-check').classList.toggle('active', this.checked);
            renderUserComparison();
            renderCalendar();
        });
    });
}

function renderAll() {
    renderDashboard();
    renderTimeline();
    renderBlogList();
    renderGallery();
    renderStats();
}

function switchUser(username) {
    if (username === state.activeUser) return;
    if (state.pomodoro.isRunning) {
        toast('番茄钟正在运行，请先停止', 'error');
        return;
    }

    saveCurrentUserData();
    state.activeUser = username;
    Store.set('activeUser', username);
    loadCurrentUserData();
    renderUserSelect();
    renderAll();
    toast('已切换到用户：' + username);
}

function addUser() {
    const name = prompt('请输入新用户名：');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (state.allUsers.includes(trimmed)) {
        toast('该用户已存在', 'error');
        return;
    }
    state.allUsers.push(trimmed);
    state.allUsers.sort();
    Store.set('allUsers', state.allUsers);
    switchUser(trimmed);
}

function deleteUser() {
    if (state.allUsers.length <= 1) {
        toast('至少保留一个用户', 'error');
        return;
    }

    const code = Math.floor(1000 + Math.random() * 9000);
    const answer = prompt('⚠️ 删除用户"' + state.activeUser + '"将清空所有数据！\n请输入验证码 [' + code + '] 确认删除：');
    if (!answer) return;
    if (parseInt(answer) !== code) {
        toast('验证码错误，删除已取消', 'error');
        return;
    }

    const username = state.activeUser;
    state.allUsers = state.allUsers.filter(u => u !== username);
    Store.set('allUsers', state.allUsers);
    localStorage.removeItem('learn_sessions_' + username);
    localStorage.removeItem('learn_posts_' + username);
    localStorage.removeItem('learn_gallery_' + username);

    const nextUser = state.allUsers[0];
    state.activeUser = nextUser;
    Store.set('activeUser', nextUser);
    loadCurrentUserData();
    renderUserSelect();
    renderAll();
    toast('用户"' + username + '"已删除');
}

function renderAll() {
    renderDashboard();
    renderTimeline();
    renderBlogList();
    renderGallery();
    renderStats();
}

function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || '') + ' show';
    setTimeout(() => el.classList.remove('show'), 2500);
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '年' + m + '月' + day + '日';
}

function formatDateShort(dateStr) {
    const d = new Date(dateStr);
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
}

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderMarkdown(text) {
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
        .replace(/<\/ul>\s*<ul>/g, '')
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/\[(.+?)\]\((.+?)\)/g, function(match, alt, url) {
            if (url.startsWith('http') || url.startsWith('data:')) {
                return '<a href="' + url + '" target="_blank">' + alt + '</a>';
            }
            return match;
        })
        .replace(/\n/g, '<br>')
        .replace(/<br><br>/g, '</p><p>')
        .replace(/<li>/g, '<br><li>');

    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<br><\/ul>/g, '</ul>');
    html = html.replace(/<ul><br>/g, '<ul>');

    html = html.replace(/!\[(.+?)\]\((.+?)\)/g, function(match, alt, id) {
        const img = state.gallery.find(g => g.id === parseFloat(id));
        if (img) {
            return '<img src="' + img.data + '" alt="' + alt + '" style="max-width:100%">';
        }
        return match;
    });

    return html;
}

/* ========== Navigation ========== */
function navigate(page, data) {
    if (state.isTransitioning || state.currentPage === page) return;
    state.isTransitioning = true;

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (navItem) navItem.classList.add('active');

    const current = document.getElementById('page-' + state.currentPage);
    const target = document.getElementById('page-' + page);

    if (current) {
        current.classList.remove('active');
        current.classList.add('leaving');
    }

    setTimeout(() => {
        if (current) {
            current.classList.remove('leaving');
            current.style.display = 'none';
        }

        if (target) {
            target.style.display = 'block';
            target.classList.add('active');
        }

        state.currentPage = page;
        state.isTransitioning = false;

        if (page === 'dashboard') renderDashboard();
        else if (page === 'timeline') renderTimeline();
        else if (page === 'blog') { renderBlogList(); renderGallery(); }
        else if (page === 'stats') renderStats();
    }, 250);
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
        e.preventDefault();
        navigate(this.dataset.page);
    });
});

document.getElementById('blogBackBtn').addEventListener('click', function() {
    const detail = document.getElementById('page-blog-detail');
    const blog = document.getElementById('page-blog');

    detail.classList.remove('active');
    detail.classList.add('leaving');

    setTimeout(() => {
        detail.classList.remove('leaving');
        detail.style.display = 'none';
        blog.style.display = 'block';
        blog.classList.add('active');
        renderBlogList();
        renderGallery();
    }, 250);
});

/* ========== Timeline ========== */
document.getElementById('timelineForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const date = document.getElementById('tlDate').value;
    const subject = document.getElementById('tlSubject').value.trim();
    const hours = parseFloat(document.getElementById('tlHours').value) || 0;
    const minutes = parseFloat(document.getElementById('tlMinutes').value) || 0;
    const duration = parseFloat((hours + minutes / 60).toFixed(2));
    const content = document.getElementById('tlContent').value.trim();

    if (!subject) {
        toast('请输入学习内容', 'error');
        return;
    }

    if (duration <= 0) {
        toast('请输入学习时长', 'error');
        return;
    }

    const session = {
        id: Date.now(),
        date,
        subject,
        duration,
        content,
        createdAt: new Date().toISOString()
    };

    state.sessions.unshift(session);
    saveSessions();
    renderTimeline();
    renderDashboard();
    this.reset();
    document.getElementById('tlDate').value = todayStr();
    document.getElementById('tlHours').value = '0';
    document.getElementById('tlMinutes').value = '0';
    toast('学习记录已添加！', 'success');
});

document.getElementById('tlFilterSubject').addEventListener('input', renderTimeline);
document.getElementById('tlSearch').addEventListener('input', renderTimeline);

function renderTimeline() {
    const container = document.getElementById('timelineList');
    const filter = document.getElementById('tlFilterSubject').value.trim().toLowerCase();
    const search = document.getElementById('tlSearch').value.trim().toLowerCase();

    let list = state.sessions;
    if (filter) list = list.filter(s => s.subject.toLowerCase().includes(filter));
    if (search) list = list.filter(s => s.content.toLowerCase().includes(search) || s.subject.toLowerCase().includes(search));

    if (list.length === 0) {
        container.innerHTML = '<p class="empty-msg">没有找到学习记录</p>';
        return;
    }

    container.innerHTML = list.map(s => `
        <div class="timeline-item">
            <div class="timeline-item-header">
                <span class="timeline-date">📅 ${formatDate(s.date)}</span>
                <span class="timeline-subject">${s.subject}</span>
                <span class="timeline-duration">⏱ ${s.duration} 小时</span>
            </div>
            <div class="timeline-content">${s.content}</div>
            <div class="timeline-footer">
                <button class="timeline-delete" data-id="${s.id}">✕ 删除此记录</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.timeline-delete').forEach(btn => {
        btn.addEventListener('click', function() {
            if (confirm('确定删除这条学习记录吗？')) {
                const id = parseInt(this.dataset.id);
                state.sessions = state.sessions.filter(s => s.id !== id);
                saveSessions();
                renderTimeline();
                renderDashboard();
                toast('记录已删除');
            }
        });
    });
}

/* ========== Blog ========== */
document.getElementById('blogForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const title = document.getElementById('blogTitle').value.trim();
    const tagsStr = document.getElementById('blogTags').value.trim();
    const content = document.getElementById('blogContent').value.trim();

    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];

    const post = {
        id: Date.now(),
        title,
        tags,
        content,
        createdAt: new Date().toISOString(),
        date: todayStr()
    };

    state.posts.unshift(post);
    savePosts();
    renderBlogList();
    renderDashboard();
    this.reset();
    toast('文章发布成功！', 'success');
});

document.getElementById('blogSearch').addEventListener('input', renderBlogList);

/* ========== Blog Image Insert ========== */
document.getElementById('blogImageBtn').addEventListener('click', function() {
    if (state.gallery.length === 0) {
        toast('图库中没有图片，请先上传', 'error');
        return;
    }
    const textarea = document.getElementById('blogContent');
    const cursorPos = textarea.selectionStart;
    let menuHtml = '<div class="gallery-insert-modal"><div class="gallery-insert-header">选择要插入的图片</div><div class="gallery-insert-grid">';
    state.gallery.forEach(img => {
        menuHtml += `<div class="gallery-insert-item" data-id="${img.id}">
            <img src="${img.data}" alt="${img.name}">
            <span>${img.name}</span>
        </div>`;
    });
    menuHtml += '</div><button class="btn btn-back" id="galleryInsertClose">取消</button></div>';

    const overlay = document.createElement('div');
    overlay.className = 'gallery-overlay';
    overlay.innerHTML = menuHtml;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.gallery-insert-item').forEach(el => {
        el.addEventListener('click', function() {
            const id = parseInt(this.dataset.id);
            const img = state.gallery.find(g => g.id === id);
            if (img) {
                const markdown = '\n![' + img.name + '](' + img.id + ')\n';
                const text = textarea.value;
                textarea.value = text.substring(0, cursorPos) + markdown + text.substring(cursorPos);
                toast('图片引用已插入');
            }
            overlay.remove();
        });
    });

    document.getElementById('galleryInsertClose').addEventListener('click', function() {
        overlay.remove();
    });

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });
});

/* ========== Image Gallery ========== */
document.getElementById('galleryUploadBtn').addEventListener('click', function() {
    document.getElementById('galleryFileInput').click();
});

document.getElementById('galleryFileInput').addEventListener('change', function(e) {
    const files = e.target.files;
    if (!files.length) return;

    Array.from(files).forEach(file => {
        if (file.size > 5 * 1024 * 1024) {
            toast(file.name + ' 超过 5MB，已跳过', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(ev) {
            const img = {
                id: Date.now() + Math.random(),
                name: file.name,
                data: ev.target.result,
                addedAt: new Date().toISOString()
            };
            state.gallery.push(img);
            saveGallery();
            renderGallery();
            toast(file.name + ' 上传成功', 'success');
        };
        reader.readAsDataURL(file);
    });
    this.value = '';
});

function renderGallery() {
    const container = document.getElementById('imageGallery');
    if (state.gallery.length === 0) {
        container.innerHTML = '<p class="empty-msg">还没有上传图片，上传后可直接复制 Markdown 引用到文章中</p>';
        return;
    }

    container.innerHTML = '<div class="gallery-grid">' + state.gallery.map(img =>
        '<div class="gallery-item">' +
            '<img src="' + img.data + '" alt="' + img.name + '">' +
            '<div class="gallery-item-info">' +
                '<div class="gallery-item-name">' + img.name + '</div>' +
                '<div class="gallery-item-actions">' +
                    '<button class="gallery-copy-btn" data-id="' + img.id + '">📋 复制引用</button>' +
                    '<button class="gallery-delete-btn" data-id="' + img.id + '">✕</button>' +
                '</div>' +
            '</div>' +
        '</div>'
    ).join('') + '</div>';

    container.querySelectorAll('.gallery-copy-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = parseFloat(this.dataset.id);
            const img = state.gallery.find(g => g.id === id);
            if (img) {
                const markdown = '![' + img.name + '](' + img.id + ')';
                navigator.clipboard.writeText(markdown).then(() => {
                    toast('已复制 Markdown 引用，粘贴到文章即可');
                }).catch(() => {
                    toast('复制失败，请手动复制');
                });
            }
        });
    });

    container.querySelectorAll('.gallery-delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = parseFloat(this.dataset.id);
            if (confirm('确定删除这张图片吗？')) {
                state.gallery = state.gallery.filter(g => g.id !== id);
                saveGallery();
                renderGallery();
                toast('图片已删除');
            }
        });
    });
}

function renderBlogList() {
    const container = document.getElementById('blogList');
    const search = document.getElementById('blogSearch').value.trim().toLowerCase();

    let list = state.posts;
    if (search) list = list.filter(p => p.title.toLowerCase().includes(search));

    if (list.length === 0) {
        container.innerHTML = '<p class="empty-msg">没有找到文章</p>';
        return;
    }

    container.innerHTML = list.map(p => {
        const excerpt = p.content.replace(/[#*`\[\]!>|]/g, '').substring(0, 150) + (p.content.length > 150 ? '...' : '');
        const tagsHtml = p.tags.map(t => `<span class="blog-post-tag">${t}</span>`).join('');
        return `
            <div class="blog-post" data-id="${p.id}">
                <button class="blog-post-delete" data-id="${p.id}">✕ 删除</button>
                <div class="blog-post-title">${p.title}</div>
                <div class="blog-post-meta">
                    <span>📅 ${formatDate(p.date)}</span>
                    ${tagsHtml ? '<span class="blog-post-tags">' + tagsHtml + '</span>' : ''}
                </div>
                <div class="blog-post-excerpt">${excerpt}</div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.blog-post').forEach(el => {
        el.addEventListener('click', function(e) {
            if (e.target.classList.contains('blog-post-delete')) return;
            const id = parseInt(this.dataset.id);
            showBlogDetail(id);
        });
    });

    container.querySelectorAll('.blog-post-delete').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('确定删除这篇文章吗？')) {
                const id = parseInt(this.dataset.id);
                state.posts = state.posts.filter(p => p.id !== id);
                savePosts();
                renderBlogList();
                renderDashboard();
                toast('文章已删除');
            }
        });
    });
}

function showBlogDetail(id) {
    const post = state.posts.find(p => p.id === id);
    if (!post) return;

    state.currentPostId = id;
    const blogPage = document.getElementById('page-blog');
    const detailPage = document.getElementById('page-blog-detail');

    blogPage.classList.remove('active');
    blogPage.classList.add('leaving');

    setTimeout(() => {
        blogPage.classList.remove('leaving');
        blogPage.style.display = 'none';

        detailPage.style.display = 'block';
        detailPage.classList.add('active');

        const tagsHtml = post.tags.map(t => `<span class="blog-post-tag">${t}</span>`).join('');

        document.getElementById('blogDetailContent').innerHTML = `
            <div class="card-body">
                <div class="blog-detail-title">${post.title}</div>
                <div class="blog-detail-meta">
                    <span>📅 ${formatDate(post.date)}</span>
                    ${tagsHtml ? '<span class="blog-post-tags">' + tagsHtml + '</span>' : ''}
                </div>
                <div class="blog-detail-content">${renderMarkdown(post.content)}</div>
            </div>
        `;
    }, 250);
}

/* ========== Dashboard ========== */
function renderDashboard() {
    const sessions = state.sessions;
    const posts = state.posts;

    const totalHours = sessions.reduce((sum, s) => sum + s.duration, 0);
    document.getElementById('statTotalHours').textContent = totalHours.toFixed(1);
    document.getElementById('statTotalSessions').textContent = sessions.length;
    document.getElementById('statTotalPosts').textContent = posts.length;

    const uniqueDates = new Set(sessions.map(s => s.date));
    const sortedDates = [...uniqueDates].sort().reverse();
    let streak = 0;
    const today = todayStr();
    const checkDate = new Date(today);
    for (let i = 0; i < 365; i++) {
        const d = checkDate.getFullYear() + '-' + String(checkDate.getMonth() + 1).padStart(2, '0') + '-' + String(checkDate.getDate()).padStart(2, '0');
        if (sortedDates.includes(d)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else if (d !== today) {
            break;
        } else {
            checkDate.setDate(checkDate.getDate() - 1);
        }
    }
    document.getElementById('statStreak').textContent = streak;

    const recentSessions = sessions.slice(0, 5);
    const recentContainer = document.getElementById('recentSessions');
    if (recentSessions.length === 0) {
        recentContainer.innerHTML = '<p class="empty-msg">还没有学习记录，开始学习吧！</p>';
    } else {
        recentContainer.innerHTML = recentSessions.map(s => `
            <div class="timeline-item" style="margin-bottom:8px">
                <div class="timeline-item-header">
                    <span class="timeline-date">📅 ${formatDate(s.date)}</span>
                    <span class="timeline-subject">${s.subject}</span>
                    <span class="timeline-duration">⏱ ${s.duration}h</span>
                </div>
                <div class="timeline-content" style="font-size:13px">${s.content.substring(0, 80)}${s.content.length > 80 ? '...' : ''}</div>
            </div>
        `).join('');
    }

    const recentPosts = posts.slice(0, 5);
    const postsContainer = document.getElementById('recentPosts');
    if (recentPosts.length === 0) {
        postsContainer.innerHTML = '<p class="empty-msg">还没有博客文章，写一篇吧！</p>';
    } else {
        postsContainer.innerHTML = recentPosts.map(p => `
            <div class="blog-post" style="cursor:pointer" data-id="${p.id}">
                <div class="blog-post-title" style="font-size:15px">${p.title}</div>
                <div class="blog-post-meta" style="font-size:12px">
                    <span>📅 ${formatDate(p.date)}</span>
                    ${p.tags.length ? '<span class="blog-post-tags">' + p.tags.map(t => `<span class="blog-post-tag">${t}</span>`).join('') + '</span>' : ''}
                </div>
            </div>
        `).join('');

        postsContainer.querySelectorAll('.blog-post').forEach(el => {
            el.addEventListener('click', function() {
                const id = parseInt(this.dataset.id);
                showBlogDetail(id);
            });
        });
    }
}

/* ========== Stats ========== */
function renderStats() {
    renderUserChecks();
    renderUserComparison();
    renderDailyChart();
    renderSubjectChart();
    renderCalendar();
}

function renderUserComparison() {
    const container = document.getElementById('statsUserInfo');
    const checks = document.querySelectorAll('#statsUserChecks input[type="checkbox"]:checked');
    const users = Array.from(checks).map(cb => cb.value);
    const displayUsers = users.length > 0 ? users : [state.activeUser];

    if (displayUsers.length === 0) {
        container.innerHTML = '<p class="empty-msg">无可用的用户数据</p>';
        return;
    }

    let html = '<div class="user-compare-info">';
    let mergedSessions = [];
    let mergedPosts = [];
    let mergedSubjects = new Set();

    displayUsers.forEach(username => {
        const data = getAllUserData(username);
        const sessions = data.sessions || [];
        const posts = data.posts || [];
        const totalHours = sessions.reduce(function(s, ss) { return s + ss.duration; }, 0);
        const totalSessions = sessions.length;
        const totalPosts = posts.length;
        const subjects = [...new Set(sessions.map(function(s) { return s.subject; }))];
        const recentDate = sessions.length > 0 ? sessions.slice().sort(function(a, b) { return b.date.localeCompare(a.date); })[0].date : '无';

        html += '<div class="user-compare-card">' +
            '<h4>' + (username === state.activeUser ? '当前: ' : '') + username + '</h4>' +
            '<div class="user-compare-stat">学习时长：<strong>' + totalHours.toFixed(1) + 'h</strong></div>' +
            '<div class="user-compare-stat">学习次数：<strong>' + totalSessions + ' 次</strong></div>' +
            '<div class="user-compare-stat">文章数：<strong>' + totalPosts + ' 篇</strong></div>' +
            '<div class="user-compare-stat">学习内容：<strong>' + (subjects.length > 0 ? subjects.join('、') : '无') + '</strong></div>' +
            '<div class="user-compare-stat">最近学习：<strong>' + recentDate + '</strong></div>' +
        '</div>';

        mergedSessions = mergedSessions.concat(sessions);
        subjects.forEach(function(s) { mergedSubjects.add(s); });
        mergedPosts = mergedPosts.concat(posts);
    });

    if (displayUsers.length > 1) {
        var totalH = mergedSessions.reduce(function(s, ss) { return s + ss.duration; }, 0);
        var uniqueDates = new Set(mergedSessions.map(function(s) { return s.date; }));
        html += '<div class="user-compare-card merged-card">' +
            '<h4>合计（' + displayUsers.length + '人）</h4>' +
            '<div class="user-compare-stat">总时长：<strong>' + totalH.toFixed(1) + 'h</strong></div>' +
            '<div class="user-compare-stat">总次数：<strong>' + mergedSessions.length + ' 次</strong></div>' +
            '<div class="user-compare-stat">总文章：<strong>' + mergedPosts.length + ' 篇</strong></div>' +
            '<div class="user-compare-stat">学习天数：<strong>' + uniqueDates.size + ' 天</strong></div>' +
        '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

function renderDailyChart() {
    const canvas = document.getElementById('chartDaily');
    const emptyMsg = document.getElementById('chartDailyEmpty');
    const ctx = canvas.getContext('2d');

    const days = {};
    state.sessions.forEach(s => {
        days[s.date] = (days[s.date] || 0) + s.duration;
    });

    const sortedDays = Object.keys(days).sort().slice(-14);

    if (sortedDays.length < 2) {
        canvas.style.display = 'none';
        emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width || 600;
    const h = 250;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const maxVal = Math.max(...sortedDays.map(d => days[d]), 1);
    const barW = chartW / sortedDays.length * 0.6;
    const gap = chartW / sortedDays.length;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i <= 4; i++) {
        const val = (maxVal / 4) * i;
        const y = pad.top + chartH - (val / maxVal) * chartH;
        ctx.beginPath();
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();

        ctx.fillStyle = '#9ca3af';
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(val.toFixed(1), pad.left - 8, y + 4);
    }

    sortedDays.forEach((d, i) => {
        const x = pad.left + i * gap + (gap - barW) / 2;
        const barH = (days[d] / maxVal) * chartH;
        const y = pad.top + chartH - barH;

        const gradient = ctx.createLinearGradient(x, y, x, pad.top + chartH);
        gradient.addColorStop(0, '#4f46e5');
        gradient.addColorStop(1, '#818cf8');
        ctx.fillStyle = gradient;

        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
        ctx.fill();

        ctx.fillStyle = '#6b7280';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(formatDateShort(d), x + barW / 2, pad.top + chartH + 18);
    });
}

function renderSubjectChart() {
    const canvas = document.getElementById('chartSubjects');
    const emptyMsg = document.getElementById('chartSubjectsEmpty');
    const ctx = canvas.getContext('2d');

    const subjects = {};
    state.sessions.forEach(s => {
        subjects[s.subject] = (subjects[s.subject] || 0) + s.duration;
    });

    const entries = Object.entries(subjects).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        canvas.style.display = 'none';
        emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width || 600;
    const h = 250;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 20, bottom: 40, left: 100 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    const barH = Math.min(chartH / entries.length * 0.6, 30);
    const gap = chartH / entries.length;

    const colors = ['#4f46e5', '#818cf8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(0, 0, w, h);

    entries.forEach((entry, i) => {
        const y = pad.top + i * gap + (gap - barH) / 2;
        const barW = (entry[1] / maxVal) * chartW;

        ctx.fillStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.roundRect(pad.left, y, chartW, barH, [4]);
        ctx.fill();

        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.roundRect(pad.left, y, barW, barH, [4]);
        ctx.fill();

        ctx.fillStyle = '#1f2937';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(entry[0], pad.left - 8, y + barH / 2 + 4);

        ctx.fillStyle = '#6b7280';
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(entry[1].toFixed(1) + 'h', pad.left + barW + 8, y + barH / 2 + 4);
    });
}

/* ========== Calendar ========== */
function getCalendarData() {
    var checks = document.querySelectorAll('#statsUserChecks input[type="checkbox"]:checked');
    var compareUsers = Array.from(checks).map(function(cb) { return cb.value; });
    var users = compareUsers.length > 0 ? compareUsers : [state.activeUser];

    const dayStats = {};
    users.forEach(function(username) {
        const data = getAllUserData(username);
        data.sessions.forEach(function(s) {
            if (!dayStats[s.date]) {
                dayStats[s.date] = { total: 0, subjects: {}, users: {} };
            }
            dayStats[s.date].total += s.duration;
            dayStats[s.date].subjects[s.subject] = (dayStats[s.date].subjects[s.subject] || 0) + s.duration;
            if (!dayStats[s.date].users[username]) {
                dayStats[s.date].users[username] = { total: 0, subjects: {} };
            }
            dayStats[s.date].users[username].total += s.duration;
            dayStats[s.date].users[username].subjects[s.subject] = (dayStats[s.date].users[username].subjects[s.subject] || 0) + s.duration;
        });
    });
    return dayStats;
}

function renderCalendar() {
    const container = document.getElementById('calendarView');
    const { calendarYear: year, calendarMonth: month } = state;

    const dayStats = getCalendarData();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const today = todayStr();

    let html = '<div class="calendar-header">';
    html += `<button class="calendar-nav-btn" id="calPrev">‹ 上月</button>`;
    html += `<h4>${year}年 ${monthNames[month]}</h4>`;
    html += `<button class="calendar-nav-btn" id="calNext">下月 ›</button>`;
    html += '</div>';

    html += '<div class="calendar-grid">';
    weekdayNames.forEach(w => {
        html += `<div class="calendar-weekday">${w}</div>`;
    });

    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const isToday = dateStr === today;
        const stats = dayStats[dateStr];
        const hasStudy = !!stats;

        const classes = ['calendar-day'];
        if (isToday) classes.push('today');
        if (hasStudy) classes.push('has-study');

        let dayHtml = `<div class="${classes.join(' ')}" data-date="${dateStr}">`;
        dayHtml += `<span class="calendar-day-num">${d}</span>`;

        if (hasStudy) {
            dayHtml += '<span class="calendar-day-hours">' + stats.total.toFixed(1) + 'h</span>';
            dayHtml += '<div class="calendar-tooltip">';
            var userKeys = Object.keys(stats.users);
            if (userKeys.length === 1) {
                dayHtml += '<div class="calendar-tooltip-total">共 ' + stats.total.toFixed(1) + ' 小时</div>';
                Object.entries(stats.subjects).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
                    dayHtml += '<div class="calendar-tooltip-item"><span>' + entry[0] + '</span><span>' + entry[1].toFixed(1) + 'h</span></div>';
                });
            } else {
                dayHtml += '<div class="calendar-tooltip-total">共 ' + stats.total.toFixed(1) + ' 小时</div>';
                userKeys.forEach(function(username) {
                    var userData = stats.users[username];
                    dayHtml += '<div class="calendar-tooltip-user">' + username + '：' + userData.total.toFixed(1) + 'h</div>';
                    Object.entries(userData.subjects).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
                        dayHtml += '<div class="calendar-tooltip-item"><span>' + entry[0] + '</span><span>' + entry[1].toFixed(1) + 'h</span></div>';
                    });
                });
            }
            dayHtml += '</div>';
        }

        dayHtml += '</div>';
        html += dayHtml;
    }

    html += '</div>';
    container.innerHTML = html;

    document.getElementById('calPrev').addEventListener('click', function() {
        state.calendarMonth--;
        if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
        renderCalendar();
    });

    document.getElementById('calNext').addEventListener('click', function() {
        state.calendarMonth++;
        if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
        renderCalendar();
    });
}

/* ========== Pomodoro Timer ========== */
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function formatDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + d + ' ' + h + ':' + min;
}

function updatePomodoroDisplay() {
    const p = state.pomodoro;
    document.getElementById('pomodoroTimer').textContent = formatTime(p.remainingSeconds);

    if (p.isRunning && !p.isPaused) {
        document.getElementById('pomodoroStatus').textContent = '🔴 学习中...';
        document.querySelector('.pomodoro-body').classList.add('pomodoro-running');
        document.getElementById('pomodoroStart').style.display = 'none';
        document.getElementById('pomodoroPause').style.display = '';
        document.getElementById('pomodoroReset').style.display = '';
    } else if (p.isPaused) {
        document.getElementById('pomodoroStatus').textContent = '⏸ 已暂停';
        document.querySelector('.pomodoro-body').classList.remove('pomodoro-running');
        document.getElementById('pomodoroStart').textContent = '▶ 继续';
        document.getElementById('pomodoroStart').style.display = '';
        document.getElementById('pomodoroPause').style.display = 'none';
        document.getElementById('pomodoroReset').style.display = '';
    } else {
        document.getElementById('pomodoroStatus').textContent = '⏸ 准备开始';
        document.querySelector('.pomodoro-body').classList.remove('pomodoro-running');
        document.getElementById('pomodoroStart').textContent = '▶ 开始';
        document.getElementById('pomodoroStart').style.display = '';
        document.getElementById('pomodoroPause').style.display = 'none';
        document.getElementById('pomodoroReset').style.display = 'none';
    }
}

function setPomodoroMinutes(mins) {
    if (state.pomodoro.isRunning) return;
    state.pomodoro.totalSeconds = mins * 60;
    state.pomodoro.remainingSeconds = mins * 60;
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('pomodoroCustom').value = '';
    updatePomodoroDisplay();
}

document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', function() {
        const mins = parseInt(this.dataset.minutes);
        if (state.pomodoro.isRunning) return;
        state.pomodoro.totalSeconds = mins * 60;
        state.pomodoro.remainingSeconds = mins * 60;
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        document.getElementById('pomodoroCustom').value = '';
        updatePomodoroDisplay();
    });
});

document.getElementById('pomodoroCustom').addEventListener('change', function() {
    const val = parseInt(this.value);
    if (val && val > 0 && val <= 240) {
        state.pomodoro.totalSeconds = val * 60;
        state.pomodoro.remainingSeconds = val * 60;
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        updatePomodoroDisplay();
    }
});

document.getElementById('pomodoroStart').addEventListener('click', function() {
    const p = state.pomodoro;
    const subject = document.getElementById('pomodoroSubject').value.trim();

    if (!p.isPaused && !subject) {
        toast('请输入学习内容', 'error');
        document.getElementById('pomodoroSubject').focus();
        return;
    }

    p.isRunning = true;
    p.isPaused = false;
    p.subject = subject;

    if (p.interval) clearInterval(p.interval);
    p.interval = setInterval(function() {
        p.remainingSeconds--;
        updatePomodoroDisplay();

        if (p.remainingSeconds <= 0) {
            clearInterval(p.interval);
            p.interval = null;
            p.isRunning = false;
            p.isPaused = false;

            const durationHours = p.totalSeconds / 60 / 60;
            const session = {
                id: Date.now(),
                date: todayStr(),
                subject: p.subject,
                duration: parseFloat(durationHours.toFixed(2)),
                content: '🍅 番茄钟学习完成',
                createdAt: new Date().toISOString()
            };

            state.sessions.unshift(session);
            saveSessions();
            renderDashboard();
            renderTimeline();
            updatePomodoroDisplay();
            toast('🎉 番茄钟完成！已自动记录到学习时间线', 'success');
        }
    }, 1000);

    updatePomodoroDisplay();
});

document.getElementById('pomodoroPause').addEventListener('click', function() {
    state.pomodoro.isPaused = true;
    if (state.pomodoro.interval) {
        clearInterval(state.pomodoro.interval);
        state.pomodoro.interval = null;
    }
    updatePomodoroDisplay();
});

document.getElementById('pomodoroReset').addEventListener('click', function() {
    const p = state.pomodoro;
    if (p.interval) {
        clearInterval(p.interval);
        p.interval = null;
    }
    p.isRunning = false;
    p.isPaused = false;
    p.remainingSeconds = p.totalSeconds;
    document.querySelector('.pomodoro-body').classList.remove('pomodoro-running');
    updatePomodoroDisplay();
});

/* ========== Export / Import ========== */
document.getElementById('exportBtn').addEventListener('click', function() {
    const data = {
        sessions: state.sessions,
        posts: state.posts,
        exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'learning-data-backup-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('数据导出成功！');
});

document.getElementById('importBtn').addEventListener('click', function() {
    document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.sessions && Array.isArray(data.sessions)) {
                state.sessions = data.sessions;
                saveSessions();
            }
            if (data.posts && Array.isArray(data.posts)) {
                state.posts = data.posts;
                savePosts();
            }
            renderDashboard();
            renderTimeline();
            renderBlogList();
            renderStats();
            toast('数据导入成功！共 ' + state.sessions.length + ' 条学习记录，' + state.posts.length + ' 篇文章', 'success');
        } catch (err) {
            toast('导入失败：文件格式不正确', 'error');
        }
    };
    reader.readAsText(file);
    this.value = '';
});

/* ========== Init ========== */
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('tlDate').value = todayStr();
    document.getElementById('tlHours').value = '0';
    document.getElementById('tlMinutes').value = '0';

    /* Mobile sidebar toggle */
    function toggleSidebar(open) {
        const sidebar = document.querySelector('.sidebar');
        let backdrop = document.querySelector('.sidebar-backdrop');
        if (open === undefined) {
            open = !sidebar.classList.contains('open');
        }
        if (open) {
            sidebar.classList.add('open');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'sidebar-backdrop';
                document.body.appendChild(backdrop);
            }
            requestAnimationFrame(() => backdrop.classList.add('show'));
        } else {
            sidebar.classList.remove('open');
            if (backdrop) backdrop.classList.remove('show');
        }
    }

    document.getElementById('mobileMenuBtn').addEventListener('click', function() {
        toggleSidebar(true);
    });

    document.addEventListener('click', function(e) {
        const sidebar = document.querySelector('.sidebar');
        const backdrop = document.querySelector('.sidebar-backdrop');
        if (backdrop && backdrop.classList.contains('show') && !sidebar.contains(e.target) && !e.target.closest('#mobileMenuBtn')) {
            toggleSidebar(false);
        }
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function() {
            const backdrop = document.querySelector('.sidebar-backdrop');
            if (backdrop) toggleSidebar(false);
        });
    });

    document.getElementById('userSelect').addEventListener('change', function() {
        switchUser(this.value);
    });

    document.getElementById('addUserBtn').addEventListener('click', addUser);

    document.getElementById('delUserBtn').addEventListener('click', deleteUser);

    document.getElementById('statsCompareBtn').addEventListener('click', function() {
        renderUserComparison();
        renderCalendar();
    });

    renderUserSelect();

    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const home = document.getElementById('page-dashboard');
    home.style.display = 'block';
    home.classList.add('active');

    state.currentPage = 'dashboard';

    renderDashboard();
    renderTimeline();
    renderBlogList();
    renderGallery();
    renderStats();

    if (!state.sessions.length && !state.posts.length) {
        setTimeout(() => {
            toast('👋 欢迎 「' + state.activeUser + '」！在学习时间线中添加第一条记录吧');
        }, 500);
    }

    /* Sync */
    const syncHeader = document.querySelector('.sync-header');
    const syncBody = document.getElementById('syncBody');
    syncBody.style.display = 'block';
    syncHeader.classList.add('expanded');

    syncHeader.addEventListener('click', function() {
        const isVisible = syncBody.style.display !== 'none';
        syncBody.style.display = isVisible ? 'none' : 'block';
        syncHeader.classList.toggle('expanded', !isVisible);
    });

    document.getElementById('syncConnectBtn').addEventListener('click', async function() {
        if (SyncService.connected) {
            await SyncService.disconnect();
            return;
        }
        const token = document.getElementById('githubToken').value.trim();
        if (!token) {
            toast('请输入 GitHub Personal Access Token', 'error');
            return;
        }
        SyncService.setToken(token);
        const valid = await SyncService.validateToken();
        if (valid) {
            document.getElementById('syncModeGroup').style.display = 'flex';
            const mode = document.querySelector('input[name="syncMode"]:checked');
            if (mode && mode.value === 'pull') {
                await SyncService.pullOnly();
            } else if (mode && mode.value === 'push') {
                await SyncService.pushOnly();
            } else {
                await SyncService.syncAll();
            }
        } else {
            updateSyncUI('error');
            toast('Token 无效，请检查是否具有 gist 权限', 'error');
        }
    });

    document.getElementById('syncNowBtn').addEventListener('click', function() {
        const mode = document.querySelector('input[name="syncMode"]:checked');
        if (!mode) return SyncService.syncAll();
        switch (mode.value) {
            case 'pull': SyncService.pullOnly(); break;
            case 'push': SyncService.pushOnly(); break;
            default: SyncService.syncAll();
        }
    });

    document.querySelectorAll('.sync-mode-option').forEach(function(opt) {
        opt.addEventListener('click', function() {
            document.querySelectorAll('.sync-mode-option').forEach(function(o) {
                o.classList.remove('active');
            });
            this.classList.add('active');
            this.querySelector('input[type="radio"]').checked = true;
        });
    });

    const savedToken = localStorage.getItem('learn_gh_token') || (typeof GITHUB_TOKEN !== 'undefined' ? GITHUB_TOKEN : '');
    if (savedToken) {
        document.getElementById('githubToken').value = savedToken;
        SyncService.setToken(savedToken);
        SyncService.validateToken().then(async (valid) => {
            if (valid) {
                document.getElementById('syncModeGroup').style.display = 'flex';
                SyncService.connected = true;
                updateSyncUI('connected');
                toast('Token 已就绪，请选择同步方向后点击同步按钮', '');
            }
        });
    }
});

window.addEventListener('resize', function() {
    if (state.currentPage === 'stats') {
        renderStats();
    }
});