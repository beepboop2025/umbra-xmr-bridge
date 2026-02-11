/* =====================================================
   XMR ↔ TON Bridge — Production App Controller
   ===================================================== */

import CONFIG from './config.js';
import { eventBus, EVENTS } from './services/EventBus.js';
import { rateService } from './services/RateService.js';
import { bridgeService } from './services/BridgeService.js';
import { storageService } from './services/StorageService.js';
import { telegramService } from './services/TelegramService.js';
import {
    debounce, formatNumber, formatTime, timeAgo,
    copyToClipboard, sanitize, drawSparkline,
} from './utils.js';

// ---- State ----
const state = {
    direction: 'xmr-ton',
    fromAmount: '',
    toAmount: '',
    destAddress: '',
    slippage: CONFIG.DEFAULT_SLIPPAGE,
    conversion: null,
    isProcessing: false,
    settingsOpen: false,
    historyOpen: false,
};

// ---- DOM cache ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let els = {};

function cacheDom() {
    els = {
        btnXmrTon: $('#btn-xmr-ton'),
        btnTonXmr: $('#btn-ton-xmr'),
        swapBtn: $('#swap-direction-btn'),
        fromAmount: $('#from-amount'),
        toAmount: $('#to-amount'),
        destAddress: $('#dest-address'),
        fromCoin: $('#from-coin'),
        toCoin: $('#to-coin'),
        destLabel: $('#dest-label'),
        rateValue: $('#rate-value'),
        rateInfo: $('#rate-info'),
        networkFee: $('#network-fee'),
        bridgeFee: $('#bridge-fee'),
        minReceived: $('#min-received'),
        slippageDisplay: $('#slippage-display'),
        estTime: $('#est-time'),
        addressError: $('#address-error'),
        amountHint: $('#amount-hint'),
        bridgeBtn: $('#bridge-btn'),
        btnText: $('#btn-text'),
        pasteBtn: $('#paste-btn'),
        bridgeCard: $('#bridge-card'),
        txStatusCard: $('#tx-status-card'),
        txId: $('#tx-id'),
        txProgress: $('#tx-progress'),
        progressSteps: $('#progress-steps'),
        progressBarFill: $('#progress-bar-fill'),
        timerValue: $('#timer-value'),
        depositInfo: $('#deposit-info'),
        depositAmount: $('#deposit-amount'),
        depositAddress: $('#deposit-address'),
        depositCurrency: $('#deposit-currency'),
        copyDepositBtn: $('#copy-deposit-btn'),
        newBridgeBtn: $('#new-bridge-btn'),
        historySection: $('#history-section'),
        historyToggle: $('#history-toggle'),
        historyList: $('#history-list'),
        historyCount: $('#history-count'),
        emptyHistory: $('#empty-history'),
        settingsBtn: $('#settings-btn'),
        settingsModal: $('#settings-modal'),
        settingsClose: $('#settings-close'),
        slippageOptions: $('#slippage-options'),
        slippageCustom: $('#slippage-custom'),
        clearHistoryBtn: $('#clear-history-btn'),
        confirmModal: $('#confirm-modal'),
        confirmSummary: $('#confirm-summary'),
        confirmDetails: $('#confirm-details'),
        confirmCancel: $('#confirm-cancel'),
        confirmProceed: $('#confirm-proceed'),
        networkBar: $('#network-bar'),
        sparkline: $('#sparkline'),
    };
}

// ---- Initialization ----
function init() {
    cacheDom();

    // Load saved settings
    const saved = storageService.getSettings();
    state.direction = saved.lastDirection || 'xmr-ton';
    state.slippage = saved.slippage || CONFIG.DEFAULT_SLIPPAGE;

    // Init Telegram
    telegramService.init();

    // Setup
    bindEvents();
    subscribeToEvents();
    updateDirectionUI();
    renderHistory();

    // Start rate polling
    rateService.startPolling();

    // Spawn ambient particles
    spawnParticles();

    // Cleanup on page hide (mobile tab switch, app close)
    window.addEventListener('pagehide', () => {
        rateService.stopPolling();
        if (timerInterval) clearInterval(timerInterval);
    });

    console.log('[Bridge] App v2.0 initialized');
}

