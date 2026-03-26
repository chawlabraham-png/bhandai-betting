/**
 * Bhandai Exchange -- Commission Calculations
 * Pure display/preview functions for commission estimation.
 * Actual commission is calculated server-side in PostgreSQL RPCs.
 *
 * Extends window.BX (created by lib/utils.js).
 */
(function (BX) {
  'use strict';

  /**
   * Match commission: rate% of net loss (zero if winner).
   * @param {number} netPnl - Net profit/loss for the user
   * @param {number} rate   - Commission rate as percentage (e.g. 2 means 2%)
   * @returns {number} Commission amount (always >= 0)
   */
  BX.calcMatchCommission = function calcMatchCommission(netPnl, rate) {
    if (netPnl >= 0) return 0;
    return Math.abs(netPnl) * (rate / 100);
  };

  /**
   * Fancy commission: rate% of total volume (regardless of win/loss).
   * @param {number} volume - Total volume played (absolute value used)
   * @param {number} rate   - Commission rate as percentage (e.g. 1 means 1%)
   * @returns {number} Commission amount (always >= 0)
   */
  BX.calcFancyCommission = function calcFancyCommission(volume, rate) {
    return Math.abs(volume) * (rate / 100);
  };

})(window.BX = window.BX || {});
