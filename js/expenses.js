/* =========================================================================
   expenses.js — compatibility shim
   Domain logic now lives in transactions.js. This file keeps Part 1's
   script-tag order working and exposes the same ET.expenses alias.
   ========================================================================= */
(function (global) {
  "use strict";
  var ET = (global.ET = global.ET || {});
  if (ET.transactions && !ET.expenses) {
    ET.expenses = ET.transactions;
  }
})(window);
