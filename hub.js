let allWallpapers = [];
    let currentFilter = 'all';
    let selectedWp = null;
    let activeWorkshopId = '';

    // 初始化加载
    window.addEventListener('DOMContentLoaded', () => {
      fetchWallpapers();
      initSearch();
      initSliders();
      document.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'refresh') fetchWallpapers(true);
        else if (action === 'close') closeDrawer();
        else if (action === 'reset') resetSliders();
        else if (action === 'apply') applyWallpaper();
        else if (action === 'open-folder') openCurrentDir();
        const filter = event.target.closest('[data-type]')?.dataset.type;
        if (filter) setFilter(filter);
        const id = event.target.closest('[data-wallpaper-id]')?.dataset.wallpaperId;
        if (id) openInspector(id);
      });
      document.addEventListener('input', event => {
        if (event.target.matches('input.hub-slider')) updatePreview();
      });
      document.addEventListener('error', event => {
        if (event.target.matches('img[data-preview]')) event.target.style.visibility = 'hidden';
      }, true);
    });

    async function fetchWallpapers(force = false) {
      document.getElementById('statBadge').textContent = '正在极速扫描壁纸库...';
      try {
        const res = await fetch('/api/wallpapers' + (force ? '?refresh=1' : ''));
        const data = await res.json();
        allWallpapers = data.wallpapers || [];
        activeWorkshopId = data.activeId || '';

        // 更新统计计数
        document.getElementById('countAll').textContent = allWallpapers.length;
        document.getElementById('countScene').textContent = allWallpapers.filter(w => w.type === 'scene').length;
        document.getElementById('countVideo').textContent = allWallpapers.filter(w => w.type === 'video').length;
        document.getElementById('countWeb').textContent = allWallpapers.filter(w => w.type === 'web').length;
        document.getElementById('statBadge').textContent = allWallpapers.length + ' 款已订阅壁纸已就绪';

        renderGrid();
      } catch(e) {
        document.getElementById('statBadge').textContent = '扫描失败: ' + e.message;
      }
    }

    function initSearch() {
      const input = document.getElementById('searchInput');
      input.addEventListener('input', () => {
        renderGrid();
      });
    }

    function setFilter(type) {
      currentFilter = type;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.type === type) {
          btn.classList.add('bg-blue-600', 'text-white');
          btn.classList.remove('bg-[#161c2a]', 'text-slate-300');
        } else {
          btn.classList.remove('bg-blue-600', 'text-white');
          btn.classList.add('bg-[#161c2a]', 'text-slate-300');
        }
      });
      renderGrid();
    }

    function renderGrid() {
      const query = document.getElementById('searchInput').value.trim().toLowerCase();
      const grid = document.getElementById('grid');
      const emptyTip = document.getElementById('emptyTip');

      let list = allWallpapers.filter(item => {
        // 类型过滤
        if (currentFilter === 'scene' && item.type !== 'scene') return false;
        if (currentFilter === 'video' && item.type !== 'video') return false;
        if (currentFilter === 'web' && item.type !== 'web') return false;
        if (currentFilter === 'active' && item.id !== activeWorkshopId) return false;

        // 搜索关键词
        if (query) {
          return item.title.toLowerCase().includes(query) || item.id.includes(query);
        }
        return true;
      });

      if (list.length === 0) {
        grid.innerHTML = '';
        emptyTip.classList.remove('hidden');
        return;
      }

      emptyTip.classList.add('hidden');
      grid.innerHTML = list.map(item => {
        const isActive = item.id === activeWorkshopId;
        const typeColor = item.type === 'video' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                         item.type === 'web' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                         'bg-blue-500/20 text-blue-300 border-blue-500/30';
        const typeLabel = item.type === 'video' ? '视频' : item.type === 'web' ? '网页' : '场景';

        return `
          <div data-wallpaper-id="${item.id}" class="group relative rounded-2xl bg-card border ${isActive ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-cardBorder hover:border-blue-500/60'} overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 flex flex-col">
            <!-- 缩略图容器 -->
            <div class="relative aspect-video w-full overflow-hidden bg-black/30 card-zoom">
              <img src="/api/preview/${item.id}" loading="lazy" data-preview class="w-full h-full object-cover transition-transform duration-300" />

              <!-- 标签徽章 -->
              <div class="absolute top-2 right-2 flex items-center gap-1">
                ${item.hasAnimated ? '<span class="px-1.5 py-0.5 rounded-md bg-cyan-500/80 text-white font-mono text-[9px] shadow-sm font-bold">60帧超清</span>' : ''}
                <span class="px-1.5 py-0.5 rounded-md text-[10px] font-medium border backdrop-blur-md ${typeColor}">${typeLabel}</span>
              </div>

              ${isActive ? '<div class="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-emerald-500 text-black font-bold text-[10px] shadow-lg flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-black animate-pulse"></span>已生效</div>' : ''}
            </div>

            <!-- 卡片文本 -->
            <div class="p-3 flex-1 flex flex-col justify-between">
              <h3 class="text-xs font-semibold text-slate-200 line-clamp-1 group-hover:text-blue-400 transition" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
              <div class="mt-2 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>ID: ${item.id}</span>
                <span class="text-blue-400/80 opacity-0 group-hover:opacity-100 transition">配置 →</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 打开参数调参抽屉
    async function openInspector(id) {
      selectedWp = allWallpapers.find(w => w.id === id);
      if (!selectedWp) return;

      document.getElementById('drawerTitle').textContent = selectedWp.title;
      document.getElementById('drawerTypeBadge').textContent = selectedWp.type.toUpperCase();
      document.getElementById('drawerPreviewImg').src = '/api/preview/' + selectedWp.id;
      document.getElementById('steamLink').href = 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + selectedWp.id;

      // 读取并还原当前配置
      try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        if (selectedWp.id === cfg.workshopId) {
          document.getElementById('sliderOpacity').value = Math.round((cfg.opacity ?? 0.68) * 100);
          document.getElementById('sliderBlur').value = cfg.blur ?? 0;
          document.getElementById('sliderBrightness').value = cfg.brightness ?? 105;
          document.getElementById('sliderContrast').value = cfg.contrast ?? 110;
          document.getElementById('sliderSaturate').value = cfg.saturate ?? 110;
          document.getElementById('sliderDarken').value = cfg.darken ?? 18;
        } else {
          resetSliders();
        }
      } catch(e) {
        resetSliders();
      }

      updatePreview();
      document.getElementById('drawer').classList.remove('translate-x-full');
    }

    function closeDrawer() {
      document.getElementById('drawer').classList.add('translate-x-full');
    }

    function resetSliders() {
      document.getElementById('sliderOpacity').value = 68;
      document.getElementById('sliderBlur').value = 0;
      document.getElementById('sliderBrightness').value = 105;
      document.getElementById('sliderContrast').value = 110;
      document.getElementById('sliderSaturate').value = 110;
      document.getElementById('sliderDarken').value = 18;
      updatePreview();
    }

    function updatePreview() {
      const op = document.getElementById('sliderOpacity').value;
      const blur = document.getElementById('sliderBlur').value;
      const br = document.getElementById('sliderBrightness').value;
      const ct = document.getElementById('sliderContrast').value;
      const sat = document.getElementById('sliderSaturate').value;
      const dark = document.getElementById('sliderDarken').value;

      document.getElementById('valOpacity').textContent = op + '%';
      document.getElementById('valBlur').textContent = blur + ' px';
      document.getElementById('valBrightness').textContent = br + '%';
      document.getElementById('valContrast').textContent = ct + '%';
      document.getElementById('valSaturate').textContent = sat + '%';
      document.getElementById('valDarken').textContent = dark + '%';

      // 实时更新每一个滑块的轨道着色进度百分比
      [document.getElementById('sliderOpacity'),
       document.getElementById('sliderBlur'),
       document.getElementById('sliderBrightness'),
       document.getElementById('sliderContrast'),
       document.getElementById('sliderSaturate'),
       document.getElementById('sliderDarken')].forEach(s => {
         if (!s) return;
         const min = parseFloat(s.min) || 0;
         const max = parseFloat(s.max) || 100;
         const pct = ((s.value - min) / (max - min)) * 100;
         s.style.setProperty('--progress', pct + '%');
       });

      const img = document.getElementById('drawerPreviewImg');
      const mask = document.getElementById('drawerMask');

      img.style.opacity = op / 100;
      img.style.filter = `blur(${blur}px) brightness(${br}%) contrast(${ct}%) saturate(${sat}%)`;
      mask.style.background = `radial-gradient(circle at center, rgba(10,13,20,${(dark/100)*0.4}) 0%, rgba(10,13,20,${Math.min(1, (dark/100)+0.35)}) 100%)`;
    }

    // 初始化滑块拖拽捕获与流畅度增强
    function initSliders() {
      const sliders = document.querySelectorAll('input[type="range"].hub-slider');
      sliders.forEach(slider => {
        slider.draggable = false;
        slider.addEventListener('dragstart', (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        });

        // 增强指针拖拽支持：利用 PointerCapture 确保无论鼠标移得多快或移出元素，都能 100% 丝滑连续捕获拖拽
        const updateFromPointer = (e) => {
          const rect = slider.getBoundingClientRect();
          if (rect.width <= 0) return;
          const min = parseFloat(slider.min) || 0;
          const max = parseFloat(slider.max) || 100;
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const step = parseFloat(slider.step) || 1;
          const rawVal = min + ratio * (max - min);
          const steppedVal = Math.round(rawVal / step) * step;
          if (String(slider.value) !== String(steppedVal)) {
            slider.value = steppedVal;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };

        slider.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return; // 仅左键响应
          try { slider.setPointerCapture(e.pointerId); } catch(_) {}
          updateFromPointer(e);

          const onPointerMove = (ev) => {
            if (ev.buttons === 1) {
              updateFromPointer(ev);
            }
          };

          const onPointerUp = (ev) => {
            try { slider.releasePointerCapture(ev.pointerId); } catch(_) {}
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
          };

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        });
      });

      updatePreview();
    }

    // 一键应用壁纸
    async function applyWallpaper() {
      if (!selectedWp) return;
      const btn = document.getElementById('btnApply');
      const oldHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> 正在打包注入 app.asar...';

      const payload = {
        workshopId: selectedWp.id,
        opacity: parseInt(document.getElementById('sliderOpacity').value) / 100,
        blur: parseInt(document.getElementById('sliderBlur').value),
        brightness: parseInt(document.getElementById('sliderBrightness').value),
        contrast: parseInt(document.getElementById('sliderContrast').value),
        saturate: parseInt(document.getElementById('sliderSaturate').value),
        darken: parseInt(document.getElementById('sliderDarken').value),
        autoRestart: document.getElementById('chkAutoRestart').checked
      };

      try {
        const res = await fetch('/api/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success && data.substituted) {
          // 引擎拒绝了所选壁纸（低清预览/视频未下载完），实际生效的是上一张
          showToast('所选壁纸未能应用：' + data.warnings.join(' '), 'error', 12000);
        } else if (data.success) {
          activeWorkshopId = selectedWp.id;
          renderGrid();
          showToast(data.message, 'success');
        } else {
          showToast('应用失败: ' + (data.error || '未知错误'), 'error');
        }
      } catch(e) {
        if (payload.autoRestart && e instanceof TypeError) {
          // 勾选了自动重启时，连接被客户端重载瞬间掐断属于预期情况
          activeWorkshopId = selectedWp.id;
          renderGrid();
          showToast('指令已提交，客户端正在重载，请稍候…（若长时间未启动请手动打开）', 'success');
        } else {
          showToast('请求异常: ' + e.message, 'error');
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    }

    function openCurrentDir() {
      if (selectedWp && selectedWp.id) {
        fetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedWp.id })
        });
      }
    }

    function showToast(text, type = 'success', duration = 4000) {
      const toast = document.getElementById('toast');
      toast.textContent = text;
      toast.className = 'fixed bottom-6 right-6 z-50 transition-all duration-300 px-4 py-3 rounded-xl text-sm font-semibold shadow-2xl flex items-center gap-2 ' +
        (type === 'success' ? 'bg-emerald-600 text-white shadow-emerald-500/20' : 'bg-red-600 text-white shadow-red-500/20');
      toast.classList.remove('translate-y-20', 'opacity-0');
      setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
      }, duration);
    }
