const CORE_ROLES = ["原作", "总导演", "导演", "监督", "系列构成", "脚本", "角色设计", "总作画监督", "作画监督", "音乐"];

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

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchBtn').addEventListener('click', executeSearch);
    document.getElementById('clearBtn').addEventListener('click', () => { document.getElementById('searchInput').value = ''; });

    // 🌟 新增：监听输入框的回车事件
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            executeSearch();
        }
    });

    // 🌟 新增：加载并绑定“自动展开”的开关设置
    const toggle = document.getElementById('autoExpandToggle');
    chrome.storage.local.get(['autoExpand'], function(result) {
        if (result.autoExpand !== undefined) toggle.checked = result.autoExpand;
    });
    toggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ autoExpand: e.target.checked });
    });

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const tokenArea = document.getElementById('tokenArea');
        if (tabs && tabs[0] && tabs[0].title) {
            let cleanTitle = tabs[0].title.replace(/_哔哩哔哩_bilibili|-番剧|-视频/g, ' ');
            const tokens = cleanTitle.match(/[a-zA-Z0-9]+|[\u4E00-\u9FA5\u3040-\u309F\u30A0-\u30FF]/g) || [];
            
            tokenArea.innerHTML = '';
            if(tokens.length === 0) {
                tokenArea.innerHTML = '<span style="color:#ccc; font-size: 12px;">未提取到有效字词</span>';
                return;
            }
            tokens.forEach(t => {
                let chip = document.createElement('span');
                chip.className = 'token-chip';
                chip.innerText = t;
                chip.addEventListener('click', () => { 
                    document.getElementById('searchInput').value += t; 
                });
                tokenArea.appendChild(chip);
            });
        } else {
            tokenArea.innerHTML = '<span style="color:#ccc; font-size: 12px;">无法读取标题</span>';
        }
    });
});

async function executeSearch() {
    let keyword = document.getElementById('searchInput').value.trim();
    const resultDiv = document.getElementById('result');
    if(!keyword) return;

    keyword = keyword.replace(/[!~！？?*★☆\-、，：:]/g, ' ').replace(/\s+/g, ' ').trim();

    resultDiv.innerHTML = "<div style='color:#fb7299; text-align:center; padding: 20px;'>✨ 正在跨次元抓取档案...</div>";
    try {
        const searchData = await bgmFetch(`https://api.bgm.tv/search/subject/${encodeURIComponent(keyword)}`);
        if (!searchData || !searchData.list || searchData.list.length === 0) {
            resultDiv.innerHTML = "<div style='text-align:center; color:#999;'>未找到相关作品</div>";
            return;
        }
        
        const mainItem = searchData.list.find(item => item.type === 2 || item.type === 6);
        if (!mainItem) {
            resultDiv.innerHTML = "<div style='text-align:center; color:#999;'>未找到相关的动画或三次元节目</div>";
            return;
        }
        
        const mainId = mainItem.id;
        const relationsData = await bgmFetch(`https://api.bgm.tv/v0/subjects/${mainId}/subjects`);
        let seriesIds = new Set([mainId]);
        if (relationsData) {
            relationsData.filter(r => r.type === 2 || r.type === 6).forEach(r => seriesIds.add(r.id));
        }
        
        const idArray = Array.from(seriesIds).slice(0, 6); 
        
        const allInfo = await Promise.all(idArray.map(async (id, index) => {
            const [detail, persons, characters] = await Promise.all([
                bgmFetch(`https://api.bgm.tv/v0/subjects/${id}`),
                bgmFetch(`https://api.bgm.tv/v0/subjects/${id}/persons`),
                bgmFetch(`https://api.bgm.tv/v0/subjects/${id}/characters`) 
            ]);
            let relationName = index === 0 ? "目标匹配" : (relationsData.find(r => r.id === id)?.relation || "关联");
            return { isMain: index === 0, relation: relationName, detail, persons, characters };
        }));

        allInfo.sort((a, b) => {
            if (a.isMain) return -1; if (b.isMain) return 1;
            if (!a.detail.date) return 1; if (!b.detail.date) return -1;
            return new Date(a.detail.date) - new Date(b.detail.date);
        });

        resultDiv.innerHTML = allInfo.map(info => {
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
                        
                        <div class="bgm-section-title">🎤 主要角色与声优</div>
                        <div>${charsHtml || '<div style="color:#999;font-size:12px;margin-bottom:10px;">暂无角色数据</div>'}</div>
                        
                        <div class="bgm-section-title">🏷️ 常用标签</div>
                        <div>${tagsHtml || '<div style="color:#999;font-size:12px;">暂无标签</div>'}</div>

                        <div style="margin-top:15px; border-top: 1px dashed #f0f0f0; padding-top: 10px; text-align: center;">
                            <a class="bgm-link" href="https://bgm.tv/subject/${d.id}" target="_blank" style="color:#00a1d6; font-weight:bold;">🔗 在 Bangumi 查看完整页面 ↗</a>
                        </div>
                    </div>
                </details>`;
        }).join('');

    } catch (e) {
        resultDiv.innerHTML = "<div style='color:red; text-align:center;'>请求异常，请稍后重试</div>";
    }
}