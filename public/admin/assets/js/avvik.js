'use strict';

document.addEventListener('DOMContentLoaded', async function () {

    // ---------------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------------
    const state = {
        items: [],
        total: 0,
        currentDetail: null,
        technicians: [],
        pagination: { limit: 50, offset: 0 },
        filters: {
            status: ['open', 'assigned', 'in_progress', 'fixed_pending_verification'],
            severity: [],
            dateFrom: null,
            dateTo: null,
            sort: 'severity_desc_opened_asc'
        }
    };
    window._avvikState = state;

    // ---------------------------------------------------------------------------
    // Element refs
    // ---------------------------------------------------------------------------
    const el = {
        tableBody: document.getElementById('deviations-table-body'),
        pagination: document.getElementById('deviations-pagination'),
        filterStatus: document.getElementById('filter-status'),
        filterSeverity: document.getElementById('filter-severity'),
        filterDateFrom: document.getElementById('filter-date-from'),
        filterDateTo: document.getElementById('filter-date-to'),
        filterSort: document.getElementById('filter-sort'),
        globalError: document.getElementById('avvik-global-error'),
        detailPanel: document.getElementById('avvik-detail-panel'),
        detailBackdrop: document.getElementById('avvik-detail-backdrop'),
        detailBody: document.getElementById('avvik-detail-body'),
        detailTitle: document.getElementById('detail-title'),
        assignTechnician: document.getElementById('assign-technician'),
        deadlineInput: document.getElementById('deadline-input'),
        severityInput: document.getElementById('severity-input'),
        closureMode: document.getElementById('closure-mode'),
        closureComment: document.getElementById('closure-comment'),
        lightbox: document.getElementById('avvik-lightbox'),
        lightboxImg: document.getElementById('avvik-lightbox-img')
    };

    // ---------------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------------
    await initialize();

    async function initialize() {
        await loadTechnicians();
        setupEventListeners();
        await loadDeviations();
    }

    // ---------------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------------
    async function loadTechnicians() {
        try {
            const res = await fetch('/api/admin/technicians', { credentials: 'include' });
            if (res.ok) {
                state.technicians = await res.json();
                populateTechnicianDropdown();
            }
        } catch (_) {
            // Non-fatal — tildeling vises uten tekniker-liste
        }
    }

    function populateTechnicianDropdown() {
        const select = el.assignTechnician;
        // Clear all except first (-- Ingen --)
        while (select.options.length > 1) select.remove(1);
        state.technicians.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            select.appendChild(opt);
        });
    }

    async function loadDeviations() {
        showGlobalError(null);
        el.tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#9CA3AF;padding:24px;">Laster...</td></tr>';
        try {
            const params = buildQueryString();
            const res = await fetch(`/api/admin/deviations?${params}`, { credentials: 'include' });
            if (!res.ok) {
                showGlobalError('Kunne ikke laste avvik');
                el.tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#B91C1C;padding:24px;">Feil ved lasting</td></tr>';
                return;
            }
            const data = await res.json();
            state.items = data.items;
            state.total = data.total;
            renderTable();
            renderPagination();
        } catch (err) {
            showGlobalError('Nettverksfeil — prøv igjen');
            el.tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#B91C1C;padding:24px;">Nettverksfeil</td></tr>';
        }
    }

    async function loadDetail(id) {
        try {
            const res = await fetch(`/api/admin/deviations/${id}`, { credentials: 'include' });
            if (res.status === 404) { showGlobalError('Avvik ikke funnet'); return; }
            if (!res.ok) { showGlobalError('Noe gikk galt'); return; }
            state.currentDetail = await res.json();
            renderDetailPanel();
            openDetailPanel();
        } catch (_) {
            showGlobalError('Nettverksfeil — prøv igjen');
        }
    }

    async function updateDeviation(id, patch) {
        try {
            const res = await fetch(`/api/admin/deviations/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(patch)
            });
            if (res.status === 400) {
                const body = await res.json();
                return { ok: false, error: body.error || 'Ugyldig forespørsel' };
            }
            if (res.status === 404) return { ok: false, error: 'Avvik ikke funnet' };
            if (!res.ok) return { ok: false, error: 'Noe gikk galt' };
            // Reload both detail and list
            await loadDetail(id);
            await loadDeviations();
            return { ok: true };
        } catch (_) {
            return { ok: false, error: 'Nettverksfeil — prøv igjen' };
        }
    }

    // ---------------------------------------------------------------------------
    // Query builder
    // ---------------------------------------------------------------------------
    function buildQueryString() {
        const p = new URLSearchParams();
        if (state.filters.status.length) p.set('status', state.filters.status.join(','));
        if (state.filters.severity.length) p.set('severity', state.filters.severity.join(','));
        if (state.filters.dateFrom) p.set('dateFrom', state.filters.dateFrom);
        if (state.filters.dateTo) p.set('dateTo', state.filters.dateTo);
        p.set('sort', state.filters.sort);
        p.set('limit', state.pagination.limit);
        p.set('offset', state.pagination.offset);
        return p.toString();
    }

    // ---------------------------------------------------------------------------
    // Render table
    // ---------------------------------------------------------------------------
    function renderTable() {
        if (!state.items.length) {
            el.tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#9CA3AF;padding:32px;">Ingen avvik funnet</td></tr>';
            return;
        }
        el.tableBody.innerHTML = state.items.map(d => `
            <tr data-id="${d.id}" onclick="window._avvikOpenDetail(${d.id})" style="cursor:pointer;">
                <td>${escHtml(d.equipmentName || '—')}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(d.checklistItemLabel || '')}">${escHtml(d.checklistItemLabel || '—')}</td>
                <td><span class="avvik-badge ${getStatusBadgeClass(d.status)}">${escHtml(formatStatusLabel(d.status))}</span></td>
                <td><span class="avvik-badge ${getSeverityBadgeClass(d.severity)}">${escHtml(formatSeverityLabel(d.severity))}</span></td>
                <td>${formatDate(d.openedAt)}</td>
                <td>${formatDaysOpen(d.daysOpen)}</td>
                <td style="text-align:center;">${d.observationCount}</td>
                <td>${escHtml(d.assignedToName || '—')}</td>
                <td>${d.deadline ? formatDate(d.deadline) : '—'}</td>
            </tr>
        `).join('');
    }

    // ---------------------------------------------------------------------------
    // Render pagination
    // ---------------------------------------------------------------------------
    function renderPagination() {
        const { limit, offset } = state.pagination;
        const total = state.total;
        if (total === 0) { el.pagination.innerHTML = ''; return; }
        const page = Math.floor(offset / limit) + 1;
        const pages = Math.ceil(total / limit);
        el.pagination.innerHTML = `
            <span>Side ${page} av ${pages} (${total} avvik)</span>
            <div style="display:flex;gap:6px;">
                <button onclick="window._avvikPrevPage()" ${offset === 0 ? 'disabled' : ''}>&#8592; Forrige</button>
                <button onclick="window._avvikNextPage()" ${offset + limit >= total ? 'disabled' : ''}>Neste &#8594;</button>
            </div>
        `;
    }

    // ---------------------------------------------------------------------------
    // Detail panel
    // ---------------------------------------------------------------------------
    function renderDetailPanel() {
        const d = state.currentDetail;
        if (!d) return;
        el.detailTitle.textContent = `Avvik #${d.id}`;
        el.detailBody.innerHTML = `
            <div class="avvik-detail-section">
                <h4>Oversikt</h4>
                <div class="avvik-detail-grid">
                    <div class="avvik-detail-field"><label>Status</label><span><span class="avvik-badge ${getStatusBadgeClass(d.status)}">${escHtml(formatStatusLabel(d.status))}</span></span></div>
                    <div class="avvik-detail-field"><label>Alvorlighet</label><span><span class="avvik-badge ${getSeverityBadgeClass(d.severity)}">${escHtml(formatSeverityLabel(d.severity))}</span></span></div>
                    <div class="avvik-detail-field"><label>Utstyr</label><span>${escHtml(d.equipmentName || '—')}</span></div>
                    <div class="avvik-detail-field"><label>Åpnet</label><span>${formatDate(d.openedAt)} (${formatDaysOpen(d.daysOpen)})</span></div>
                    <div class="avvik-detail-field"><label>Tildelt</label><span>${escHtml(d.assignedToName || '—')}</span></div>
                    <div class="avvik-detail-field"><label>Deadline</label><span>${d.deadline ? formatDate(d.deadline) : '—'}</span></div>
                    ${d.closedAt ? `<div class="avvik-detail-field"><label>Lukket</label><span>${formatDate(d.closedAt)}</span></div>` : ''}
                    ${d.closureMode ? `<div class="avvik-detail-field"><label>Lukkeårsak</label><span>${escHtml(formatClosureMode(d.closureMode))}</span></div>` : ''}
                </div>
                ${d.currentSummary ? `<div style="margin-top:10px;font-size:13px;color:#374151;">${escHtml(d.currentSummary)}</div>` : ''}
                ${d.closureComment ? `<div style="margin-top:8px;font-size:13px;color:#6B7280;font-style:italic;">${escHtml(d.closureComment)}</div>` : ''}
            </div>

            ${d.observations && d.observations.length ? `
            <div class="avvik-detail-section">
                <h4>Tidslinje (${d.observations.length} observasjoner)</h4>
                ${d.observations.map(o => `
                    <div class="avvik-obs-item">
                        <div class="avvik-obs-meta">${formatDate(o.observedAt)} &mdash; ${escHtml(o.observedByName || o.observedByUserId || 'Ukjent')} &mdash; <span class="avvik-badge ${getSeverityBadgeClass(o.severity)}">${escHtml(formatSeverityLabel(o.severity))}</span></div>
                        <div>${escHtml(o.comment || '')}</div>
                    </div>
                `).join('')}
            </div>` : ''}

            ${d.images && d.images.length ? `
            <div class="avvik-detail-section">
                <h4>Bilder (${d.images.length})</h4>
                <div class="avvik-img-grid">
                    ${d.images.map(img => `
                        <img class="avvik-img-thumb" src="${escHtml(img.url)}" alt="Avviksbilde" onclick="window._avvikOpenLightbox('${escHtml(img.url)}')" loading="lazy">
                    `).join('')}
                </div>
            </div>` : ''}

            ${d.status !== 'closed' ? `
            <div class="avvik-detail-section">
                <h4>Handlinger</h4>
                <div class="avvik-actions">
                    <button class="avvik-btn avvik-btn-outline" onclick="window._avvikOpenAssign()" type="button">Tildel tekniker</button>
                    <button class="avvik-btn avvik-btn-outline" onclick="window._avvikOpenDeadline()" type="button">Sett deadline</button>
                    <button class="avvik-btn avvik-btn-outline" onclick="window._avvikOpenSeverity()" type="button">Endre alvorlighet</button>
                    <button class="avvik-btn avvik-btn-danger" onclick="window._avvikOpenClose()" type="button">Lukk avvik</button>
                </div>
            </div>` : ''}
        `;
    }

    function openDetailPanel() {
        el.detailPanel.classList.add('is-open');
        el.detailBackdrop.classList.add('is-open');
    }

    // ---------------------------------------------------------------------------
    // Event listeners
    // ---------------------------------------------------------------------------
    function setupEventListeners() {
        // Expose globals for inline onclick handlers
        window.loadDeviations = loadDeviations;
        window.applyFilters = applyFilters;
        window.resetFilters = resetFilters;
        window.closeDetailPanel = closeDetailPanel;
        window.closeDialog = closeDialog;
        window.submitAssign = submitAssign;
        window.submitDeadline = submitDeadline;
        window.submitSeverity = submitSeverity;
        window.submitClose = submitClose;
        window.closeLightbox = closeLightbox;

        // Internal callbacks used in rendered HTML
        window._avvikOpenDetail = (id) => loadDetail(id);
        window._avvikPrevPage = () => {
            state.pagination.offset = Math.max(0, state.pagination.offset - state.pagination.limit);
            loadDeviations();
        };
        window._avvikNextPage = () => {
            state.pagination.offset += state.pagination.limit;
            loadDeviations();
        };
        window._avvikOpenAssign = () => openDialog('dialog-assign');
        window._avvikOpenDeadline = () => {
            el.deadlineInput.value = state.currentDetail?.deadline?.slice(0, 10) || '';
            openDialog('dialog-deadline');
        };
        window._avvikOpenSeverity = () => {
            el.severityInput.value = state.currentDetail?.severity || 'medium';
            openDialog('dialog-severity');
        };
        window._avvikOpenClose = () => {
            el.closureComment.value = '';
            openDialog('dialog-close');
        };
        window._avvikOpenLightbox = (url) => {
            el.lightboxImg.src = url;
            el.lightbox.classList.add('is-open');
        };

        // Keyboard close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeLightbox();
                closeAllDialogs();
                closeDetailPanel();
            }
        });
    }

    function applyFilters() {
        state.filters.status = getMultiSelectValues(el.filterStatus);
        state.filters.severity = getMultiSelectValues(el.filterSeverity);
        state.filters.dateFrom = el.filterDateFrom.value || null;
        state.filters.dateTo = el.filterDateTo.value || null;
        state.filters.sort = el.filterSort.value;
        state.pagination.offset = 0;
        loadDeviations();
    }

    function resetFilters() {
        // Reset multi-selects to defaults
        Array.from(el.filterStatus.options).forEach(o => {
            o.selected = ['open', 'assigned', 'in_progress', 'fixed_pending_verification'].includes(o.value);
        });
        Array.from(el.filterSeverity.options).forEach(o => o.selected = false);
        el.filterDateFrom.value = '';
        el.filterDateTo.value = '';
        el.filterSort.value = 'severity_desc_opened_asc';
        state.filters = {
            status: ['open', 'assigned', 'in_progress', 'fixed_pending_verification'],
            severity: [],
            dateFrom: null,
            dateTo: null,
            sort: 'severity_desc_opened_asc'
        };
        state.pagination.offset = 0;
        loadDeviations();
    }

    // ---------------------------------------------------------------------------
    // Dialog actions
    // ---------------------------------------------------------------------------
    async function submitAssign() {
        const id = state.currentDetail?.id;
        if (!id) return;
        const techId = el.assignTechnician.value || null;
        const patch = { assignedToUserId: techId };
        if (techId) patch.status = 'assigned';
        const result = await updateDeviation(id, patch);
        if (!result.ok) {
            showDialogError('assign-error', result.error);
        } else {
            closeDialog('dialog-assign');
        }
    }

    async function submitDeadline() {
        const id = state.currentDetail?.id;
        if (!id) return;
        const deadline = el.deadlineInput.value || null;
        const result = await updateDeviation(id, { deadline });
        if (!result.ok) {
            showDialogError('deadline-error', result.error);
        } else {
            closeDialog('dialog-deadline');
        }
    }

    async function submitSeverity() {
        const id = state.currentDetail?.id;
        if (!id) return;
        const result = await updateDeviation(id, { currentSeverity: el.severityInput.value });
        if (!result.ok) {
            showDialogError('severity-error', result.error);
        } else {
            closeDialog('dialog-severity');
        }
    }

    async function submitClose() {
        const id = state.currentDetail?.id;
        if (!id) return;
        const closureMode = el.closureMode.value;
        const closureComment = el.closureComment.value.trim() || null;
        const result = await updateDeviation(id, { status: 'closed', closureMode, closureComment });
        if (!result.ok) {
            showDialogError('close-error', result.error);
        } else {
            closeDialog('dialog-close');
        }
    }

    // ---------------------------------------------------------------------------
    // Dialog helpers
    // ---------------------------------------------------------------------------
    function openDialog(id) {
        document.getElementById(id).classList.add('is-open');
    }

    function closeDialog(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('is-open');
        // Hide any error inside that dialog
        const errEl = el ? el.querySelector('.avvik-error') : null;
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    }

    function closeAllDialogs() {
        document.querySelectorAll('.avvik-dialog-overlay').forEach(d => d.classList.remove('is-open'));
    }

    function showDialogError(errorElId, msg) {
        const errEl = document.getElementById(errorElId);
        if (!errEl) return;
        errEl.textContent = msg;
        errEl.style.display = 'block';
    }

    function closeDetailPanel() {
        el.detailPanel.classList.remove('is-open');
        el.detailBackdrop.classList.remove('is-open');
    }

    function closeLightbox() {
        el.lightbox.classList.remove('is-open');
        el.lightboxImg.src = '';
    }

    function showGlobalError(msg) {
        if (!msg) {
            el.globalError.style.display = 'none';
            el.globalError.textContent = '';
        } else {
            el.globalError.textContent = msg;
            el.globalError.style.display = 'block';
        }
    }

    // ---------------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------------
    function getMultiSelectValues(selectEl) {
        return Array.from(selectEl.selectedOptions).map(o => o.value);
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDate(isoStr) {
        if (!isoStr) return '—';
        try {
            const d = new Date(isoStr);
            return d.toLocaleDateString('nb-NO', { year: 'numeric', month: '2-digit', day: '2-digit' });
        } catch (_) { return isoStr; }
    }

});

