export interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: 'captured' | 'refunded';
  createdAt: string;
  refundReason?: string;
}

const payments = new Map<string, Payment>();
let counter = 0;

export function insertPayment(amount: number, currency: string): Payment {
  counter += 1;
  const payment: Payment = {
    id: `pay_${String(counter).padStart(6, '0')}`,
    amount,
    currency,
    status: 'captured',
    createdAt: new Date().toISOString(),
  };
  payments.set(payment.id, payment);
  return payment;
}

export function findPayment(id: string): Payment | undefined {
  return payments.get(id);
}

export function markRefunded(id: string, reason?: string): Payment | undefined {
  const payment = payments.get(id);
  if (!payment) return undefined;
  payment.status = 'refunded';
  if (reason) payment.refundReason = reason;
  return payment;
}
