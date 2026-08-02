/**
 * Sidebar — enda nav-systemet
 * Drawer på mobil, fast sidebar på desktop
 */

const Sidebar = {

  NAV_ITEMS: [
    { section: 'Dashboard' },
    { id: 'pg-dash',        icon: 'dashboard',       label: 'Dashboard' },
    { id: 'pg-activities',  icon: 'bell',            label: 'Att göra',     badgeKey: 'activitiesOverdue' },
    { section: 'Arbete' },
    { id: 'pg-myjobs',      icon: 'briefcase',       label: 'Mina jobb',    badgeKey: 'myJobsToday' },
    { id: 'pg-ao',          icon: 'clipboard-list',  label: 'Arbetsorder',  badgeKey: 'aoNew' },
    { id: 'pg-operations',  icon: 'layout-dashboard',label: 'Dagens drift', badgeKey: 'operationsAlert' },
    { id: 'pg-recurring',   icon: 'refresh-cw',      label: 'Återkommande' },
    { id: 'pg-rondering',   icon: 'clipboard-check', label: 'Rondering' },
    { id: 'pg-calendar',    icon: 'calendar',        label: 'Kalender',     comingSoon: true },
    { section: 'Kund & Sälj' },
    { id: 'pg-crm',         icon: 'users',           label: 'Kunder' },
    { id: 'pg-objects',     icon: 'building-2',      label: 'Fastigheter',  badgeKey: 'serviceOverdue' },
    { id: 'pg-offer',       icon: 'file-text',       label: 'Offerter' },
    { id: 'pg-sales',       icon: 'target',          label: 'Säljchanser',  badgeKey: 'salesNew' },
    { id: 'pg-contracts',   icon: 'file-check',      label: 'Kontrakt',     comingSoon: true },
    { section: 'Ekonomi' },
    { id: 'pg-invoices',    icon: 'receipt',         label: 'Fakturering' },
    { id: 'pg-tid',         icon: 'clock',           label: 'Tid & stämpla' },
    { id: 'pg-payroll',     icon: 'wallet',          label: 'Löneunderlag', comingSoon: true },
    { id: 'pg-reports',     icon: 'bar-chart-2',     label: 'Rapporter',    comingSoon: true },
    { section: 'System' },
    { id: 'pg-articles',    icon: 'package',         label: 'Artiklar' },
    { id: 'pg-pricegroups', icon: 'dollar-sign',     label: 'Prisgrupper' },
    { id: 'pg-staff',       icon: 'user-cog',        label: 'Personal' },
    { id: 'pg-admin',       icon: 'settings',        label: 'Admin' }
  ],

  render() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;

    const user = state.currentUser;
    const initials = user
      ? (user.firstName || 'A').charAt(0) + (user.lastName || '').charAt(0)
      : 'VF';
    const userName = user ? `${user.firstName} ${user.lastName}`.trim() : 'VIFT';
    const userRole = user ? cap(user.role) : '';

    const _sidebarBg = (state.settings && state.settings.primaryColor) || '#0f3763';
    const brandLogo  = BrandingService.logoForBg(_sidebarBg);
    const collapsed  = document.body.classList.contains('sidebar-collapsed');
    let html = `
      <div class="nav-brand">
        <img src="${brandLogo}" class="nav-brand-img" alt="VIFT"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="nav-brand-fb" style="display:none;">
          <div class="nav-brand-fb-vift">VIFT</div>
          <div class="nav-brand-fb-sub">Fastighetsservice</div>
        </div>
        <button class="nav-collapse-btn" onclick="Sidebar.toggleCollapse()" title="${collapsed?'Expandera meny':'Fäll ihop meny'}">
          ${ic(collapsed?'chevrons-right':'chevrons-left', 14)}
        </button>
      </div>
      <div class="nav-scroll">`;

    let inSection = false;
    let sectionHasItems = false;
    let pendingSection  = '';

    this.NAV_ITEMS.forEach(item => {
      if (item.section) {
        // Close previous section if it had visible items
        if (inSection && sectionHasItems) html += '</div>';
        // Queue new section header — only written lazily when a visible item appears
        pendingSection = `<div class="nav-section"><div class="nav-section-label">${item.section}</div>`;
        inSection = true;
        sectionHasItems = false;
        return;
      }

      // Skip pages the user cannot access
      if (!Auth.canViewPage(item.id)) return;

      // Lazily flush pending section header before first visible item
      if (inSection && !sectionHasItems) {
        html += pendingSection;
        sectionHasItems = true;
      }

      const badge = this._getBadge(item.badgeKey);
      const badgeCls = this._isUrgentBadge(item.badgeKey) ? 'nbdg nbdg-alert' : 'nbdg';
      html += `
        <button class="ni" id="nav-${item.id}" onclick="Router.showPage('${item.id}')">
          <span class="ico">${ic(item.icon)}</span>
          <span class="lbl">${item.label}</span>
          ${item.comingSoon ? '<span class="nbdg-soon">Snart</span>' : (badge ? `<span class="${badgeCls}">${badge}</span>` : '')}
        </button>`;
    });

    // Close the last section if it had items
    if (inSection && sectionHasItems) html += '</div>';

    const unread = (typeof NotificationsService !== 'undefined') ? NotificationsService.unreadCount() : 0;
    html += `
      </div><!-- /nav-scroll -->
      <div class="nav-user">
        <div class="nav-bell-row" onclick="NotificationsService.showPanel()" title="Notiser" style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.1);">
          <span>${ic('bell', 15)}</span>
          <span style="flex:1;font-size:12px;font-weight:600;color:rgba(255,255,255,.8);">Notiser</span>
          ${unread > 0 ? `<span class="nbdg nbdg-alert" id="notif-badge">${unread}</span>` : `<span id="notif-badge" style="display:none;"></span>`}
        </div>
        <div class="nav-user-row" onclick="Sidebar.userMenu()">
          <div class="nav-user-avatar">${initials}</div>
          <div style="flex:1;min-width:0;">
            <div class="nav-user-name">${userName}</div>
            ${userRole ? `<div class="nav-user-role">${userRole}</div>` : ''}
          </div>
          <span style="color:rgba(255,255,255,.35);">${ic('log-out', 14)}</span>
        </div>
      </div>`;

    nav.innerHTML = html;
  },

  setActive(pageId) {
    document.querySelectorAll('#bottom-nav .ni').forEach(el => el.classList.remove('on'));
    const btn = document.getElementById(`nav-${pageId}`);
    if (btn) btn.classList.add('on');
  },

  open() {
    document.getElementById('bottom-nav').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  },

  close() {
    document.getElementById('bottom-nav').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  },

  toggle() {
    document.getElementById('bottom-nav').classList.contains('open')
      ? this.close() : this.open();
  },

  toggleCollapse() {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    const user = Auth.getUser ? Auth.getUser() : state.currentUser;
    if (user) UserPrefsService.save(user.id, { sidebarCollapsed: collapsed });
    // Re-render just the brand area to flip the chevron icon
    this.render();
  },

  userMenu() {
    Modal.open({
      title: state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}` : 'Användare',
      body: `<p style="font-size:13px;color:var(--mt);margin-bottom:4px;">Roll: ${state.currentUser ? cap(state.currentUser.role) : '—'}</p>
             <p style="font-size:13px;color:var(--mt);">Inloggad: ${state.currentUser ? state.currentUser.username : '—'}</p>`,
      buttons: [
        { label: `${ic('settings',14)} Mina inställningar`, cls: 'btn bs bfull', onClick: () => { Modal.close(); Sidebar.showSettings(); } },
        { label: 'Logga ut', cls: 'btn bd bfull', onClick: () => { Modal.close(); Auth.logout(); } },
        { label: 'Avbryt',   cls: 'btn bs',        onClick: () => Modal.close() }
      ]
    });
  },

  showSettings() {
    const uid = state.currentUser ? state.currentUser.id : null;
    if (!uid) return;
    const p   = UserPrefsService.get(uid);
    const pos = p.sidebarPosition || 'left';
    const den = p.density || 'normal';
    const acc = p.accentColor || '';

    Modal.open({
      title: 'Mina inställningar',
      body: `
        <div class="fg">
          <label style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Sidopanelens position</label>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button id="pref-pos-left"  class="btn bsm ${pos==='left' ?'bp':'bs'}" style="flex:1;" onclick="Sidebar._setPref('sidebarPosition','left','pos')">${ic('panel-left',14)} Vänster</button>
            <button id="pref-pos-right" class="btn bsm ${pos==='right'?'bp':'bs'}" style="flex:1;" onclick="Sidebar._setPref('sidebarPosition','right','pos')">${ic('panel-left-open',14)} Höger</button>
          </div>
        </div>
        <div class="fg" style="margin-top:14px;">
          <label style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Täthet</label>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button id="pref-den-compact" class="btn bsm ${den==='compact'?'bp':'bs'}" style="flex:1;" onclick="Sidebar._setPref('density','compact','den')">Kompakt</button>
            <button id="pref-den-normal"  class="btn bsm ${den==='normal' ?'bp':'bs'}" style="flex:1;" onclick="Sidebar._setPref('density','normal', 'den')">Normal</button>
            <button id="pref-den-airy"    class="btn bsm ${den==='airy'   ?'bp':'bs'}" style="flex:1;" onclick="Sidebar._setPref('density','airy',   'den')">Luftig</button>
          </div>
        </div>
        <div class="fg" style="margin-top:14px;">
          <label style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Accentfärg</label>
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;">
            <input type="color" id="pref-accent-input" value="${acc || '#2b7fd4'}"
              style="width:44px;height:36px;border-radius:6px;border:1.5px solid var(--br);cursor:pointer;padding:2px;"
              oninput="Sidebar._setPref('accentColor',this.value)">
            <button class="btn bxs bs" onclick="Sidebar._setPref('accentColor','');document.getElementById('pref-accent-input').value='#2b7fd4'">Återställ</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <button class="btn bs bxs" style="pointer-events:none;min-width:110px;">Aa Förhandsgranskning</button>
            <span style="font-size:10px;color:var(--mt);">Exempelknapp med vald accent</span>
          </div>
        </div>
        <div class="fg" style="margin-top:14px;">
          <label style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Sidopanel vid start</label>
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer;font-size:13px;color:var(--tx);">
            <input type="checkbox" ${p.sidebarCollapsed?'checked':''} onchange="Sidebar._setPref('sidebarCollapsed',this.checked)">
            Fäll ihop vid inloggning
          </label>
        </div>
      `,
      buttons: [
        { label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _setPref(key, value, group) {
    const uid = state.currentUser ? state.currentUser.id : null;
    if (!uid) return;
    if (key === 'accentColor') {
      UserPrefsService.saveAccent(uid, value);
    } else {
      UserPrefsService.save(uid, { [key]: value });
      UserPrefsService.apply(uid);
    }
    Sidebar.render();
    if (group === 'pos') {
      ['left','right'].forEach(v => {
        const btn = document.getElementById('pref-pos-' + v);
        if (btn) { btn.classList.toggle('bp', v === value); btn.classList.toggle('bs', v !== value); }
      });
    }
    if (group === 'den') {
      ['compact','normal','airy'].forEach(v => {
        const btn = document.getElementById('pref-den-' + v);
        if (btn) { btn.classList.toggle('bp', v === value); btn.classList.toggle('bs', v !== value); }
      });
    }
  },

  updateBadges() {
    [
      { key: 'aoNew',              navId: 'nav-pg-ao' },
      { key: 'salesNew',           navId: 'nav-pg-sales' },
      { key: 'activitiesOverdue',  navId: 'nav-pg-activities' },
      { key: 'operationsAlert',    navId: 'nav-pg-operations' },
      { key: 'serviceOverdue',     navId: 'nav-pg-objects' }
    ].forEach(({ key, navId }) => {
      const badge  = this._getBadge(key);
      const navBtn = document.getElementById(navId);
      if (!navBtn) return;
      let el = navBtn.querySelector('.nbdg');
      if (badge) {
        if (!el) {
          el = document.createElement('span');
          el.className = this._isUrgentBadge(key) ? 'nbdg nbdg-alert' : 'nbdg';
          navBtn.appendChild(el);
        } else {
          el.className = this._isUrgentBadge(key) ? 'nbdg nbdg-alert' : 'nbdg';
        }
        el.textContent = badge;
        el.style.display = '';
      } else if (el) {
        el.style.display = 'none';
      }
    });
    // Update notification bell badge
    const notifBadgeEl = document.getElementById('notif-badge');
    if (notifBadgeEl) {
      const unread = (typeof NotificationsService !== 'undefined') ? NotificationsService.unreadCount() : 0;
      if (unread > 0) {
        notifBadgeEl.className = 'nbdg nbdg-alert';
        notifBadgeEl.textContent = unread;
        notifBadgeEl.style.display = '';
      } else {
        notifBadgeEl.style.display = 'none';
      }
    }
  },

  _isUrgentBadge(key) {
    return key === 'activitiesOverdue' || key === 'operationsAlert' || key === 'serviceOverdue';
  },

  _getBadge(key) {
    if (!key) return null;
    if (key === 'myJobsToday') {
      const myId = state.currentUser ? state.currentUser.id : null;
      if (!myId) return null;
      const today = tdy();
      const n = (state.workOrders || []).filter(ao =>
        !ao.archived && !ao.deleted &&
        (ao.staff || []).includes(myId) &&
        ao.scheduledDate === today &&
        !['klar','fakturerad','avbruten'].includes(ao.status)
      ).length;
      return n > 0 ? n : null;
    }
    if (key === 'aoNew') {
      const n = (state.workOrders || []).filter(o => o.status === 'nytt' && !o.archived && !o.deleted).length;
      return n > 0 ? n : null;
    }
    if (key === 'salesNew') {
      const n = (state.salesOpportunities || []).filter(function(s) {
        return ['new', 'contacted', 'contact_needed'].includes(s.status);
      }).length;
      return n > 0 ? n : null;
    }
    if (key === 'activitiesOverdue') {
      const today = tdy();
      const n = (state.activities || []).filter(a => a.status === 'open' && a.dueDate && a.dueDate <= today).length;
      return n > 0 ? n : null;
    }
    if (key === 'operationsAlert') {
      const today = tdy();
      const all   = (state.workOrders || []).filter(ao => !ao.archived && !ao.deleted);
      const alive = ao => !['klar','fakturerad','avbruten'].includes(ao.status);
      const n = all.filter(ao =>
        (ao.scheduledDate && ao.scheduledDate < today && alive(ao) && ao.status !== 'pool') ||
        (ao.priority === 'akut' && alive(ao)) ||
        ((ao.staff||[]).length === 0 && alive(ao) && !['pool','avbruten'].includes(ao.status))
      ).length;
      return n > 0 ? n : null;
    }
    if (key === 'notifications') {
      const n = (typeof NotificationsService !== 'undefined') ? NotificationsService.unreadCount() : 0;
      return n > 0 ? n : null;
    }
    if (key === 'serviceOverdue') {
      if (typeof ServiceIntervalService === 'undefined') return null;
      const n = ServiceIntervalService.countGlobalAlert();
      return n > 0 ? n : null;
    }
    return null;
  }
};

// Re-render sidebar whenever branding changes (logo upload etc.)
document.addEventListener('brandingUpdated', () => Sidebar.render());