// ---------------------------------------------------------------------------
// Pure helpers (outside DOMContentLoaded for testability if needed)
// ---------------------------------------------------------------------------
function formatDaysOpen(days) {
    if (days === null || days === undefined) return '—';
    if (days === 0) return 'I dag';
    if (days === 1) return '1 dag';
    return `${days} dager`;
}

function getStatusBadgeClass(status) {
    return {
        open: 'badge-red',
        assigned: 'badge-yellow',
        in_progress: 'badge-yellow',
        fixed_pending_verification: 'badge-blue',
        closed: 'badge-gray'
    }[status] || 'badge-gray';
}

function getSeverityBadgeClass(severity) {
    return {
        'høy': 'badge-red',
        'medium': 'badge-orange',
        'lav': 'badge-green'
    }[severity] || 'badge-gray';
}

function formatStatusLabel(status) {
    return {
        open: 'Åpen',
        assigned: 'Tildelt',
        in_progress: 'Under arbeid',
        fixed_pending_verification: 'Venter verifikasjon',
        closed: 'Lukket'
    }[status] || status;
}

function formatSeverityLabel(severity) {
    return {
        'høy': 'Høy',
        'medium': 'Medium',
        'lav': 'Lav'
    }[severity] || severity || '—';
}

function formatClosureMode(mode) {
    return {
        fixed_on_visit: 'Utbedret under besøk',
        manual_close: 'Manuelt lukket',
        accepted_by_customer: 'Godkjent av kunde',
        legacy_migrated: 'Migrert fra historikk'
    }[mode] || mode || '—';
}

