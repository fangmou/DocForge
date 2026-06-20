import { t } from './i18n.js';

const _overlayStyle = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;z-index:600';
const _dialogStyle = 'background:var(--bg-3);border:1px solid var(--border-medium);border-radius:8px;padding:16px 20px;min-width:320px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.15)';
const _msgStyle = 'font-size:13px;color:var(--text-1);margin-bottom:12px;line-height:1.5';
const _actionsStyle = 'display:flex;justify-content:flex-end;gap:8px';
const _btnStyle = 'padding:5px 16px;border-radius:4px;font-size:12px;cursor:pointer';
const _btnSecondary = `${_btnStyle};border:1px solid var(--border-medium);background:var(--bg-2);color:var(--text-2)`;
const _btnPrimary = `${_btnStyle};border:none;background:var(--accent);color:#fff;font-weight:500`;

/**
 * 替代原生 confirm()，返回 Promise<boolean>
 * @param {string} message 确认消息（纯文本，防 XSS）
 */
export function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = _overlayStyle;

    const dialog = document.createElement('div');
    dialog.style.cssText = _dialogStyle;
    dialog.onclick = (e) => e.stopPropagation();

    const msg = document.createElement('div');
    msg.style.cssText = _msgStyle;
    msg.textContent = message;

    const actions = document.createElement('div');
    actions.style.cssText = _actionsStyle;

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = _btnSecondary;
    cancelBtn.textContent = t('settings.cancel');

    const okBtn = document.createElement('button');
    okBtn.style.cssText = _btnPrimary;
    okBtn.textContent = t('dialog.ok');

    let settled = false;
    function close(result) {
      if (settled) return;
      settled = true;
      resolve(result);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }

    function onKey(e) {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    }
    document.addEventListener('keydown', onKey);

    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => close(true);
    overlay.onclick = () => close(false);

    actions.append(cancelBtn, okBtn);
    dialog.append(msg, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    okBtn.focus();
  });
}

/**
 * 未保存文件关闭确认框，返回 'save' | 'discard' | 'cancel'
 * @param {string} message 提示消息
 */
export function showSaveConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = _overlayStyle;

    const dialog = document.createElement('div');
    dialog.style.cssText = _dialogStyle;
    dialog.onclick = (e) => e.stopPropagation();

    const msg = document.createElement('div');
    msg.style.cssText = _msgStyle;
    msg.textContent = message;

    const actions = document.createElement('div');
    actions.style.cssText = _actionsStyle;

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = _btnSecondary;
    cancelBtn.textContent = t('dialog.cancel');

    const discardBtn = document.createElement('button');
    discardBtn.style.cssText = _btnSecondary;
    discardBtn.textContent = t('dialog.discard');

    const saveBtn = document.createElement('button');
    saveBtn.style.cssText = _btnPrimary;
    saveBtn.textContent = t('dialog.save');

    let settled = false;
    function close(result) {
      if (settled) return;
      settled = true;
      resolve(result);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }

    function onKey(e) {
      if (e.key === 'Escape') close('cancel');
    }
    document.addEventListener('keydown', onKey);

    const diffBtn = document.createElement('button');
    diffBtn.style.cssText = _btnSecondary;
    diffBtn.textContent = t('dialog.compareUnsaved');

    cancelBtn.onclick = () => close('cancel');
    diffBtn.onclick = () => close('diff');
    discardBtn.onclick = () => close('discard');
    saveBtn.onclick = () => close('save');
    overlay.onclick = () => close('cancel');

    actions.append(cancelBtn, diffBtn, discardBtn, saveBtn);
    dialog.append(msg, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    saveBtn.focus();
  });
}
