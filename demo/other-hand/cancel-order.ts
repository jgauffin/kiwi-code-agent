import { OrderRepository } from './order-repository'
import { RefundPolicy } from './refund-policy'

export class CancelOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly refunds: RefundPolicy,
  ) {}

  async execute(orderId: string, reason: string): Promise<void> {
    const order = await this.orders.byId(orderId)
    if (!order) throw new Error(`Unknown order ${orderId}`)
    if (order.status === 'cancelled') return
    if (order.status === 'shipped') throw new Error(`Order ${orderId} has shipped and cannot be cancelled`)

    const decision = this.refunds.decide(order)
    await this.orders.markCancelled(orderId, reason)
    if (decision.manualReview) await this.orders.flagForReview(orderId, decision.amount)
    else await this.refunds.pay(orderId, decision.amount)
  }
}
