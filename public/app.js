const form = document.getElementById('audit-form');
const urlInput = document.getElementById('url-input');
const submitBtn = document.getElementById('submit-btn');
const errorBanner = document.getElementById('error-banner');
const jobsBody = document.getElementById('jobs-body');

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
}

function clearError() {
  errorBanner.classList.remove('visible');
  errorBanner.textContent = '';
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401) {
    location.reload();
    throw new Error('Session expired');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Starting…';
  try {
    await api('/api/audits', {
      method: 'POST',
      body: JSON.stringify({
        url: urlInput.value.trim(),
        maxPages: Number(document.getElementById('opt-max-pages').value) || undefined,
        maxDepth: Number(document.getElementById('opt-max-depth').value) || undefined,
        accessibility: document.getElementById('opt-a11y').checked,
        lighthouse: document.getElementById('opt-lighthouse').checked,
        ignoreRobots: document.getElementById('opt-ignore-robots').checked,
        includeSubdomains: document.getElementById('opt-subdomains').checked
      })
    });
    urlInput.value = '';
    await refresh();
  } catch (error) {
    showError(error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start Audit';
  }
});

function scoreClass(score) {
  if (score === null || score === undefined) return '';
  if (score >= 90) return 'score-good';
  if (score >= 50) return 'score-warn';
  return 'score-bad';
}

function timeAgo(ts) {
  if (!ts) return '—';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

function progressText(job) {
  if (!job.progress) return '';
  const p = job.progress;
  if (p.stage === 'crawling' && typeof p.crawled === 'number') {
    return `Crawling — ${p.crawled} page(s) crawled, ${p.queued} queued`;
  }
  return p.message || (p.stage ? `Running: ${p.stage}` : '');
}

function renderRow(job) {
  const tr = document.createElement('tr');

  const statusBadge = `<span class="badge badge-${job.status}">${esc(job.status)}</span>`;
  const scoreCell = job.status === 'done' && job.summary
    ? `<span class="score ${scoreClass(job.summary.overall)}">${job.summary.overall}</span>/100`
    : '—';

  let actions = '';
  if (job.status === 'done' && job.reportUrl) {
    actions += `<a href="${esc(job.reportUrl)}" target="_blank" rel="noopener">View report</a>`;
  } else if (job.status === 'error' || job.status === 'interrupted') {
    actions += `<span title="${esc(job.error || '')}" style="color:var(--bad); font-size:12px;">${esc((job.error || 'Failed').slice(0, 60))}</span>`;
  }
  if (job.status !== 'queued' && job.status !== 'running') {
    actions += ` <button class="danger" data-delete="${esc(job.id)}">Remove</button>`;
  }

  tr.innerHTML = `
    <td class="url-cell" title="${esc(job.url)}">${esc(job.url)}</td>
    <td>${statusBadge}${job.status === 'running' ? `<div class="progress-text">${esc(progressText(job))}</div>` : ''}</td>
    <td>${scoreCell}</td>
    <td>${timeAgo(job.startedAt || job.createdAt)}</td>
    <td class="actions">${actions}</td>
  `;
  return tr;
}

async function refresh() {
  let jobs;
  try {
    jobs = await api('/api/audits');
  } catch {
    return;
  }
  jobsBody.innerHTML = '';
  if (!jobs.length) {
    jobsBody.innerHTML = '<tr class="empty-row"><td colspan="5">No audits yet — start one above.</td></tr>';
    return;
  }
  for (const job of jobs) {
    jobsBody.appendChild(renderRow(job));
  }
}

jobsBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-delete]');
  if (!btn) return;
  btn.disabled = true;
  try {
    await api(`/api/audits/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
    await refresh();
  } catch (error) {
    showError(error.message);
    btn.disabled = false;
  }
});

refresh();
setInterval(refresh, 1500);
