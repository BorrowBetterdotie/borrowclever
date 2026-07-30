// lib/amortization.mjs
// Shared loan-repayment maths for the worked-example pages and the /calculator/.
//
// Uses the effective monthly rate i = (1 + APR/100)^(1/12) − 1 — the same
// formula build.js uses for the homepage saving figure and the loans-page FAQ
// describes, so every number on the site is computed the same way.
//
// Deliberately dependency-free and browser-safe: build-calculator.mjs inlines
// this file's source into the calculator page, so keep it free of node imports.

export function monthlyRate(aprPct) {
  return Math.pow(1 + aprPct / 100, 1 / 12) - 1;
}

// Level monthly payment for a principal repaid over `months` at `aprPct`.
export function monthlyPayment(principal, aprPct, months) {
  const i = monthlyRate(aprPct);
  if (i === 0) return principal / months;
  const pow = Math.pow(1 + i, months);
  return (principal * i * pow) / (pow - 1);
}

// Full amortization: payment, totals, and a month-by-month schedule.
// Figures are kept at full precision; round at display time.
export function amortize(principal, aprPct, months) {
  const i = monthlyRate(aprPct);
  const payment = monthlyPayment(principal, aprPct, months);
  const schedule = [];
  let balance = principal;
  for (let m = 1; m <= months; m++) {
    const interest = balance * i;
    // Final payment clears the remaining balance exactly.
    const principalPaid = m === months ? balance : payment - interest;
    balance = Math.max(0, balance - principalPaid);
    schedule.push({ month: m, payment: principalPaid + interest, interest, principalPaid, balance });
  }
  const totalRepayable = schedule.reduce((sum, r) => sum + r.payment, 0);
  return {
    monthly: payment,
    totalInterest: totalRepayable - principal,
    totalRepayable,
    schedule,
  };
}

// How long a fixed monthly payment takes to clear a revolving balance (e.g. a
// credit card) at `aprPct`, and what it costs. Returns null if the payment
// doesn't cover the first month's interest (the balance would never fall).
export function payoff(balance, aprPct, payment) {
  const i = monthlyRate(aprPct);
  if (payment <= balance * i) return null;
  let remaining = balance;
  let months = 0;
  let totalPaid = 0;
  while (remaining > 0 && months < 1200) {
    const interest = remaining * i;
    const pay = Math.min(payment, remaining + interest);
    remaining = remaining + interest - pay;
    totalPaid += pay;
    months++;
  }
  return { months, totalPaid, totalInterest: totalPaid - balance };
}
