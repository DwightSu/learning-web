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

let state = {
    sessions: Store.get('sessions', []),
    posts: Store.get('posts', []),
    gallery: Store.get('gallery', []),
    currentPage: 'dashboard',
    currentPostId: null,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    isTransitioning: false
};

function saveSessions() {
    Store.set('sessions', state.sessions);
}

function savePosts() {
    Store.set('posts', state.posts);
}

function saveGallery() {
    Store.set('gallery', state.gallery);
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
    const duration = parseFloat(document.getElementById('tlDuration').value);
    const content = document.getElementById('tlContent').value.trim();

    if (!subject) {
        toast('请输入学习内容', 'error');
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
    renderDailyChart();
    renderSubjectChart();
    renderCalendar();
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
function renderCalendar() {
    const container = document.getElementById('calendarView');
    const { calendarYear: year, calendarMonth: month } = state;

    const sessionDates = new Set(state.sessions.map(s => s.date));
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
        const hasStudy = sessionDates.has(dateStr);
        const classes = ['calendar-day'];
        if (isToday) classes.push('today');
        if (hasStudy) classes.push('has-study');
        html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${d}</div>`;
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

    container.querySelectorAll('.calendar-day.has-study').forEach(el => {
        el.addEventListener('click', function() {
            const date = this.dataset.date;
            const sessionsOnDay = state.sessions.filter(s => s.date === date);
            if (sessionsOnDay.length > 0) {
                const total = sessionsOnDay.reduce((sum, s) => sum + s.duration, 0);
                const subjects = [...new Set(sessionsOnDay.map(s => s.subject))].join('、');
                toast(date + ' 学习了 ' + subjects + ' 共 ' + total.toFixed(1) + ' 小时');
            }
        });
    });
}

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
            toast('👋 欢迎！在学习时间线中添加第一条记录吧');
        }, 500);
    }
});

window.addEventListener('resize', function() {
    if (state.currentPage === 'stats') {
        renderStats();
    }
});