// ---------------------------------------------------------------------------
// Eksport-modal
// ---------------------------------------------------------------------------

(function initExportModal() {
    const btn = document.getElementById('avvikExportBtn');
    const modal = document.getElementById('avvikExportModal');
    const cancelBtn = document.getElementById('avvikExportCancel');
    const submitBtn = document.getElementById('avvikExportSubmit');
    const errorDiv = document.getElementById('avvikExportError');

    if (!btn || !modal) return; // Guard: HTML not loaded yet

    function openExportModal() {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
        modal.classList.add('is-open');
    }

    function closeExportModal() {
        modal.classList.remove('is-open');
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
    }

    function showExportError(msg) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
    }

    async function triggerExport() {
        const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'csv';
        const scope = document.querySelector('input[name="exportScope"]:checked')?.value || 'filtered';

        // Bygg URL med filter-params hvis scope=filtered
        const params = new URLSearchParams({ format, scope });
        if (scope === 'filtered') {
            // Gjenbruk filter-state fra eksisterende state-objekt (satt i avvik-appen)
            const filters = window._avvikState?.filters;
            if (filters) {
                if (filters.status?.length) params.set('status', filters.status.join(','));
                if (filters.severity?.length) params.set('severity', filters.severity.join(','));
                if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
                if (filters.dateTo) params.set('dateTo', filters.dateTo);
            }
        }

        submitBtn.disabled = true;
        errorDiv.style.display = 'none';

        try {
            const res = await fetch(`/api/admin/deviations/export?${params}`, { credentials: 'include' });

            if (!res.ok) {
                let errorMsg = 'Eksport feilet. Prøv igjen.';
                try {
                    const body = await res.json();
                    if (body.error) errorMsg = body.error;
                } catch (_) {}

                if (res.status === 401) {
                    window.location.href = '/admin/login.html';
                    return;
                }
                showExportError(errorMsg);
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            // Hent filnavn fra Content-Disposition header
            const cd = res.headers.get('content-disposition') || '';
            const match = cd.match(/filename="([^"]+)"/);
            const filename = match ? match[1] : `avvik-export.${format}`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            closeExportModal();
        } catch (err) {
            showExportError('Nettverksfeil — prøv igjen.');
        } finally {
            submitBtn.disabled = false;
        }
    }

    btn.addEventListener('click', openExportModal);
    cancelBtn.addEventListener('click', closeExportModal);
    submitBtn.addEventListener('click', triggerExport);
})();