// ---- Event Bindings ----
function bindEvents() {
    // Direction
    els.btnXmrTon.addEventListener('click', () => setDirection('xmr-ton'));
    els.btnTonXmr.addEventListener('click', () => setDirection('ton-xmr'));
    els.swapBtn.addEventListener('click', toggleDirection);

    // Amount — debounced
    const debouncedCalc = debounce(recalculate, CONFIG.UI.DEBOUNCE_MS);
    els.fromAmount.addEventListener('input', (e) => {
        state.fromAmount = e.target.value;
        debouncedCalc();
        validateAndUpdateButton();
    });

    // Address
    els.destAddress.addEventListener('input', (e) => {
        state.destAddress = e.target.value.trim();
        els.addressError.textContent = '';
        validateAndUpdateButton();
    });

    // Paste
    els.pasteBtn.addEventListener('click', handlePaste);

    // Bridge
    els.bridgeBtn.addEventListener('click', handleBridgeClick);

    // Confirmation modal
    els.confirmCancel.addEventListener('click', closeConfirmModal);
    els.confirmProceed.addEventListener('click', handleConfirmBridge);
    els.confirmModal.addEventListener('click', (e) => {
        if (e.target === els.confirmModal) closeConfirmModal();
    });

    // New bridge
    els.newBridgeBtn.addEventListener('click', resetBridge);

    // Copy deposit
    els.copyDepositBtn.addEventListener('click', () => {
        copyToClipboard(els.depositAddress.textContent).then(() => {
            showToast('Address copied!', 'success');
            telegramService.hapticImpact('light');
        });
    });

    // History toggle
    els.historyToggle.addEventListener('click', () => {
        state.historyOpen = !state.historyOpen;
        els.historySection.classList.toggle('open', state.historyOpen);
        els.historyToggle.setAttribute('aria-expanded', state.historyOpen);
    });

    // Settings
    els.settingsBtn.addEventListener('click', openSettings);
    els.settingsClose.addEventListener('click', closeSettings);
    els.settingsModal.addEventListener('click', (e) => {
        if (e.target === els.settingsModal) closeSettings();
    });

    // Slippage buttons
    els.slippageOptions.querySelectorAll('.slippage-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            setSlippage(parseFloat(btn.dataset.val));
            els.slippageCustom.value = '';
        });
    });

    // Custom slippage
    els.slippageCustom.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (val && val > 0 && val <= 50) {
            setSlippage(val);
        }
    });

    // Clear history
    els.clearHistoryBtn.addEventListener('click', () => {
        storageService.remove(CONFIG.STORAGE.HISTORY);
        eventBus.emit(EVENTS.HISTORY_UPDATED, []);
        showToast('History cleared', 'success');
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (state.settingsOpen) closeSettings();
            if (els.confirmModal && !els.confirmModal.classList.contains('hidden')) closeConfirmModal();
        }
    });
}

// ---- Service Event Subscriptions ----
function subscribeToEvents() {
    eventBus.on(EVENTS.RATE_UPDATED, (data) => {
        updateRateDisplay();
        if (state.fromAmount) recalculate();
        drawSparkline(els.sparkline, data.priceHistory, getAccentColor());
    });

    eventBus.on(EVENTS.RATE_STALE, () => {
        els.rateInfo.textContent = 'Rate outdated';
        els.rateInfo.classList.add('stale');
    });

    eventBus.on(EVENTS.NETWORK_STATUS, ({ isOnline }) => {
        els.networkBar.classList.toggle('hidden', isOnline);
    });

    eventBus.on(EVENTS.ORDER_STEP_CHANGED, (order) => {
        updateOrderProgress(order);
    });

    eventBus.on(EVENTS.ORDER_COMPLETED, (order) => {
        showToast(`🎉 Bridge complete! ${formatNumber(order.toAmount)} ${order.toCurrency} sent`, 'success');
        telegramService.hapticNotification('success');
        state.isProcessing = false;
    });

    eventBus.on(EVENTS.ORDER_FAILED, (order) => {
        showToast(`Bridge failed: ${order.error || 'Unknown error'}`, 'error');
        telegramService.hapticNotification('error');
        state.isProcessing = false;
    });

    eventBus.on(EVENTS.HISTORY_UPDATED, () => {
        renderHistory();
    });
}

