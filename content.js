console.log("🌸 Bangumi 助手已加载，正在持续监听页面变化...");

const CORE_ROLES = ["原作", "总导演", "导演", "监督", "系列构成", "脚本", "角色设计", "总作画监督", "作画监督", "音乐"];
let lastUrl = '';

// 带有“安全气囊”的请求函数，静默处理上下文失效报错
const bgmFetch = (url) => new Promise((resolve) => {
    try {
        chrome.runtime.sendMessage({ action: 'bgmApiFetch', url: url }, response => {
            // 捕获异步的连接错误
            if (chrome.runtime.lastError) {
                resolve(null);
            } else {
                resolve(response ? response.data : null);
            }
        });
    } catch (e) {
        // 捕获同步的 Context invalidated 错误
        resolve(null);
    }
});

function extractAnimeName(title) {
    let name = title.split(/-番剧-|- bilibili|_哔哩哔哩/)[0];
    name = name.split(/第[\d一二三四五六七八九十百]+[集话]/)[0];
    return name.trim();
}

async function triggerFetch() {
    const rawTitle = document.title;
    const displayName = extractAnimeName(rawTitle); 
    if (!displayName || displayName.includes("bilibili")) return;
    
    const searchName = displayName.replace(/[!~！？?*★☆\-、，：:]/g, ' ').replace(/\s+/g, ' ').trim();
    
    // 🌟 新增：请求前先读取插件设定的“自动展开”参数，默认是开启的(true)
    const storageRes = await new Promise(resolve => chrome.storage.local.get(['autoExpand'], resolve));
    const autoExpand = storageRes.autoExpand !== false;

    buildOrResetFloatingWindow(displayName, autoExpand);

    const searchData = await bgmFetch(`https://api.bgm.tv/search/subject/${encodeURIComponent(searchName)}`);
    if (!searchData || !searchData.list || searchData.list.length === 0) {
        document.getElementById('bgm-ext-content').innerHTML = `<div style="padding:15px;text-align:center;">未能找到「${displayName}」相关档案</div>`;
        return;
    }
    
    const mainItem = searchData.list.find(item => item.type === 2 || item.type === 6);
    if (!mainItem) {
        document.getElementById('bgm-ext-content').innerHTML = `<div style="padding:15px;text-align:center;">未能找到相关的动画或三次元节目</div>`;
        return;
    }
    
    const mainId = mainItem.id;
    const relationsData = await bgmFetch(`https://api.bgm.tv/v0/subjects/${mainId}/subjects`);
    let seriesIds = new Set([mainId]);
    if (relationsData) {
        relationsData.filter(r => r.type === 2 || r.type === 6).forEach(r => seriesIds.add(r.id));
    }
    
    const idArray = Array.from(seriesIds).slice(0, 8); 
    const allInfo = await Promise.all(idArray.map(async (id, index) => {
        const [detail, persons, characters] = await Promise.all([
            bgmFetch(`https://api.bgm.tv/v0/subjects/${id}`),
            bgmFetch(`https://api.bgm.tv/v0/subjects/${id}/persons`),
            bgmFetch(`https://api.bgm.tv/v0/subjects/${id}/characters`)
        ]);
        let relationName = index === 0 ? "当前追踪" : (relationsData.find(r => r.id === id)?.relation || "关联");
        return { isMain: index === 0, relation: relationName, detail, persons, characters };
    }));

    allInfo.sort((a, b) => {
        if (a.isMain) return -1; if (b.isMain) return 1;
        if (!a.detail.date) return 1; if (!b.detail.date) return -1;
        return new Date(a.detail.date) - new Date(b.detail.date);
    });

    const html = allInfo.map(info => {
        const d = info.detail;
        const score = d.rating ? d.rating.score : '-';
        
        let staffMap = {};
        if(info.persons) {
            info.persons.forEach(p => {
                if (CORE_ROLES.includes(p.relation) || p.relation.includes("监督")) {
                    if(!staffMap[p.relation]) staffMap[p.relation] = [];
                    staffMap[p.relation].push(`<a href="https://bgm.tv/person/${p.id}" target="_blank" class="bgm-link" style="font-weight:500;">${p.name}</a>`);
                }
            });
        }
        let staffHtml = '';
        CORE_ROLES.forEach(role => {
            if(staffMap[role]) { staffHtml += `<div class="bgm-staff-row"><div class="bgm-staff-job">${role}</div><div class="bgm-staff-names">${staffMap[role].join('<span class="bgm-divider">/</span>')}</div></div>`; delete staffMap[role]; }
        });
        Object.keys(staffMap).forEach(role => { staffHtml += `<div class="bgm-staff-row"><div class="bgm-staff-job">${role}</div><div class="bgm-staff-names">${staffMap[role].join('<span class="bgm-divider">/</span>')}</div></div>`; });

        let charsHtml = '';
        if (info.characters) {
            const mainChars = info.characters.filter(c => c.relation === '主角' || c.relation === '配角').slice(0, 8);
            charsHtml = mainChars.map(c => {
                const cv = (c.actors && c.actors.length > 0) ? c.actors[0] : null;
                const cvHtml = cv ? `<span class="bgm-cv-text"> —— cv. </span><a href="https://bgm.tv/person/${cv.id}" target="_blank" class="bgm-link" style="color:#888;">${cv.name}</a>` : '';
                return `<div class="bgm-char-item"><a href="https://bgm.tv/character/${c.id}" target="_blank" class="bgm-link font-bold" style="color:#fb7299;">${c.name}</a>${cvHtml}</div>`;
            }).join('');
        }

        let tagsHtml = '';
        if (d.tags) {
            tagsHtml = d.tags.slice(0, 8).map(t => `<span class="bgm-tag">${t.name}</span>`).join('');
        }

        return `
            <details class="bgm-details" ${info.isMain ? 'open' : ''}>
                <summary class="bgm-summary">
                    <span class="bgm-rel-badge">${info.relation}</span> 
                    <span class="bgm-score">${score}</span>
                    <span class="bgm-ep-title" title="${d.name_cn || d.name}">${d.name_cn || d.name}</span>
                    <span class="bgm-year">${d.date ? d.date.substring(0,4) : ''}</span>
                </summary>
                <div class="bgm-content">
                    <div class="bgm-section-title">👑 核心 Staff</div>
                    ${staffHtml || '<div style="color:#999;font-size:12px;margin-bottom:10px;">暂无 Staff 数据</div>'}
                    
                    <div class="bgm-section-title">🎭 主要角色与声优</div>
                    <div>${charsHtml || '<div style="color:#999;font-size:12px;margin-bottom:10px;">暂无角色数据</div>'}</div>
                    
                    <div class="bgm-section-title">🏷️ 常用标签</div>
                    <div>${tagsHtml || '<div style="color:#999;font-size:12px;">暂无标签</div>'}</div>

                    <div style="margin-top:15px; border-top: 1px dashed #f0f0f0; padding-top: 10px; text-align: center;">
                        <a class="bgm-link" href="https://bgm.tv/subject/${d.id}" target="_blank" style="color:#00a1d6; font-weight:bold;">🔗 在 Bangumi 查看完整页面 ↗</a>
                    </div>
                </div>
            </details>`;
    }).join('');

    document.getElementById('bgm-ext-content').innerHTML = html;
}

