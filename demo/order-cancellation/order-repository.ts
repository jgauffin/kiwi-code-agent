import type { Order } from './order'

export class OrderRepository {
  async byId(orderId: string): Promise<Order | undefined> {
    console.log(`Loading order ${orderId}`)
    return undefined
  }

  async markCancelled(orderId: string, reason: string): Promise<void> {
    console.log(`Cancelling ${orderId}: ${reason}`)
  }

  async flagForReview(orderId: string, amount: number): Promise<void> {
    console.log(`Flagging ${orderId} for manual review of ${amount}`)
  }
}