// ---- Direction ----
function setDirection(dir) {
    if (state.direction === dir || state.isProcessing) return;
    state.direction = dir;
    state.fromAmount = '';
    state.toAmount = '';
    state.conversion = null;
    els.fromAmount.value = '';
    els.toAmount.value = '';

    storageService.saveSettings({ lastDirection: dir });
    telegramService.hapticSelection();
    updateDirectionUI();
    validateAndUpdateButton();
}

function toggleDirection() {
    setDirection(state.direction === 'xmr-ton' ? 'ton-xmr' : 'xmr-ton');
}

function updateDirectionUI() {
    const dirConfig = CONFIG.DIRECTIONS[state.direction];
    const fromChain = CONFIG.CHAINS[dirConfig.from];
    const toChain = CONFIG.CHAINS[dirConfig.to];
    const isXmrToTon = state.direction === 'xmr-ton';

    // Toggle buttons
    els.btnXmrTon.classList.toggle('active', isXmrToTon);
    els.btnTonXmr.classList.toggle('active', !isXmrToTon);
    els.btnXmrTon.setAttribute('aria-checked', isXmrToTon);
    els.btnTonXmr.setAttribute('aria-checked', !isXmrToTon);

    // Coin badges
    els.fromCoin.innerHTML = `<img src="${sanitize(fromChain.icon)}" alt="${sanitize(fromChain.symbol)}" class="coin-icon-sm" /><span>${sanitize(fromChain.symbol)}</span>`;
    els.toCoin.innerHTML = `<img src="${sanitize(toChain.icon)}" alt="${sanitize(toChain.symbol)}" class="coin-icon-sm" /><span>${sanitize(toChain.symbol)}</span>`;

    // Labels
    els.destLabel.textContent = `Destination ${toChain.name} Address`;
    els.destAddress.placeholder = `Enter your ${toChain.name} wallet address`;
    els.networkFee.textContent = dirConfig.networkFeeLabel;
    els.estTime.textContent = formatTime(dirConfig.estimatedTime);
    els.slippageDisplay.textContent = `${state.slippage}%`;

    // Reset outputs
    els.bridgeFee.textContent = '—';
    els.minReceived.textContent = '—';
    els.addressError.textContent = '';
    els.amountHint.textContent = '';

    updateRateDisplay();
}

// ---- Rate Display ----
function updateRateDisplay() {
    const rate = rateService.getRate(state.direction);
    const dirConfig = CONFIG.DIRECTIONS[state.direction];
    const isXmrToTon = state.direction === 'xmr-ton';

    els.rateValue.textContent = isXmrToTon
        ? `1 XMR ≈ ${formatNumber(rate, 2)} TON`
        : `1 TON ≈ ${formatNumber(rate, 4)} XMR`;

    const info = rateService.getRateInfo();
    els.rateInfo.classList.remove('stale');
    if (info.isStale) {
        els.rateInfo.textContent = 'Rate outdated';
        els.rateInfo.classList.add('stale');
    } else {
        els.rateInfo.textContent = `Updated ${timeAgo(info.lastUpdated)}`;
    }
}

// ---- Calculation ----
function recalculate() {
    const numVal = parseFloat(state.fromAmount);
    const dirConfig = CONFIG.DIRECTIONS[state.direction];

    if (!state.fromAmount || isNaN(numVal) || numVal <= 0) {
        state.toAmount = '';
        state.conversion = null;
        els.toAmount.value = '';
        els.bridgeFee.textContent = '—';
        els.minReceived.textContent = '—';
        els.amountHint.textContent = '';
        return;
    }

    const conversion = rateService.calculateConversion(numVal, state.direction, state.slippage);
    state.conversion = conversion;
    state.toAmount = conversion.toAmount;

    els.toAmount.value = formatNumber(conversion.toAmount);
    els.bridgeFee.textContent = `${formatNumber(conversion.fee)} ${dirConfig.from}`;
    els.minReceived.textContent = `${formatNumber(conversion.minReceived)} ${dirConfig.to}`;

    // Amount hint
    if (numVal < dirConfig.minAmount) {
        els.amountHint.textContent = `Min: ${dirConfig.minAmount} ${dirConfig.from}`;
        els.amountHint.classList.add('error');
    } else if (numVal > dirConfig.maxAmount) {
        els.amountHint.textContent = `Max: ${dirConfig.maxAmount} ${dirConfig.from}`;
        els.amountHint.classList.add('error');
    } else {
        els.amountHint.textContent = '';
        els.amountHint.classList.remove('error');
    }
}

