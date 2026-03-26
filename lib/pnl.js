/**
 * Bhandai Exchange -- P&L Display Helpers
 * Pure functions for live P&L calculation.
 * Used by client portfolio and anywhere live position valuation is needed.
 *
 * Extends window.BX (created by lib/utils.js).
 */
(function (BX) {
  'use strict';

  /**
   * Get the current live rate for an order.
   * LAGAI/KHAI bets use lagai_rate from events (+ 0.05 for khai rate).
   * BACK/LAY bets use back_price from outcomes.
   *
   * @param {Object} ord          - Order row (needs event_id, outcome_id, price_per_share, bet_side)
   * @param {Array}  allOutcomes  - All outcomes array
   * @param {Array}  allEvents    - All events array
   * @returns {number} Current market rate for this order
   */
  BX.getLiveRate = function getLiveRate(ord, allOutcomes, allEvents) {
    var bp = parseFloat(ord.price_per_share || 1);
    var isLK = ord.bet_side === 'LAGAI' || ord.bet_side === 'KHAI';
    if (isLK) {
      var evData = allEvents.find(function (e) { return e.id === ord.event_id; });
      var lagaiRate = parseFloat(evData && evData.lagai_rate != null ? evData.lagai_rate : bp);
      // Both LAGAI and KHAI use the current KHAI rate (lagaiRate + 0.05):
      // LAGAI: exitVal = stake * (entryLagai / curKhai)
      // KHAI:  exitVal = stake / curKhai  (win-position shrinks when khai rises)
      return parseFloat((lagaiRate + 0.05).toFixed(2));
    } else {
      var curOc = allOutcomes.find(function (o) { return o.id === ord.outcome_id; });
      return parseFloat(curOc && curOc.back_price != null ? curOc.back_price : bp);
    }
  };

  /**
   * Calculate P&L for a single open order at current market rate.
   * LAGAI: exitVal = stake * (entryLagai / curKhai)
   * KHAI:  exitVal = stake / curKhai
   * Back/Lay: exitVal = stake * (entry / current)
   * pnl = exitVal - stake
   *
   * @param {Object} ord          - Order row
   * @param {Array}  allOutcomes  - All outcomes array
   * @param {Array}  allEvents    - All events array
   * @returns {{ stake: number, entryRate: number, curRate: number, exitVal: number, pnl: number }}
   */
  BX.calcOrderPnl = function calcOrderPnl(ord, allOutcomes, allEvents) {
    var stake = parseFloat(ord.total_cost || 0);
    var entryRate = parseFloat(ord.price_per_share || 1);
    var curRate = BX.getLiveRate(ord, allOutcomes, allEvents);
    var exitVal = ord.bet_side === 'KHAI'
      ? stake / curRate                    // stake / curKhaiRate
      : stake * (entryRate / curRate);
    return { stake: stake, entryRate: entryRate, curRate: curRate, exitVal: exitVal, pnl: exitVal - stake };
  };

  /**
   * Calculate event book (net exposure per event for two outcome scenarios).
   * Returns { favWins, favLoses, count } where each is the user's net P&L
   * for that scenario.
   *
   * @param {string} eventId      - Event ID
   * @param {Array}  myOrders     - User's orders array
   * @param {Array}  allOutcomes  - All outcomes array (unused but kept for interface consistency)
   * @param {Array}  allEvents    - All events array (unused but kept for interface consistency)
   * @returns {{ favWins: number, favLoses: number, count: number }|null}
   */
  BX.calcEventBook = function calcEventBook(eventId, myOrders, allOutcomes, allEvents) {
    var eventOrds = myOrders.filter(function (o) { return o.event_id === eventId && o.status === 'OPEN'; });
    if (!eventOrds.length) return null;
    var favWins = 0, favLoses = 0;
    eventOrds.forEach(function (o) {
      var stake = parseFloat(o.total_cost || 0);
      var rate  = parseFloat(o.price_per_share || 1);
      // IMPORTANT: recalculate from original rate -- do NOT use (shares - stake).
      // When position netting hedges, shares gets reduced, making profit appear 0.
      var profit = o.bet_side === 'LAGAI' ? stake * rate
                 : o.bet_side === 'KHAI'  ? stake / rate
                 : 0;
      if (o.bet_side === 'LAGAI') {
        favWins  += profit;   // LAGAI: wins if fav team wins
        favLoses -= stake;    // LAGAI: loses if fav team loses
      } else if (o.bet_side === 'KHAI') {
        favWins  -= stake;    // KHAI (lay): costs stake if fav team wins
        favLoses += profit;   // KHAI (lay): profits if fav team loses
      }
    });
    return { favWins: favWins, favLoses: favLoses, count: eventOrds.length };
  };

})(window.BX = window.BX || {});
