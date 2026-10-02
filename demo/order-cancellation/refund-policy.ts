import type { Order, RefundDecision } from './order'

const MANUAL_REVIEW_LIMIT = 500

export class RefundPolicy {
  decide(order: Order): RefundDecision {
    const paid = order.lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
    return { amount: paid, manualReview: paid > MANUAL_REVIEW_LIMIT }
  }

  async pay(orderId: string, amount: number): Promise<void> {
    console.log(`Refunding ${amount} for ${orderId}`)
  }
}