// ---- Validation ----
function validateAndUpdateButton() {
    const dirConfig = CONFIG.DIRECTIONS[state.direction];
    const numVal = parseFloat(state.fromAmount);
    let valid = true;

    if (!state.fromAmount || isNaN(numVal) || numVal <= 0) {
        els.btnText.textContent = 'Enter an amount';
        valid = false;
    } else if (numVal < dirConfig.minAmount) {
        els.btnText.textContent = `Min: ${dirConfig.minAmount} ${dirConfig.from}`;
        valid = false;
    } else if (numVal > dirConfig.maxAmount) {
        els.btnText.textContent = `Max: ${dirConfig.maxAmount} ${dirConfig.from}`;
        valid = false;
    } else if (!state.destAddress) {
        els.btnText.textContent = 'Enter destination address';
        valid = false;
    } else {
        const validation = bridgeService.validateOrder({
            direction: state.direction,
            amount: numVal,
            destAddress: state.destAddress,
        });
        if (!validation.valid) {
            const addrErr = validation.errors.find((e) => e.field === 'address');
            if (addrErr) {
                els.addressError.textContent = addrErr.message;
                els.btnText.textContent = 'Invalid address';
            }
            valid = false;
        }
    }

    if (valid) {
        els.btnText.textContent = `Bridge ${dirConfig.from} → ${dirConfig.to}`;
    }

    els.bridgeBtn.disabled = !valid || state.isProcessing;
}

// ---- Bridge Flow ----
function handleBridgeClick() {
    if (state.isProcessing) return;
    showConfirmModal();
}

function showConfirmModal() {
    const dirConfig = CONFIG.DIRECTIONS[state.direction];
    const fromChain = CONFIG.CHAINS[dirConfig.from];
    const toChain = CONFIG.CHAINS[dirConfig.to];
    const conversion = state.conversion;

    els.confirmSummary.innerHTML = `
    <div class="confirm-row from">
      <img src="${sanitize(fromChain.icon)}" class="confirm-coin" alt="${sanitize(fromChain.symbol)}" />
      <div class="confirm-amount">
        <span class="confirm-value">${sanitize(formatNumber(parseFloat(state.fromAmount)))}</span>
        <span class="confirm-symbol">${sanitize(fromChain.symbol)}</span>
      </div>
    </div>
    <div class="confirm-arrow">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <polyline points="19 12 12 19 5 12"></polyline>
      </svg>
    </div>
    <div class="confirm-row to">
      <img src="${sanitize(toChain.icon)}" class="confirm-coin" alt="${sanitize(toChain.symbol)}" />
      <div class="confirm-amount">
        <span class="confirm-value">${sanitize(formatNumber(conversion.toAmount))}</span>
        <span class="confirm-symbol">${sanitize(toChain.symbol)}</span>
      </div>
    </div>
  `;

    els.confirmDetails.innerHTML = `
    <div class="fee-row"><span>Rate</span><span>1 ${sanitize(fromChain.symbol)} ≈ ${sanitize(formatNumber(rateService.getRate(state.direction), state.direction === 'xmr-ton' ? 2 : 4))} ${sanitize(toChain.symbol)}</span></div>
    <div class="fee-row"><span>Bridge Fee</span><span>${sanitize(formatNumber(conversion.fee))} ${sanitize(fromChain.symbol)}</span></div>
    <div class="fee-row"><span>Min. Received</span><span>${sanitize(formatNumber(conversion.minReceived))} ${sanitize(toChain.symbol)}</span></div>
    <div class="fee-row"><span>Slippage</span><span>${sanitize(String(state.slippage))}%</span></div>
    <div class="fee-row"><span>Est. Time</span><span>${sanitize(formatTime(dirConfig.estimatedTime))}</span></div>
    <div class="fee-row"><span>Destination</span><span class="mono">${sanitize(state.destAddress.substring(0, 12))}...${sanitize(state.destAddress.slice(-6))}</span></div>
  `;

    els.confirmModal.classList.remove('hidden');
    telegramService.hapticImpact('medium');
}

