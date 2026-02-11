/* =====================================================
   BridgeService — Core bridge order management
   ===================================================== */

import CONFIG from '../config.js';
import { eventBus, EVENTS } from './EventBus.js';
import { rateService } from './RateService.js';
import { storageService } from './StorageService.js';
import { generateId, sleep, generateMockAddress, formatTime } from '../utils.js';

class BridgeService {
    constructor() {
        this._activeOrder = null;
        this._orderAbortController = null;
    }

    /**
     * Get the currently active order
     * @returns {Object|null}
     */
    getActiveOrder() {
        return this._activeOrder;
    }

    /**
     * Validate bridge inputs
     * @param {Object} params
     * @returns {Object} { valid, errors }
     */
    validateOrder({ direction, amount, destAddress }) {
        const errors = [];
        const dirConfig = CONFIG.DIRECTIONS[direction];
        const toChain = CONFIG.CHAINS[dirConfig.to];

        if (!amount || isNaN(amount) || amount <= 0) {
            errors.push({ field: 'amount', message: 'Enter a valid amount' });
        } else if (amount < dirConfig.minAmount) {
            errors.push({
                field: 'amount',
                message: `Minimum amount is ${dirConfig.minAmount} ${dirConfig.from}`,
            });
        } else if (amount > dirConfig.maxAmount) {
            errors.push({
                field: 'amount',
                message: `Maximum amount is ${dirConfig.maxAmount} ${dirConfig.from}`,
            });
        }

        if (!destAddress || destAddress.trim() === '') {
            errors.push({ field: 'address', message: 'Enter a destination address' });
        } else if (!this._validateAddress(destAddress, toChain)) {
            errors.push({
                field: 'address',
                message: `Invalid ${toChain.name} address format`,
            });
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Create a bridge order
     * @param {Object} params
     * @returns {Object} order
     */
    async createOrder({ direction, amount, destAddress, slippage }) {
        const dirConfig = CONFIG.DIRECTIONS[direction];
        const fromChain = CONFIG.CHAINS[dirConfig.from];
        const toChain = CONFIG.CHAINS[dirConfig.to];
        const conversion = rateService.calculateConversion(amount, direction, slippage);

        // Abort any existing order simulation
        if (this._orderAbortController) {
            this._orderAbortController.abort();
        }
        this._orderAbortController = new AbortController();

        const order = {
            id: generateId('br'),
            direction,
            fromAmount: amount,
            fromCurrency: dirConfig.from,
            fromChain: fromChain.id,
            toAmount: conversion.toAmount,
            toCurrency: dirConfig.to,
            toChain: toChain.id,
            destAddress,
            depositAddress: generateMockAddress(direction),
            rate: rateService.getRate(direction),
            fee: conversion.fee,
            minReceived: conversion.minReceived,
            slippage,
            status: 'awaiting_deposit',
            step: 1,
            totalSteps: 4,
            estimatedTime: dirConfig.estimatedTime,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            txHashes: {},
            confirmations: { current: 0, required: fromChain.confirmations },
        };

        this._activeOrder = order;

        // Save to history immediately
        storageService.addToHistory({
            ...order,
            status: 'pending',
        });
        eventBus.emit(EVENTS.HISTORY_UPDATED, storageService.getHistory());
        eventBus.emit(EVENTS.ORDER_CREATED, order);

        // Start simulated progress
        this._simulateProgress(order, this._orderAbortController.signal);

        return order;
    }

    /**
     * Cancel the active order
     */
    cancelOrder() {
        if (this._orderAbortController) {
            this._orderAbortController.abort();
            this._orderAbortController = null;
        }

        if (this._activeOrder) {
            this._activeOrder.status = 'cancelled';
            storageService.updateHistoryItem(this._activeOrder.id, {
                status: 'cancelled',
                updatedAt: Date.now(),
            });
            eventBus.emit(EVENTS.HISTORY_UPDATED, storageService.getHistory());
        }

        this._activeOrder = null;
    }

    /**
     * Reset for a new order
     */
    reset() {
        this._activeOrder = null;
        if (this._orderAbortController) {
            this._orderAbortController.abort();
            this._orderAbortController = null;
        }
    }

    /**
     * Get order status display
     * @param {Object} order
     * @returns {Object}
     */
    getOrderDisplayInfo(order) {
        const fromChain = CONFIG.CHAINS[order.fromCurrency];
        const toChain = CONFIG.CHAINS[order.toCurrency];

        const steps = [
            {
                title: 'Awaiting Deposit',
                desc: `Send ${order.fromCurrency} to the bridge address`,
                icon: '📥',
            },
            {
                title: 'Confirming',
                desc: `Waiting for ${fromChain.confirmations} ${fromChain.name} confirmations`,
                icon: '⏳',
            },
            {
                title: 'Bridging',
                desc: 'Processing cross-chain atomic swap',
                icon: '🔄',
            },
            {
                title: 'Complete',
                desc: `${order.toCurrency} sent to your ${toChain.name} wallet`,
                icon: '✅',
            },
        ];

        return {
            steps,
            currentStep: order.step,
            estimatedTimeRemaining: this._estimateTimeRemaining(order),
            fromExplorerUrl: order.txHashes.from
                ? `${fromChain.explorerUrl}${order.txHashes.from}`
                : null,
            toExplorerUrl: order.txHashes.to
                ? `${toChain.explorerUrl}${order.txHashes.to}`
                : null,
        };
    }

    /**
     * Simulate bridge progress (replace with real WebSocket/polling)
     */
    async _simulateProgress(order, signal) {
        try {
            // Step 1: Awaiting deposit
            await sleep(3000, signal);

            // Simulate deposit received
            order.txHashes.from = generateId('tx');
            this._updateOrder(order, 2, 'confirming');

            // Step 2: Confirming — simulate individual confirmations
            const requiredConfs = order.confirmations.required;
            for (let i = 1; i <= requiredConfs; i++) {
                await sleep(400, signal);
                order.confirmations.current = i;
                eventBus.emit(EVENTS.ORDER_STEP_CHANGED, { ...order });
            }
            this._updateOrder(order, 3, 'bridging');

            // Step 3: Bridging
            await sleep(4000, signal);

            // Step 4: Complete
            order.txHashes.to = generateId('tx');
            this._updateOrder(order, 4, 'completed');

            // Update history as completed
            storageService.updateHistoryItem(order.id, {
                status: 'completed',
                txHashes: order.txHashes,
                updatedAt: Date.now(),
            });
            eventBus.emit(EVENTS.HISTORY_UPDATED, storageService.getHistory());
            eventBus.emit(EVENTS.ORDER_COMPLETED, order);

        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[BridgeService] Order simulation aborted');
                return;
            }
            console.error('[BridgeService] Simulation error:', err);

            order.status = 'failed';
            order.error = err.message;
            storageService.updateHistoryItem(order.id, {
                status: 'failed',
                error: err.message,
                updatedAt: Date.now(),
            });
            eventBus.emit(EVENTS.ORDER_FAILED, order);
            eventBus.emit(EVENTS.HISTORY_UPDATED, storageService.getHistory());
        }
    }

    _updateOrder(order, step, status) {
        order.step = step;
        order.status = status;
        order.updatedAt = Date.now();
        eventBus.emit(EVENTS.ORDER_STEP_CHANGED, { ...order });
    }

    _validateAddress(address, chain) {
        if (chain.addressRegex) return chain.addressRegex.test(address);
        return address.length >= chain.addressLength;
    }

    _estimateTimeRemaining(order) {
        const elapsed = (Date.now() - order.createdAt) / 1000;
        const remaining = Math.max(0, order.estimatedTime - elapsed);
        return formatTime(remaining);
    }
}

export const bridgeService = new BridgeService();
export default bridgeService;
