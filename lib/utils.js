/**
 * Bhandai Exchange -- Shared Utilities
 * Provides common functions used across admin, agent, and client pages.
 * All functions are available as window.BX.* AND as bare window globals.
 */

(function () {
  'use strict';

  const BX = {};

  // ── XSS Sanitizer ──────────────────────────────────────────────
  BX.sanitize = function sanitize(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  };

  // ── Number Formatter ───────────────────────────────────────────
  BX.fmt = function fmt(n, d) {
    if (d === undefined) d = 2;
    return parseFloat(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  };

  // ── Relative Time ──────────────────────────────────────────────
  BX.timeAgo = function timeAgo(ts) {
    if (!ts) return '<span style="color:#475569;font-size:0.72rem;">Never</span>';
    const diff = Date.now() - new Date(ts).getTime();
    const min  = Math.floor(diff / 60000);
    const hr   = Math.floor(diff / 3600000);
    const day  = Math.floor(diff / 86400000);
    const label = min < 1 ? 'Just now' : min < 60 ? min + 'm ago' : hr < 24 ? hr + 'h ago' : day + 'd ago';
    const col   = min < 60 ? '#10b981' : hr < 24 ? '#f59e0b' : '#64748b';
    return '<span style="color:' + col + ';font-size:0.72rem;">' + label + '</span>';
  };

  // ── Toast Notifications ────────────────────────────────────────
  BX.showToast = function showToast(msg, type) {
    if (!type) type = 'info';
    var container = document.getElementById('toast-container') || document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    var icons = { success: '\u2705', error: '\u274C', info: '\u2139\uFE0F' };
    toast.className = 'toast ' + type;
    toast.innerHTML = '<span>' + (icons[type] || '\u2139\uFE0F') + '</span><span>' + msg + '</span>';
    container.appendChild(toast);
    // For client.html animated toast pattern
    if (container.id === 'toastContainer') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { toast.classList.add('show'); });
      });
    }
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3500);
  };

  // ── Modal Helpers ──────────────────────────────────────────────
  BX.openModal = function openModal(id) {
    document.getElementById(id).classList.add('open');
  };

  BX.closeModal = function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  };

  // ── Expose as window.BX namespace ──────────────────────────────
  window.BX = BX;

  // ── Global aliases -- HTML onclick handlers reference bare names ─
  window.sanitize = BX.sanitize;
  window.fmt = BX.fmt;
  window.timeAgo = BX.timeAgo;
  window.showToast = BX.showToast;
  window.openModal = BX.openModal;
  window.closeModal = BX.closeModal;
})();