function closeConfirmModal() {
    els.confirmModal.classList.add('hidden');
}

async function handleConfirmBridge() {
    closeConfirmModal();
    state.isProcessing = true;

    els.bridgeBtn.classList.add('loading');
    els.bridgeBtn.disabled = true;
    telegramService.hapticImpact('heavy');

    try {
        const order = await bridgeService.createOrder({
            direction: state.direction,
            amount: parseFloat(state.fromAmount),
            destAddress: state.destAddress,
            slippage: state.slippage,
        });

        showOrderUI(order);
    } catch (err) {
        showToast(`Failed to create order: ${err.message}`, 'error');
        state.isProcessing = false;
        els.bridgeBtn.classList.remove('loading');
        els.bridgeBtn.disabled = false;
    }
}

// ---- Order UI ----
function showOrderUI(order) {
    const displayInfo = bridgeService.getOrderDisplayInfo(order);

    // Hide bridge, show status
    els.bridgeCard.classList.add('hidden');
    els.txStatusCard.classList.remove('hidden');

    // TX ID
    els.txId.textContent = `#${order.id}`;

    // Render steps
    renderProgressSteps(displayInfo.steps, order.step);

    // Deposit info
    els.depositAmount.textContent = `${formatNumber(order.fromAmount)} ${order.fromCurrency}`;
    els.depositAddress.textContent = order.depositAddress;
    els.depositCurrency.textContent = order.fromCurrency;

    // Start timer
    startTimer(order);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Show Telegram back button
    telegramService.showBackButton(() => {
        if (window.confirm('Leave bridge status? You can track it in history.')) {
            resetBridge();
        }
    });
}

function renderProgressSteps(steps, currentStep) {
    els.progressSteps.innerHTML = steps.map((step, i) => {
        const stepNum = i + 1;
        const statusClass = stepNum < currentStep ? 'completed' : stepNum === currentStep ? 'active' : '';
        return `
      <div class="step ${statusClass}" data-step="${stepNum}">
        <div class="step-dot"><span class="dot-inner">${stepNum < currentStep ? '✓' : ''}</span></div>
        <div class="step-info">
          <span class="step-title">${sanitize(step.title)}</span>
          <span class="step-desc">${sanitize(step.desc)}</span>
        </div>
      </div>
      ${i < steps.length - 1 ? `<div class="step-line ${stepNum < currentStep ? 'completed' : ''}"></div>` : ''}
    `;
    }).join('');

    // Progress bar
    const progress = Math.max(0, ((currentStep - 1) / (steps.length - 1)) * 100);
    els.progressBarFill.style.width = `${progress}%`;
}

function updateOrderProgress(order) {
    const displayInfo = bridgeService.getOrderDisplayInfo(order);
    renderProgressSteps(displayInfo.steps, order.step);
    telegramService.hapticImpact('light');
}

let timerInterval = null;
function startTimer(order) {
    if (timerInterval) clearInterval(timerInterval);

    const update = () => {
        const elapsed = (Date.now() - order.createdAt) / 1000;
        const remaining = Math.max(0, order.estimatedTime - elapsed);

        if (remaining <= 0 || order.status === 'completed') {
            els.timerValue.textContent = order.status === 'completed' ? 'Done!' : 'Processing...';
            clearInterval(timerInterval);
            return;
        }

        els.timerValue.textContent = formatTime(remaining);
    };

    update();
    timerInterval = setInterval(update, 1000);
}

// ---- Reset ----
function resetBridge() {
    state.isProcessing = false;
    state.fromAmount = '';
    state.toAmount = '';
    state.destAddress = '';
    state.conversion = null;

    els.fromAmount.value = '';
    els.toAmount.value = '';
    els.destAddress.value = '';
    els.bridgeBtn.classList.remove('loading');

    els.bridgeCard.classList.remove('hidden');
    els.txStatusCard.classList.add('hidden');

    bridgeService.reset();
    telegramService.hideBackButton();

    if (timerInterval) clearInterval(timerInterval);

    updateDirectionUI();
    validateAndUpdateButton();
}