// 🌟 修改：接收 autoExpand 参数，决定重置时是否强制弹开
function buildOrResetFloatingWindow(title, autoExpand) {
    let widget = document.getElementById('bgm-ext-widget');
    let minBtn = document.getElementById('bgm-ext-min-btn');
    let keepMinimized = false;

    if (!widget) {
        const style = document.createElement('style');
        style.textContent = `
            #bgm-ext-widget { position: fixed; bottom: 20px; right: 20px; width: 380px; max-height: 85vh; background: #fdfdfd; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.15); z-index: 999999; font-family: sans-serif; border: 1px solid #e3e5e7; display: flex; flex-direction: column; transition: all 0.3s ease; }
            #bgm-ext-widget.minimized { transform: translateY(150%); opacity: 0; pointer-events: none; }
            #bgm-ext-min-btn { position: fixed; bottom: 20px; right: 20px; background: #fb7299; color: white; padding: 10px 20px; border-radius: 30px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 15px rgba(251,114,153,0.4); z-index: 999998; transition: all 0.3s ease; transform: translateY(150%); opacity: 0; pointer-events: none; }
            #bgm-ext-min-btn.active { transform: translateY(0); opacity: 1; pointer-events: auto; }
            #bgm-ext-min-btn:hover { background: #ff85a8; }
            
            .bgm-ext-header { background: #fb7299; color: #fff; padding: 10px 15px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-radius: 10px 10px 0 0;}
            .bgm-btn-min { cursor: pointer; font-size: 14px; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 12px; transition: background 0.2s; }
            .bgm-btn-min:hover { background: rgba(255,255,255,0.4); }
            .bgm-ext-body { padding: 15px; font-size: 13px; color: #333; overflow-y: auto; }
            
            .bgm-details { margin-bottom: 12px; border: 1px solid #ebeef5; border-radius: 6px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.03); overflow: hidden; }
            .bgm-details[open] .bgm-summary { border-bottom: 1px solid #ebeef5; background: #fafbfc; }
            .bgm-summary { padding: 10px; cursor: pointer; display: flex; align-items: center; transition: background 0.2s; }
            .bgm-summary::-webkit-details-marker { display: none; }
            
            .bgm-rel-badge { color: #1989fa; background: #e6f1fc; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 8px; white-space: nowrap; }
            .bgm-score { color: #f5a623; font-weight: bold; margin-right: 8px; font-size: 14px; }
            .bgm-ep-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
            .bgm-year { color: #999; font-size: 12px; margin-left: 8px; }
            
            .bgm-content { padding: 12px; }
            .bgm-section-title { font-size: 12px; font-weight: bold; color: #fb7299; margin: 12px 0 6px 0; border-bottom: 1px dashed #f0f0f0; padding-bottom: 4px;}
            .bgm-section-title:first-child { margin-top: 0; }
            
            .bgm-staff-row { display: flex; margin-bottom: 4px; line-height: 1.5; font-size: 12px; }
            .bgm-staff-job { color: #409eff; font-weight: bold; width: 65px; flex-shrink: 0; text-align: right; margin-right: 10px; }
            .bgm-staff-names { flex: 1; color: #555; }
            .bgm-divider { color: #eee; margin: 0 4px; }
            
            .bgm-char-item { display: inline-block; font-size: 12px; margin: 0 10px 8px 0; background: #fdf5f6; padding: 3px 8px; border-radius: 4px; border: 1px solid #fbe5e9; }
            .bgm-cv-text { color: #999; font-size: 11px; margin-left: 2px; }
            .bgm-tag { display: inline-block; background: #f4f4f5; color: #606266; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin: 0 6px 6px 0; border: 1px solid #e4e7ed; }
            
            .bgm-link { color: #303133; text-decoration: none; transition: color 0.2s;}
            .bgm-link:hover { color: #fb7299; text-decoration: underline; }
        `;
        document.head.appendChild(style);

        widget = document.createElement('div');
        widget.id = 'bgm-ext-widget';
        document.body.appendChild(widget);

        minBtn = document.createElement('div');
        minBtn.id = 'bgm-ext-min-btn';
        minBtn.innerHTML = '🌸 展开 Bangumi 档案';
        document.body.appendChild(minBtn);

        widget.addEventListener('click', (e) => {
            if (e.target.id === 'bgm-btn-minimize') { widget.classList.add('minimized'); minBtn.classList.add('active'); }
        });
        minBtn.addEventListener('click', () => { minBtn.classList.remove('active'); widget.classList.remove('minimized'); });
    } else {
        // 如果窗口已存在，且开关是关闭的，并且当前状态是处于折叠中的，就保持折叠
        if (!autoExpand && widget.classList.contains('minimized')) {
            keepMinimized = true;
        }
    }

    if (keepMinimized) {
        widget.classList.add('minimized');
        minBtn.classList.add('active');
    } else {
        widget.classList.remove('minimized');
        minBtn.classList.remove('active');
    }

    widget.innerHTML = `
        <div class="bgm-ext-header">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:260px;" title="${title}">🌸 ${title}</span>
            <span class="bgm-btn-min" id="bgm-btn-minimize" title="折叠收起">▼ 折叠</span>
        </div>
        <div class="bgm-ext-body" id="bgm-ext-content">
            <div style="text-align:center; color:#fb7299; padding: 20px 0;">正在连接 Bangumi 数据库...</div>
        </div>
    `;
}

setInterval(() => {
    if (location.href !== lastUrl && location.href.includes('bilibili.com/bangumi/play/')) {
        lastUrl = location.href;
        setTimeout(triggerFetch, 1500); 
    }
}, 1000);