// ---- Paste ----
async function handlePaste() {
    try {
        const text = await navigator.clipboard.readText();
        els.destAddress.value = text;
        state.destAddress = text.trim();
        validateAndUpdateButton();
        showToast('Pasted', 'success');
        telegramService.hapticImpact('light');
    } catch {
        showToast('Cannot access clipboard', 'error');
    }
}

// ---- Settings ----
function openSettings() {
    state.settingsOpen = true;
    els.settingsModal.classList.remove('hidden');
    updateSlippageUI();
    telegramService.hapticImpact('light');
}

function closeSettings() {
    state.settingsOpen = false;
    els.settingsModal.classList.add('hidden');
}

function setSlippage(val) {
    state.slippage = val;
    storageService.saveSettings({ slippage: val });
    els.slippageDisplay.textContent = `${val}%`;
    updateSlippageUI();
    if (state.fromAmount) recalculate();
    telegramService.hapticSelection();
}

function updateSlippageUI() {
    els.slippageOptions.querySelectorAll('.slippage-btn').forEach((btn) => {
        btn.classList.toggle('active', parseFloat(btn.dataset.val) === state.slippage);
    });
}

// ---- History ----
function renderHistory() {
    const history = storageService.getHistory();

    // Count badge
    els.historyCount.textContent = history.length > 0 ? history.length.toString() : '';

    if (history.length === 0) {
        els.emptyHistory.style.display = 'flex';
        // Remove old items
        els.historyList.querySelectorAll('.history-item').forEach((el) => el.remove());
        return;
    }

    els.emptyHistory.style.display = 'none';
    els.historyList.querySelectorAll('.history-item').forEach((el) => el.remove());

    history.forEach((tx) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.setAttribute('role', 'listitem');

        const iconClass = tx.direction === 'xmr-ton' ? 'xmr-ton' : 'ton-xmr';
        const fromChain = CONFIG.CHAINS[tx.fromCurrency] || {};
        const toChain = CONFIG.CHAINS[tx.toCurrency] || {};
        const statusMap = {
            completed: { class: 'completed', text: 'Done', icon: '✓' },
            failed: { class: 'failed', text: 'Failed', icon: '✗' },
            cancelled: { class: 'failed', text: 'Cancelled', icon: '—' },
        };
        const statusInfo = statusMap[tx.status] || { class: 'pending', text: 'Pending', icon: '◌' };
        const toAmountStr = typeof tx.toAmount === 'number' ? formatNumber(tx.toAmount) : tx.toAmount;

        item.innerHTML = `
      <div class="history-icon ${iconClass}">
        <img src="${fromChain.icon || ''}" class="h-coin" alt="" />
        <span class="h-arrow">→</span>
        <img src="${toChain.icon || ''}" class="h-coin" alt="" />
      </div>
      <div class="history-details">
        <div class="history-amounts">${sanitize(String(tx.fromAmount))} ${sanitize(tx.fromCurrency)} → ${sanitize(toAmountStr)} ${sanitize(tx.toCurrency)}</div>
        <div class="history-date">${timeAgo(tx.createdAt)}</div>
      </div>
      <span class="history-status ${statusInfo.class}">${statusInfo.text}</span>
    `;

        els.historyList.appendChild(item);
    });
}

// ---- Toast Notifications ----
function showToast(message, type = 'info') {
    document.querySelectorAll('.toast').forEach((t) => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), CONFIG.UI.ANIMATION_DURATION);
    }, CONFIG.UI.TOAST_DURATION);
}

// ---- Helpers ----
function getAccentColor() {
    return state.direction === 'xmr-ton'
        ? CONFIG.CHAINS.XMR.color
        : CONFIG.CHAINS.TON.color;
}

// ---- Ambient Particles ----
function spawnParticles() {
    const container = $('#particles');
    if (!container) return;

    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.cssText = `
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      animation-delay: ${Math.random() * 8}s;
      animation-duration: ${6 + Math.random() * 8}s;
      width: ${1 + Math.random() * 2}px;
      height: ${1 + Math.random() * 2}px;
      opacity: ${0.1 + Math.random() * 0.3};
    `;
        container.appendChild(p);
    }
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', init);
